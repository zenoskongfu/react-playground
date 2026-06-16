/**
 * PlaygroundContext.tsx — 全局状态容器
 *
 * 这个文件承担两个职责：
 *
 * 1. 类型导出（Type Hub）
 *    项目中所有跨文件共享的类型都定义在这里，其他文件通过 import type 引入，
 *    避免类型定义散落在各处。这是整个项目的"类型注册表"。
 *
 * 2. Provider 组合（Service Composition）
 *    PlaygroundProvider 把 4 个 service hook 的返回值组合成一个统一的 Context，
 *    所有子组件通过 useContext(PlaygroundContext) 读取它们需要的状态。
 *
 * 设计参考：VSCode OSS 的 IInstantiationService（服务注册/注入容器）。
 * 这里用 React Context 模拟相同的模式——把多个独立服务的能力"注入"给整个组件树。
 *
 * ─── 分层关系 ────────────────────────────────────────────────────────────────
 *
 *   PlaygroundProvider（这里）
 *     ├── useWorkspaceFiles    文件管理 + 持久化
 *     ├── useLayoutState       UI 布局状态
 *     ├── useAiAssistant       AI 交互 + WorkspaceEdit 审查
 *     └── useCommands          命令注册表
 *         ↓
 *   PlaygroundContext.Provider  ← 组合后的统一接口
 *         ↓
 *   所有子组件通过 useContext 消费
 */

import { PropsWithChildren, createContext } from 'react'
import { useWorkspaceFiles } from './workbench/services/workspace/useWorkspaceFiles'
import { useLayoutState } from './workbench/services/layout/useLayoutState'
import { useAiAssistant } from './workbench/services/ai/useAiAssistant'
import { useCommands } from './workbench/services/commands/useCommands'

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 编译器和持久化使用的文件格式（精简版，无 UI 字段） */
export interface File {
  name: string
  value: string
  language: string
  dirty?: boolean
}

/** key 为文件路径的文件映射表 */
export interface Files {
  [key: string]: File
}

export type Theme = 'light' | 'dark'
export type ActivityView = 'explorer' | 'search' | 'source-control' | 'extensions' | 'ai'
export type PanelView = 'preview' | 'problems' | 'output'

/** 运行时文件对象，包含 UI 所需的额外字段（dirty、readonly） */
export interface WorkspaceFile {
  path: string
  name: string
  value: string
  language: string
  readonly?: boolean  // 只读文件（如 import-map.json），不允许编辑
  dirty?: boolean     // 是否有未保存的改动（显示文件名旁的 * 号）
}

/** 文件树节点，同时表示文件夹和文件 */
export interface WorkspaceTreeNode {
  path: string
  name: string
  type: 'file' | 'folder'
  children?: WorkspaceTreeNode[]  // 只有 folder 类型才有
  file?: WorkspaceFile            // 只有 file 类型才有
}

/** AI 变更中单个文件的前后内容对比 */
export interface WorkspaceChange {
  path: string
  before: string
  after: string
}

/**
 * WorkspaceEdit：AI 生成的一组文件变更，等待用户在 diff 编辑器里审查。
 * 对应 VSCode 的 vscode.WorkspaceEdit API 概念。
 */
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

/** 命令注册表中的单条命令 */
export interface WorkbenchCommand {
  id: string
  title: string
  category: string          // 命令面板里的分组标题
  keybinding?: string       // 显示用的快捷键文字（如 '⌘J'），不参与实际绑定
  run: () => void
}

export type AiAction =
  | 'explain-selection'
  | 'generate-component'
  | 'generate-test'
  | 'fix-error'
  | 'refactor-file'

// ─── Context 接口 ─────────────────────────────────────────────────────────────

/**
 * PlaygroundContextValue：所有子组件能从 Context 读到的完整接口。
 * 把 4 个 service hook 的公共 API 合并在一起，对消费方透明。
 */
interface PlaygroundContextValue {
  // ── 来自 useWorkspaceFiles ──
  files: Files
  workspaceFiles: Record<string, WorkspaceFile>
  tree: WorkspaceTreeNode[]
  openTabs: string[]
  selectedFileName: string
  setTheme: (theme: Theme) => void
  setSelectedFileName: (fileName: string) => void
  setFiles: (files: Files) => void
  addFile: (fileName: string) => void
  removeFile: (fileName: string) => void
  updateFileName: (oldFileName: string, newFileName: string) => void
  updateFileValue: (fileName: string, value: string) => void
  formatFile: (fileName: string) => void
  closeTab: (fileName: string) => void
  // ── 来自 useLayoutState ──
  activeActivity: ActivityView
  activePanel: PanelView
  panelVisible: boolean
  theme: Theme
  commandPaletteOpen: boolean
  setActiveActivity: (view: ActivityView) => void
  setActivePanel: (view: PanelView) => void
  setPanelVisible: (visible: boolean) => void
  setCommandPaletteOpen: (visible: boolean) => void
  // ── 来自 useAiAssistant ──
  aiMessages: AiMessage[]
  pendingEdit: WorkspaceEdit | null
  output: string[]
  askAi: (action: AiAction) => void
  applyWorkspaceEdit: () => void
  discardWorkspaceEdit: () => void
  // ── 来自 useCommands ──
  commands: WorkbenchCommand[]
  executeCommand: (id: string) => void
}

