/**
 * PlaygroundContext.tsx — 全局类型注册表
 *
 * 迁移到 Zustand 后，这个文件不再承担 Provider/Context 的运行时职责，
 * 只保留所有跨文件共享的类型定义（Type Hub）。
 *
 * 各 store 和组件通过 import type 引入这里的类型，
 * 保持类型定义集中在一处，便于维护。
 *
 * 状态管理已迁移至：
 *   workbench/stores/workspaceStore.ts  ← 文件系统 + 持久化
 *   workbench/stores/layoutStore.ts     ← UI 布局状态
 *   workbench/stores/aiStore.ts         ← AI 功能 + WorkspaceEdit
 *   workbench/stores/commandsStore.ts   ← 命令注册表
 */

// ─── 文件类型 ─────────────────────────────────────────────────────────────────

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
