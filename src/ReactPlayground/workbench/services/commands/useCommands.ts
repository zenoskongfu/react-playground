/**
 * useCommands — 命令注册表服务
 *
 * 对应 VSCode OSS 的 ICommandService 层：
 *   - 维护一个命令列表（commands），每个命令有 id、标题、分类、快捷键和执行函数
 *   - 提供 executeCommand(id) 方法统一触发命令
 *
 * 命令面板（Cmd+P）会展示这里注册的所有命令，
 * 各个 UI 组件通过 executeCommand 触发操作，而不是直接调用函数，
 * 这样可以集中管理所有操作，未来也方便添加权限控制、日志记录等。
 *
 * 依赖的三个 slice（通过参数传入而非 Context）：
 *   - workspace：formatFile、selectedFileName
 *   - layout：setTheme、setActivePanel 等
 *   - ai：askAi、applyWorkspaceEdit 等
 */

import { useMemo } from 'react'
import type { AiAction, Theme, WorkbenchCommand, WorkspaceEdit, WorkspaceFile } from '../../../PlaygroundContext'

// ─── 依赖 slice 类型声明 ─────────────────────────────────────────────────────

type WorkspaceSlice = {
  workspaceFiles: Record<string, WorkspaceFile>
  selectedFileName: string
  formatFile: (fileName: string) => void
}

type LayoutSlice = {
  setCommandPaletteOpen: (open: boolean) => void
  setActivePanel: (panel: 'preview' | 'problems' | 'output') => void
  setPanelVisible: (visible: boolean) => void
  // 用 React.Dispatch 类型而不是 (theme: Theme) => void，
  // 是为了能使用函数式更新：setTheme(current => ...)
  // 这样切换主题时不需要读取当前主题值，避免旧值闭包问题
  setTheme: React.Dispatch<React.SetStateAction<Theme>>
}

type AiSlice = {
  pendingEdit: WorkspaceEdit | null
  setOutput: React.Dispatch<React.SetStateAction<string[]>>
  askAi: (action: AiAction) => void
  applyWorkspaceEdit: () => void
}

type CommandsParams = {
  workspace: WorkspaceSlice
  layout: LayoutSlice
  ai: AiSlice
}

// ─── Hook 主体 ───────────────────────────────────────────────────────────────

export function useCommands({ workspace, layout, ai }: CommandsParams) {
  /**
   * commands：命令注册表，用 useMemo 缓存，只在依赖项变化时重新创建。
   *
   * 依赖项包含 selectedFileName 和 workspaceFiles 的原因：
   *   format 命令的 run 函数里会读取 selectedFileName，
   *   applyWorkspaceEdit 的 run 函数依赖当前的 workspaceFiles，
   *   如果这些值过期了，执行命令会产生错误行为。
   *
   * 注意：这些命令对象会被传给命令面板组件渲染，
   * useMemo 避免了每次渲染都重新创建列表（引用变化会导致命令面板不必要地重渲染）。
   */
  const commands = useMemo<WorkbenchCommand[]>(
    () => [
      {
        id: 'workbench.action.showCommands',
        title: 'Show Command Palette',
        category: 'Workbench',
        keybinding: '⌘⇧P',
        run: () => layout.setCommandPaletteOpen(true),
      },
      {
        id: 'workbench.action.openPreview',
        title: 'Open Preview Webview',
        category: 'Webview',
        run: () => {
          layout.setActivePanel('preview')
          layout.setPanelVisible(true)
        },
      },
      {
        id: 'workbench.action.toggleTheme',
        title: 'Toggle Color Theme',
        category: 'Preferences',
        // 函数式更新：不依赖闭包里的 theme 值，直接基于当前值计算下一个值
        run: () => layout.setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
      },
      {
        id: 'editor.action.formatDocument',
        title: 'Format Document',
        category: 'Editor',
        keybinding: '⌘J',
        run: () => {
          workspace.formatFile(workspace.selectedFileName)
          ai.setOutput((logs) => [`Format applied to ${workspace.selectedFileName}`, ...logs])
        },
      },
      {
        id: 'ai.explainSelection',
        title: 'AI: Explain Selection',
        category: 'AI',
        run: () => ai.askAi('explain-selection'),
      },
      {
        id: 'ai.generateComponent',
        title: 'AI: Generate Component Example',
        category: 'AI',
        run: () => ai.askAi('generate-component'),
      },
      {
        id: 'workspace.applyEdit',
        title: 'Apply Pending WorkspaceEdit',
        category: 'Workspace',
        run: ai.applyWorkspaceEdit,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // workspaceFiles 在依赖数组里，是因为 applyWorkspaceEdit 内部读取了它（通过闭包）
    [workspace.formatFile, workspace.selectedFileName, ai.pendingEdit, workspace.workspaceFiles],
  )

  /**
   * executeCommand：按 ID 查找并执行命令。
   *
   * 执行后关闭命令面板（无论命令是否成功），模仿 VSCode 的行为。
   * 不用 useCallback 包裹——这个函数只在用户交互时调用，不作为 effect 依赖。
   */
  const executeCommand = (id: string) => {
    const command = commands.find((item) => item.id === id)
    command?.run()
    layout.setCommandPaletteOpen(false)
  }

  return { commands, executeCommand }
}