// createContext 的默认值只在没有 Provider 包裹时使用（一般不会发生），
// 用 as 断言跳过完整初始化，只提供一个最低限度的默认值方便 TypeScript 满意
export const PlaygroundContext = createContext<PlaygroundContextValue>({
  selectedFileName: 'src/App.tsx',
} as PlaygroundContextValue)

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * PlaygroundProvider：把 4 个 service hook 组合为统一的 Context 值。
 *
 * 组合时传入的"slice"对象：
 *   每个 hook 只接收自己真正需要的那部分状态/setter，
 *   而不是整个 workspace 或 layout 对象。
 *   好处：依赖关系显式可见，避免某个 hook 悄悄读取它不应该依赖的状态。
 *
 * 循环导入说明：
 *   useWorkspaceFiles → workbenchEditor（runtime import，需要 releaseModel）
 *   workbenchEditor   → PlaygroundContext（TypeScript type import，编译后被抹除）
 *   PlaygroundContext  → useWorkspaceFiles（runtime import）
 *   ──
 *   workbenchEditor 对 PlaygroundContext 的 import 是纯类型，运行时不存在，
 *   所以模块加载顺序不会形成死锁，不是真正的循环依赖。
 */
export const PlaygroundProvider = (props: PropsWithChildren) => {
  const workspace = useWorkspaceFiles()
  const layout = useLayoutState()

  // 把 workspace 和 layout 里 AI 需要的部分传给 useAiAssistant
  const ai = useAiAssistant(
    {
      workspaceFiles: workspace.workspaceFiles,
      selectedFileName: workspace.selectedFileName,
      setWorkspaceFiles: workspace.setWorkspaceFiles,
      setOpenTabs: workspace.setOpenTabs,
      setSelectedFileNameRaw: workspace.setSelectedFileNameRaw,
    },
    { setActiveActivity: layout.setActiveActivity },
  )

  // commands 依赖三个 hook 的能力
  const { commands, executeCommand } = useCommands({
    workspace: {
      workspaceFiles: workspace.workspaceFiles,
      selectedFileName: workspace.selectedFileName,
      formatFile: workspace.formatFile,
    },
    layout: {
      setCommandPaletteOpen: layout.setCommandPaletteOpen,
      setActivePanel: layout.setActivePanel,
      setPanelVisible: layout.setPanelVisible,
      setTheme: layout.setTheme,
    },
    ai: {
      pendingEdit: ai.pendingEdit,
      setOutput: ai.setOutput,
      askAi: ai.askAi,
      applyWorkspaceEdit: ai.applyWorkspaceEdit,
    },
  })

  return (
    <PlaygroundContext.Provider
      value={{
        // workspace
        files: workspace.files,
        workspaceFiles: workspace.workspaceFiles,
        tree: workspace.tree,
        openTabs: workspace.openTabs,
        selectedFileName: workspace.selectedFileName,
        setSelectedFileName: workspace.setSelectedFileName,
        setFiles: workspace.setFiles,
        addFile: workspace.addFile,
        removeFile: workspace.removeFile,
        updateFileName: workspace.updateFileName,
        updateFileValue: workspace.updateFileValue,
        formatFile: workspace.formatFile,
        closeTab: workspace.closeTab,
        // layout
        theme: layout.theme,
        activeActivity: layout.activeActivity,
        activePanel: layout.activePanel,
        panelVisible: layout.panelVisible,
        commandPaletteOpen: layout.commandPaletteOpen,
        setTheme: layout.setTheme,
        setActiveActivity: layout.setActiveActivity,
        setActivePanel: layout.setActivePanel,
        setPanelVisible: layout.setPanelVisible,
        setCommandPaletteOpen: layout.setCommandPaletteOpen,
        // ai
        aiMessages: ai.aiMessages,
        pendingEdit: ai.pendingEdit,
        output: ai.output,
        askAi: ai.askAi,
        applyWorkspaceEdit: ai.applyWorkspaceEdit,
        discardWorkspaceEdit: ai.discardWorkspaceEdit,
        // commands
        commands,
        executeCommand,
      }}
    >
      {props.children}
    </PlaygroundContext.Provider>
  )
}
