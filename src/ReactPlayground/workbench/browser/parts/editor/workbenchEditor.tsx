/**
 * WorkbenchEditor — Monaco 编辑器组件
 *
 * 这个文件负责两件事：
 *   1. 对外导出 releaseModel 工具函数（删除/重命名文件时清理 Monaco 模型）
 *   2. 渲染编辑器区域：普通编辑模式 + AI Diff 审查模式（两个 editor 叠在一起，用 CSS 切换显示）
 *
 * 对应 VSCode OSS 中的 TextEditorWidget + DiffEditorWidget 层。
 */

import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { WorkspaceEdit, WorkspaceFile } from '../../../../PlaygroundContext'

/**
 * MonacoEnvironment — 告诉 Monaco 如何加载语言服务 Worker。
 *
 * Monaco 的语法高亮、类型检查、代码补全都依赖 Web Worker，
 * 这里通过 Vite 的 ?worker 语法把每个 Worker 打包成独立 chunk，
 * 然后根据 label 返回对应的 Worker 实例。
 *
 * 必须在模块顶层执行（而不是在 useEffect 里），确保 Monaco 初始化前就能拿到这个配置。
 */
;(self as unknown as { MonacoEnvironment: typeof self.MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    if (label === 'css') return new CssWorker()
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

/**
 * 手动扩展 Monaco 的语言 API 类型，因为 @types/monaco-editor 里
 * typescript 相关的 API 没有完整的类型定义，需要自己补充才能调用。
 */
type MonacoLanguageApi = typeof monaco.languages & {
  typescript: {
    typescriptDefaults: {
      setCompilerOptions: (options: Record<string, unknown>) => void
    }
    JsxEmit: { Preserve: number }
    ModuleResolutionKind: { NodeJs: number }
    ScriptTarget: { ES2020: number }
  }
}

// ─── Model 缓存层 ─────────────────────────────────────────────────────────────

/**
 * modelCache：记录所有由我们代码主动创建的 Monaco TextModel。
 *
 * 为什么需要这个缓存？
 * Monaco 内部也维护了一个全局的 model 注册表（monaco.editor.getModel(uri)），
 * 但它不暴露"哪些 model 是我们创建的"，导致清理时没有统一入口。
 * 我们额外维护一份 Map，用于删除/重命名文件时精准清理。
 */
const modelCache = new Map<string, monaco.editor.ITextModel>()

/**
 * uriForPath：把文件路径映射到 Monaco URI。
 *
 * 使用 file:///workspace/ 前缀的好处：
 * Monaco 的 TypeScript 服务会把这个 URI 当成真实的文件系统路径，
 * 从而能解析同目录下的其他模块（如 import './utils'），
 * 实现跨文件的类型推断和补全。
 */
const uriForPath = (path: string) => monaco.Uri.parse(`file:///workspace/${path}`)

/**
 * getModel：获取或创建一个文件对应的 Monaco TextModel。
 *
 * 文件切换时不销毁 model 而是复用，这样能保住：
 *   - 每个文件各自的撤销历史（Cmd+Z）
 *   - 光标位置和滚动位置
 *   - TypeScript 诊断信息（不必等重新分析）
 *
 * 如果 model 已存在但内容不一致（外部修改了文件），同步最新值。
 */
const getModel = (file: WorkspaceFile) => {
  const uri = uriForPath(file.path)
  const existing = monaco.editor.getModel(uri)
  if (existing) {
    if (existing.getValue() !== file.value) existing.setValue(file.value)
    return existing
  }

  const model = monaco.editor.createModel(file.value, file.language, uri)
  modelCache.set(file.path, model)
  return model
}

/**
 * releaseModel：销毁指定路径的 Monaco TextModel。
 *
 * 在文件被删除或重命名时调用，防止：
 *   1. 内存泄漏（TextModel 持有文件内容的副本）
 *   2. 缓存污染（新建同名文件时会错误地复用旧 model 的内容）
 *
 * 导出给 useWorkspaceFiles 使用——这是跨层调用，
 * 但只是单向的（workspace 层调用 editor 层），不构成循环依赖。
 */
export const releaseModel = (path: string) => {
  const uri = uriForPath(path)
  monaco.editor.getModel(uri)?.dispose()
  modelCache.delete(path)
}

// ─── 组件 ─────────────────────────────────────────────────────────────────────

interface WorkbenchEditorProps {
  file?: WorkspaceFile           // 当前打开的文件
  allFiles?: Record<string, WorkspaceFile> // 工作区所有文件（用于预建模型）
  pendingEdit: WorkspaceEdit | null        // AI 生成的待审查变更，非 null 时显示 diff 编辑器
  theme: 'light' | 'dark'
  onChange: (path: string, value: string) => void
  onFormat: () => void
}

export default function WorkbenchEditor(props: WorkbenchEditorProps) {
  const { file, allFiles, onChange, onFormat, pendingEdit, theme } = props
  const editorContainerRef = useRef<HTMLDivElement>(null)   // 普通编辑器的 DOM 容器
  const diffContainerRef = useRef<HTMLDivElement>(null)     // diff 编辑器的 DOM 容器
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>()
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor>()
  const subscriptionRef = useRef<monaco.IDisposable>()  // 当前文件的内容变更订阅

  /**
   * onFormatRef：把 onFormat 存在 ref 里，让编辑器创建 effect 能用 [] 作为依赖。
   *
   * 背景：onFormat 在父组件里是 () => formatFile(selectedFileName) 这样的箭头函数，
   * 每次父组件重渲染（比如用户输入时 files 变化）都会创建新的函数引用。
   * 如果编辑器创建 effect 的依赖数组写 [onFormat]，每次 onFormat 变化时 effect 就会
   * 清理（销毁编辑器）再重建，重建后的编辑器没有焦点 → 用户输入中断。
   *
   * 解决方案：用 ref 保存最新的 onFormat，编辑器里的快捷键处理器通过 ref 调用它，
   * 这样编辑器只创建一次（[] 依赖），但 onFormat 始终是最新版本（ref 更新）。
   */
  const onFormatRef = useRef(onFormat)
  useEffect(() => {
    onFormatRef.current = onFormat
  }, [onFormat])

  // ── TypeScript 编译选项 ────────────────────────────────────────────────────

  /**
   * 配置 Monaco 内置的 TypeScript 语言服务。
   * 这些选项决定了编辑器里的类型检查和代码补全行为，依赖数组为 [] 只执行一次。
   */
  useEffect(() => {
    const languages = monaco.languages as MonacoLanguageApi
    languages.typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,   // 允许识别 .tsx .jsx 等非标准 TS 扩展名
      esModuleInterop: true,         // 允许 import React from 'react' 而不是 import * as React
      jsx: languages.typescript.JsxEmit.Preserve, // 保留 JSX，不转换（Babel 负责转换）
      moduleResolution: languages.typescript.ModuleResolutionKind.NodeJs,
      resolveJsonModule: true,       // 允许 import data from './data.json'
      target: languages.typescript.ScriptTarget.ES2020,
    })
  }, [])

  // ── 编辑器实例化（只执行一次）────────────────────────────────────────────

  /**
   * 创建普通编辑器实例。依赖数组为 []，整个组件生命周期只创建一次。
   *
   * fixedOverflowWidgets: true 的作用：
   *   Monaco 的悬浮提示（hover card）和补全列表默认渲染在 editor 的 DOM 子节点里，
   *   受父容器的 overflow: hidden 裁切。我们的 tab 栏高度固定，悬浮提示会被裁掉。
   *   开启此选项后，这些 widget 会渲染到 document.body，不受容器裁切影响。
   */
  useEffect(() => {
    if (!editorContainerRef.current || editorRef.current) return

    editorRef.current = monaco.editor.create(editorContainerRef.current, {
      automaticLayout: true,        // 自动适应容器尺寸变化（拖拽分栏时用到）
      fixedOverflowWidgets: true,   // 悬浮提示渲染到 body，不被 tab 栏遮挡
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,  // 禁止滚动超过最后一行
      tabSize: 2,
    })

    // Cmd+Shift+P：在 Monaco 内触发命令面板
    // Monaco 会拦截这个快捷键，需要手动把它转发给 window，让 useLayoutState 的监听器接收
    editorRef.current.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
      () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true }))
      },
    )

    // Cmd+J：格式化当前文件（通过 ref 调用，保证读到最新的 onFormat）
    editorRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, () =>
      onFormatRef.current(),
    )

    return () => {
      subscriptionRef.current?.dispose()
      editorRef.current?.dispose()
      editorRef.current = undefined
    }
  }, [])

  // ── Diff 编辑器实例化（只执行一次）──────────────────────────────────────

  /** AI WorkspaceEdit 审查时显示的 diff 编辑器，只读模式 */
  useEffect(() => {
    if (!diffContainerRef.current || diffEditorRef.current) return

    diffEditorRef.current = monaco.editor.createDiffEditor(diffContainerRef.current, {
      automaticLayout: true,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      readOnly: true,
      renderSideBySide: true, // 左右对比模式（而不是上下合并模式）
    })

    return () => {
      diffEditorRef.current?.dispose()
      diffEditorRef.current = undefined
    }
  }, [])

  // ── 主题切换 ───────────────────────────────────────────────────────────────

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  }, [theme])

  // ── 文件切换 ───────────────────────────────────────────────────────────────

  /**
   * 当 file（当前选中文件）变化时，把对应的 TextModel 装载到编辑器里。
   *
   * 关键：用 setModel() 切换文件而不是销毁/重建编辑器，
   * 这样每个文件的光标位置、撤销历史都独立保留。
   *
   * 同时重新订阅 onDidChangeContent 事件：
   *   - 先 dispose 旧订阅，防止上一个文件的修改事件仍然触发
   *   - 订阅新 model 的变化，实时通知 workspace hook 更新 value + dirty
   */
  useEffect(() => {
    if (!file || !editorRef.current) return
    const model = getModel(file)
    editorRef.current.setModel(model)
    editorRef.current.updateOptions({ readOnly: file.readonly })

    subscriptionRef.current?.dispose()
    subscriptionRef.current = model.onDidChangeContent(() => {
      if (!file.readonly) onChange(file.path, model.getValue())
    })
  }, [file, onChange])

  // ── 预建所有工作区文件的 Model ─────────────────────────────────────────────

  /**
   * 为工作区里每个文件预先创建 Monaco TextModel。
   *
   * 问题背景：Monaco 的 TypeScript 服务只能分析"已存在 model"的文件。
   * 如果 A.tsx import B.tsx，但 B.tsx 还没被打开过（没有 model），
   * 编辑器就会报 "Cannot find module './B'" 的误报警告。
   *
   * 解决方案：工作区文件列表变化时，把所有文件都预建 model，
   * 这样 TypeScript 服务能看到完整的虚拟文件系统，不再误报。
   *
   * 只在没有 model 时创建，避免覆盖已打开文件正在编辑的内容。
   */
  useEffect(() => {
    if (!allFiles) return
    Object.values(allFiles).forEach((f) => {
      const uri = uriForPath(f.path)
      if (!monaco.editor.getModel(uri)) {
        monaco.editor.createModel(f.value, f.language, uri)
      }
    })
  }, [allFiles])

  // ── Diff 内容绑定 ──────────────────────────────────────────────────────────

  /**
   * 当 pendingEdit（AI 生成的变更）变化时，把变更内容装载到 diff 编辑器。
   *
   * 每次 pendingEdit 变化都创建新的临时 model（original + modified），
   * cleanup 函数里先 setModel(null) 解除引用，再 dispose model。
   *
   * 必须先 setModel(null)，否则 Monaco 会在 model 还被 diff editor 引用的情况下
   * 收到 dispose 调用，抛出 "TextModel got disposed before DiffEditorWidget model got reset" 错误。
   */
  useEffect(() => {
    if (!pendingEdit || !diffEditorRef.current) return
    const change = pendingEdit.changes[0]
    const language = change.path.split('.').pop() || 'typescript'
    const original = monaco.editor.createModel(
      change.before,
      language,
      // 用唯一 URI 防止多次 pendingEdit 时 URI 冲突
      monaco.Uri.parse(`diff:///original/${pendingEdit.id}/${change.path}`),
    )
    const modified = monaco.editor.createModel(
      change.after,
      language,
      monaco.Uri.parse(`diff:///modified/${pendingEdit.id}/${change.path}`),
    )
    diffEditorRef.current.setModel({ original, modified })

    return () => {
      diffEditorRef.current?.setModel(null) // 先解除引用，再 dispose
      original.dispose()
      modified.dispose()
    }
  }, [pendingEdit])

  // ── 渲染 ───────────────────────────────────────────────────────────────────

  /**
   * 两个编辑器容器叠放在一起（CSS position: absolute），
   * 通过 className 切换显示：pendingEdit 存在时显示 diff 编辑器，否则显示普通编辑器。
   * 这种方式避免了销毁/重建编辑器实例，切换更快且保留各自状态。
   */
  return (
    <div className="editor-stack">
      <div
        ref={editorContainerRef}
        className={pendingEdit ? 'editor-host editor-host--hidden' : 'editor-host'}
      />
      <div
        ref={diffContainerRef}
        className={pendingEdit ? 'editor-host diff-host' : 'editor-host editor-host--hidden'}
      />
    </div>
  )
}
