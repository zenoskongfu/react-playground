import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { WorkspaceEdit, WorkspaceFile } from '../PlaygroundContext'

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

;(self as unknown as { MonacoEnvironment: typeof self.MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    if (label === 'css') return new CssWorker()
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

const modelCache = new Map<string, monaco.editor.ITextModel>()

const uriForPath = (path: string) => monaco.Uri.parse(`file:///workspace/${path}`)

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

interface WorkbenchEditorProps {
  file?: WorkspaceFile
  pendingEdit: WorkspaceEdit | null
  theme: 'light' | 'dark'
  onChange: (path: string, value: string) => void
  onFormat: () => void
}

export default function WorkbenchEditor(props: WorkbenchEditorProps) {
  const { file, onChange, onFormat, pendingEdit, theme } = props
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const diffContainerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>()
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor>()
  const subscriptionRef = useRef<monaco.IDisposable>()

  useEffect(() => {
    const languages = monaco.languages as MonacoLanguageApi
    languages.typescript.typescriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      esModuleInterop: true,
      jsx: languages.typescript.JsxEmit.Preserve,
      moduleResolution: languages.typescript.ModuleResolutionKind.NodeJs,
      target: languages.typescript.ScriptTarget.ES2020,
    })
  }, [])

  useEffect(() => {
    if (!editorContainerRef.current || editorRef.current) return

    editorRef.current = monaco.editor.create(editorContainerRef.current, {
      automaticLayout: true,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      tabSize: 2,
    })

    editorRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        shiftKey: true,
      }))
    })

    editorRef.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyJ, onFormat)

    return () => {
      subscriptionRef.current?.dispose()
      editorRef.current?.dispose()
      editorRef.current = undefined
    }
  }, [onFormat])

  useEffect(() => {
    if (!diffContainerRef.current || diffEditorRef.current) return

    diffEditorRef.current = monaco.editor.createDiffEditor(diffContainerRef.current, {
      automaticLayout: true,
      fontFamily: '"SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      minimap: { enabled: false },
      readOnly: true,
      renderSideBySide: true,
    })

    return () => {
      diffEditorRef.current?.dispose()
      diffEditorRef.current = undefined
    }
  }, [])

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
  }, [theme])

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

  useEffect(() => {
    if (!pendingEdit || !diffEditorRef.current) return
    const change = pendingEdit.changes[0]
    const language = change.path.split('.').pop() || 'typescript'
    const original = monaco.editor.createModel(
      change.before,
      language,
      monaco.Uri.parse(`diff:///original/${pendingEdit.id}/${change.path}`),
    )
    const modified = monaco.editor.createModel(
      change.after,
      language,
      monaco.Uri.parse(`diff:///modified/${pendingEdit.id}/${change.path}`),
    )
    diffEditorRef.current.setModel({ original, modified })

    return () => {
      original.dispose()
      modified.dispose()
    }
  }, [pendingEdit])

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
