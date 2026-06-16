/**
 * useAiAssistant — AI 辅助功能服务
 *
 * 负责管理：
 *   - 聊天消息列表（aiMessages）
 *   - AI 生成的待审查变更（pendingEdit / WorkspaceEdit）
 *   - 输出面板日志（output）
 *
 * 这个 hook 依赖 workspace 和 layout 两个 slice 的部分能力，
 * 通过参数传入而不是通过 Context 消费，原因：
 *   1. 避免循环依赖（hook 不能消费自己所在 Provider 的 Context）
 *   2. 明确声明依赖关系，便于理解和测试
 *   3. 与 VSCode OSS 的服务注入模式对应（依赖倒置）
 */

import { useState } from 'react'
import type {
  ActivityView,
  AiAction,
  AiMessage,
  WorkspaceEdit,
  WorkspaceFile,
} from '../../../PlaygroundContext'
import { fileName2Language, normalizePath } from '../../../utils'
import { readOnlyFilePaths } from '../../../files'

/** 生成随机的 8 位 16 进制 ID，用于 WorkspaceEdit 和 AiMessage 的唯一标识 */
const makeEditId = () => Math.random().toString(36).slice(2, 10)

const fileNameFromPath = (path: string) => path.split('/').pop() || path

const createWorkspaceFile = (path: string, value = ''): WorkspaceFile => {
  const normalizedPath = normalizePath(path)
  return {
    path: normalizedPath,
    name: fileNameFromPath(normalizedPath),
    value,
    language: fileName2Language(normalizedPath),
    readonly: readOnlyFilePaths.includes(normalizedPath),
  }
}

// ─── 依赖的外部 slice 类型 ───────────────────────────────────────────────────

/**
 * WorkspaceSlice：从 useWorkspaceFiles 借用的能力。
 *
 * 只声明需要的部分，而不是整个 useWorkspaceFiles 的返回值，
 * 这样 hook 的依赖边界清晰，也方便单独测试（可以 mock 这几个函数）。
 */
type WorkspaceSlice = {
  workspaceFiles: Record<string, WorkspaceFile>
  selectedFileName: string
  // React 原始 setter，支持函数式更新（避免读取旧 state）
  setWorkspaceFiles: React.Dispatch<React.SetStateAction<Record<string, WorkspaceFile>>>
  setOpenTabs: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedFileNameRaw: React.Dispatch<React.SetStateAction<string>>
}

type LayoutSlice = {
  setActiveActivity: React.Dispatch<React.SetStateAction<ActivityView>>
}

// ─── Hook 主体 ───────────────────────────────────────────────────────────────

