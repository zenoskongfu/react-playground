import { PropsWithChildren, createContext, useEffect, useMemo, useState } from 'react'
import { initFiles, readOnlyFilePaths } from './files'
import { compress, fileName2Language, normalizePath, uncompress } from './utils'

export interface File {
  name: string
  value: string
  language: string
  dirty?: boolean
}

export interface Files {
  [key: string]: File
}

export type Theme = 'light' | 'dark'
export type ActivityView = 'explorer' | 'search' | 'source-control' | 'extensions' | 'ai'
export type PanelView = 'preview' | 'problems' | 'output'

export interface WorkspaceFile {
  path: string
  name: string
  value: string
  language: string
  readonly?: boolean
  dirty?: boolean
}

export interface WorkspaceTreeNode {
  path: string
  name: string
  type: 'file' | 'folder'
  children?: WorkspaceTreeNode[]
  file?: WorkspaceFile
}

export interface WorkspaceChange {
  path: string
  before: string
  after: string
}

export interface WorkspaceEdit {
  id: string
  title: string
  description: string
  changes: WorkspaceChange[]
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface WorkbenchCommand {
  id: string
  title: string
  category: string
  keybinding?: string
  run: () => void
}

interface PlaygroundContextValue {
  files: Files
  workspaceFiles: Record<string, WorkspaceFile>
  tree: WorkspaceTreeNode[]
  openTabs: string[]
  selectedFileName: string
  activeActivity: ActivityView
  activePanel: PanelView
  panelVisible: boolean
  theme: Theme
  commands: WorkbenchCommand[]
  commandPaletteOpen: boolean
  aiMessages: AiMessage[]
  pendingEdit: WorkspaceEdit | null
  output: string[]
  setTheme: (theme: Theme) => void
  setActiveActivity: (view: ActivityView) => void
  setActivePanel: (view: PanelView) => void
  setPanelVisible: (visible: boolean) => void
  setCommandPaletteOpen: (visible: boolean) => void
  setSelectedFileName: (fileName: string) => void
  setFiles: (files: Files) => void
  addFile: (fileName: string) => void
  removeFile: (fileName: string) => void
  updateFileName: (oldFileName: string, newFileName: string) => void
  updateFileValue: (fileName: string, value: string) => void
  formatFile: (fileName: string) => void
  closeTab: (fileName: string) => void
  executeCommand: (id: string) => void
  askAi: (action: AiAction) => void
  applyWorkspaceEdit: () => void
  discardWorkspaceEdit: () => void
}

export type AiAction =
  | 'explain-selection'
  | 'generate-component'
  | 'generate-test'
  | 'fix-error'
  | 'refactor-file'

export const PlaygroundContext = createContext<PlaygroundContextValue>({
  selectedFileName: 'src/App.tsx',
} as PlaygroundContextValue)

const STORAGE_KEY = 'vscode-web-playground-workspace-v2'

const isStaleWorkspace = (files: Files) => {
  const filePaths = Object.keys(files)
  const hasLegacyFlatTemplate = filePaths.includes('App.tsx') || filePaths.includes('main.tsx')
  const hasStaleTemplate = Object.values(files).some((file) =>
    file.value.includes('@ts-nocheck'),
  )
  const importMap = files['import-map.json']?.value || ''
  const hasLegacyImportMap = importMap.includes('"react-dom/client": "https://esm.sh/react-dom@18.2.0"')
  const hasLegacyMainEntry = files['src/main.tsx']?.value.includes("import ReactDOM from 'react-dom/client'") || false
  return hasLegacyFlatTemplate || hasStaleTemplate || hasLegacyImportMap || hasLegacyMainEntry
}

const getFilesFromStorage = () => {
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    if (!cached) return undefined
    const files = JSON.parse(cached) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch (error) {
    console.error(error)
    return undefined
  }
}

const getFilesFromUrl = () => {
  try {
    if (!window.location.hash) return undefined
    const hash = uncompress(window.location.hash.slice(1))
    const files = JSON.parse(hash) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch (error) {
    console.error(error)
    return undefined
  }
}

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

const filesToWorkspace = (files: Files) => {
  return Object.keys(files).reduce<Record<string, WorkspaceFile>>((acc, path) => {
    const normalizedPath = normalizePath(path)
    acc[normalizedPath] = {
      ...createWorkspaceFile(normalizedPath),
      value: files[path].value,
      dirty: files[path].dirty,
    }
    return acc
  }, {})
}

const workspaceToFiles = (workspaceFiles: Record<string, WorkspaceFile>): Files => {
  return Object.keys(workspaceFiles).reduce<Files>((acc, path) => {
    const file = workspaceFiles[path]
    acc[path] = {
      name: path,
      value: file.value,
      language: file.language,
      dirty: file.dirty,
    }
    return acc
  }, {})
}

const buildTree = (workspaceFiles: Record<string, WorkspaceFile>) => {
  const root: WorkspaceTreeNode[] = []
  const folders = new Map<string, WorkspaceTreeNode[]>()
  folders.set('', root)

  Object.values(workspaceFiles)
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      const parts = file.path.split('/')
      let parentPath = ''
      parts.slice(0, -1).forEach((part) => {
        const currentPath = parentPath ? `${parentPath}/${part}` : part
        const parent = folders.get(parentPath) || root
        let folder = parent.find((node) => node.path === currentPath)
        if (!folder) {
          folder = {
            path: currentPath,
            name: part,
            type: 'folder',
            children: [],
          }
          parent.push(folder)
          folders.set(currentPath, folder.children || [])
        }
        parentPath = currentPath
      })

      const parent = folders.get(parentPath) || root
      parent.push({
        path: file.path,
        name: file.name,
        type: 'file',
        file,
      })
    })