export function useAiAssistant(workspace: WorkspaceSlice, layout: LayoutSlice) {
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '我会基于当前文件生成 WorkspaceEdit，并先进入 Diff Review。',
    },
  ])

  /**
   * pendingEdit：AI 生成的待审查变更。
   *
   * 非 null 时，WorkbenchEditor 会切换到 diff 模式显示变更内容，
   * 用户可以选择"Apply"（应用）或"Discard"（丢弃）。
   * 这模仿了 VSCode 的 WorkspaceEdit API 流程。
   */
  const [pendingEdit, setPendingEdit] = useState<WorkspaceEdit | null>(null)
  const [output, setOutput] = useState<string[]>([
    'VSCode-like services initialized with local adapter.',
    'Extension host mock registered: commands, webview, workspace edit.',
  ])

  // ── AI 操作 ─────────────────────────────────────────────────────────────────

  /**
   * askAi：触发一次 AI 请求（Mock 实现）。
   *
   * 真实项目中这里应该调用 LLM API，当前版本使用 mock 数据模拟 AI 响应，
   * 主要目的是演示 WorkspaceEdit 的完整审查流程：
   *   1. AI 生成变更（before/after diff）
   *   2. 设置 pendingEdit → 触发 diff 编辑器显示
   *   3. 切换到 AI 面板，添加聊天消息
   */
  const askAi = (action: AiAction) => {
    const { workspaceFiles, selectedFileName } = workspace
    const currentFile = workspaceFiles[selectedFileName]
    if (!currentFile) return

    // generate-component 操作会在 src/components/ 下生成新文件
    const targetPath =
      action === 'generate-component' ? 'src/components/GeneratedPanel.tsx' : selectedFileName
    const before = workspaceFiles[targetPath]?.value || ''
    const after =
      action === 'generate-component'
        ? `export function GeneratedPanel() {\n  return (\n    <section className="generated-panel">\n      <strong>AI generated component</strong>\n      <p>Mocked from the current workspace context.</p>\n    </section>\n  )\n}\n`
        : `${currentFile.value}\n\n/* AI mock suggestion: extracted from ${currentFile.name} with VSCode-like WorkspaceEdit review. */\n`

    const title =
      action === 'explain-selection'
        ? 'Explain current selection'
        : action === 'generate-test'
          ? 'Generate unit test scaffold'
          : action === 'fix-error'
            ? 'Analyze runtime error'
            : action === 'refactor-file'
              ? 'Refactor current file'
              : 'Generate component example'

    setPendingEdit({
      id: makeEditId(),
      title,
      description: `Mock AI created a WorkspaceEdit for ${targetPath}. Review the diff before applying.`,
      changes: [{ path: targetPath, before, after }],
    })
    layout.setActiveActivity('ai') // 自动切换到 AI 侧边栏
    setAiMessages((messages) => [
      ...messages,
      { id: makeEditId(), role: 'user', content: title },
      {
        id: makeEditId(),
        role: 'assistant',
        content: `已生成 ${targetPath} 的变更计划，等待你在 Diff Review 中确认。`,
      },
    ])
  }

  /**
   * applyWorkspaceEdit：把 pendingEdit 里的变更应用到工作区文件。
   *
   * 使用函数式更新（setWorkspaceFiles(current => ...)）而不是直接读取 workspaceFiles，
   * 原因：这个函数可能被 commands hook 等外部调用，
   * 如果读取的是定义时闭包里的 workspaceFiles，可能是过期快照。
   * 函数式更新让 React 传入最新的 state，避免覆盖并发更新。
   */
  const applyWorkspaceEdit = () => {
    if (!pendingEdit) return
    workspace.setWorkspaceFiles((current) => {
      const next = { ...current }
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        const existing = next[path]
        // 合并顺序：先用 createWorkspaceFile 建基础结构，
        // 再用 existing 覆盖（保留 dirty 等运行时字段），
        // 最后强制写入新的 value 和 language
        next[path] = {
          ...createWorkspaceFile(path, change.after),
          ...existing,
          path,
          name: fileNameFromPath(path),
          value: change.after,
          language: fileName2Language(path),
          dirty: true,
        }
      })
      return next
    })
    setOutput((logs) => [`Applied WorkspaceEdit: ${pendingEdit.title}`, ...logs])
    // 把变更涉及的文件加到 openTabs 并跳转
    workspace.setOpenTabs((tabs) => {
      const nextTabs = [...tabs]
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        if (!nextTabs.includes(path)) nextTabs.push(path)
      })
      return nextTabs
    })
    workspace.setSelectedFileNameRaw(normalizePath(pendingEdit.changes[0].path))
    setPendingEdit(null)
  }

  /** 丢弃 pendingEdit，记录日志 */
  const discardWorkspaceEdit = () => {
    if (pendingEdit) {
      setOutput((logs) => [`Discarded WorkspaceEdit: ${pendingEdit.title}`, ...logs])
    }
    setPendingEdit(null)
  }

  return {
    aiMessages,
    pendingEdit,
    output,
    setOutput, // 对外暴露，让 useCommands 也能往输出面板写日志
    askAi,
    applyWorkspaceEdit,
    discardWorkspaceEdit,
  }
}