  const sortNodes = (nodes: WorkspaceTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => {
      if (node.children) sortNodes(node.children)
    })
  }
  sortNodes(root)
  return root
}

const makeEditId = () => Math.random().toString(36).slice(2, 10)

export const PlaygroundProvider = (props: PropsWithChildren) => {
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, WorkspaceFile>>(() =>
    filesToWorkspace(getFilesFromUrl() || getFilesFromStorage() || initFiles),
  )
  const [selectedFileName, setSelectedFileNameState] = useState('src/App.tsx')
  const [openTabs, setOpenTabs] = useState(['src/App.tsx'])
  const [theme, setTheme] = useState<Theme>('dark')
  const [activeActivity, setActiveActivity] = useState<ActivityView>('explorer')
  const [activePanel, setActivePanel] = useState<PanelView>('preview')
  const [panelVisible, setPanelVisible] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '我会基于当前文件生成 WorkspaceEdit，并先进入 Diff Review。',
    },
  ])
  const [pendingEdit, setPendingEdit] = useState<WorkspaceEdit | null>(null)
  const [output, setOutput] = useState<string[]>([
    'VSCode-like services initialized with local adapter.',
    'Extension host mock registered: commands, webview, workspace edit.',
  ])

  const files = useMemo(() => workspaceToFiles(workspaceFiles), [workspaceFiles])
  const tree = useMemo(() => buildTree(workspaceFiles), [workspaceFiles])

  const setSelectedFileName = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    if (!workspaceFiles[normalizedPath]) return
    setSelectedFileNameState(normalizedPath)
    setOpenTabs((tabs) => (tabs.includes(normalizedPath) ? tabs : [...tabs, normalizedPath]))
  }

  const updateFileValue = (fileName: string, value: string) => {
    const normalizedPath = normalizePath(fileName)
    setWorkspaceFiles((current) => {
      const file = current[normalizedPath]
      if (!file || file.readonly) return current
      return {
        ...current,
        [normalizedPath]: {
          ...file,
          value,
          dirty: true,
        },
      }
    })
  }

  const formatFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    setWorkspaceFiles((current) => {
      const file = current[normalizedPath]
      if (!file || file.readonly) return current
      return {
        ...current,
        [normalizedPath]: {
          ...file,
          value: file.value.trimEnd() ? `${file.value.trimEnd()}\n` : file.value,
          dirty: true,
        },
      }
    })
  }

  const setFiles = (nextFiles: Files) => {
    setWorkspaceFiles(filesToWorkspace(nextFiles))
  }

  const addFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    if (workspaceFiles[normalizedPath]) {
      setSelectedFileName(normalizedPath)
      return
    }
    setWorkspaceFiles((current) => ({
      ...current,
      [normalizedPath]: createWorkspaceFile(normalizedPath),
    }))
    setSelectedFileNameState(normalizedPath)
    setOpenTabs((tabs) => [...tabs, normalizedPath])
  }

  const removeFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    const file = workspaceFiles[normalizedPath]
    if (!file || file.readonly) return
    setWorkspaceFiles((current) => {
      const next = { ...current }
      delete next[normalizedPath]
      return next
    })
    setOpenTabs((tabs) => tabs.filter((tab) => tab !== normalizedPath))
    if (selectedFileName === normalizedPath) {
      setSelectedFileNameState('src/App.tsx')
    }
  }

  const updateFileName = (oldFileName: string, newFileName: string) => {
    const oldPath = normalizePath(oldFileName)
    const newPath = normalizePath(newFileName)
    const file = workspaceFiles[oldPath]
    if (!file || file.readonly || !newPath || workspaceFiles[newPath]) return

    setWorkspaceFiles((current) => {
      const next = { ...current }
      delete next[oldPath]
      next[newPath] = {
        ...createWorkspaceFile(newPath, file.value),
        dirty: true,
      }
      return next
    })
    setOpenTabs((tabs) => tabs.map((tab) => (tab === oldPath ? newPath : tab)))
    if (selectedFileName === oldPath) {
      setSelectedFileNameState(newPath)
    }
  }

  const closeTab = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== normalizedPath)
      if (selectedFileName === normalizedPath) {
        setSelectedFileNameState(next[next.length - 1] || 'src/App.tsx')
      }
      return next.length ? next : ['src/App.tsx']
    })
  }

  const askAi = (action: AiAction) => {
    const currentFile = workspaceFiles[selectedFileName]
    if (!currentFile) return

    const targetPath =
      action === 'generate-component' ? 'src/components/GeneratedPanel.tsx' : selectedFileName
    const before = workspaceFiles[targetPath]?.value || ''
    const after =
      action === 'generate-component'
        ? `export function GeneratedPanel() {\n  return (\n    <section className=\"generated-panel\">\n      <strong>AI generated component</strong>\n      <p>Mocked from the current workspace context.</p>\n    </section>\n  )\n}\n`
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
      changes: [
        {
          path: targetPath,
          before,
          after,
        },
      ],
    })
    setActiveActivity('ai')
    setAiMessages((messages) => [
      ...messages,
      {
        id: makeEditId(),
        role: 'user',
        content: title,
      },
      {
        id: makeEditId(),
        role: 'assistant',
        content: `已生成 ${targetPath} 的变更计划，等待你在 Diff Review 中确认。`,
      },
    ])
  }

  const applyWorkspaceEdit = () => {
    if (!pendingEdit) return
    setWorkspaceFiles((current) => {
      const next = { ...current }
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        const existing = next[path]
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
    setOpenTabs((tabs) => {
      const nextTabs = [...tabs]
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        if (!nextTabs.includes(path)) nextTabs.push(path)
      })
      return nextTabs
    })
    setSelectedFileNameState(normalizePath(pendingEdit.changes[0].path))
    setPendingEdit(null)
  }

  const discardWorkspaceEdit = () => {
    if (pendingEdit) {
      setOutput((logs) => [`Discarded WorkspaceEdit: ${pendingEdit.title}`, ...logs])
    }
    setPendingEdit(null)
  }

  const executeCommand = (id: string) => {
    const command = commands.find((item) => item.id === id)
    command?.run()
    setCommandPaletteOpen(false)
  }

  const commands = useMemo<WorkbenchCommand[]>(
    () => [
      {
        id: 'workbench.action.showCommands',
        title: 'Show Command Palette',
        category: 'Workbench',
        keybinding: '⌘⇧P',
        run: () => setCommandPaletteOpen(true),
      },
      {
        id: 'workbench.action.openPreview',
        title: 'Open Preview Webview',
        category: 'Webview',
        run: () => {
          setActivePanel('preview')
          setPanelVisible(true)
        },
      },
      {
        id: 'workbench.action.toggleTheme',
        title: 'Toggle Color Theme',
        category: 'Preferences',
        run: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
      },
      {
        id: 'editor.action.formatDocument',
        title: 'Format Document',
        category: 'Editor',
        keybinding: '⌘J',
        run: () => {
          formatFile(selectedFileName)
          setOutput((logs) => [`Format applied to ${selectedFileName}`, ...logs])
        },
      },
      {
        id: 'ai.explainSelection',
        title: 'AI: Explain Selection',
        category: 'AI',
        run: () => askAi('explain-selection'),
      },
      {
        id: 'ai.generateComponent',
        title: 'AI: Generate Component Example',
        category: 'AI',
        run: () => askAi('generate-component'),
      },
      {
        id: 'workspace.applyEdit',
        title: 'Apply Pending WorkspaceEdit',
        category: 'Workspace',
        run: applyWorkspaceEdit,
      },
    ],
    [formatFile, pendingEdit, selectedFileName, workspaceFiles],
  )

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
    window.location.hash = compress(JSON.stringify(files))
  }, [files])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandOrControl = event.metaKey || event.ctrlKey
      if (commandOrControl && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <PlaygroundContext.Provider
      value={{
        activeActivity,
        activePanel,
        aiMessages,
        applyWorkspaceEdit,
        askAi,
        closeTab,
        commandPaletteOpen,
        commands,
        discardWorkspaceEdit,
        executeCommand,
        files,
        formatFile,
        openTabs,
        output,
        panelVisible,
        pendingEdit,
        removeFile,
        selectedFileName,
        setActiveActivity,
        setActivePanel,
        setCommandPaletteOpen,
        setFiles,
        setPanelVisible,
        setSelectedFileName,
        setTheme,
        theme,
        tree,
        updateFileName,
        updateFileValue,
        workspaceFiles,
        addFile,
      }}
    >
      {props.children}
    </PlaygroundContext.Provider>
  )
}
