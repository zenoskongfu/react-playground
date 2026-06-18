/**
 * commandsStore — 命令注册表（Zustand 版）
 *
 * 取代了原来的 useCommands hook。
 *
 * 与 hook 版本的关键区别：
 *   - hook 版本用 useMemo 管理 commands 数组，因为 run 函数通过闭包捕获外部状态，
 *     状态变化时必须重建整个数组才能让 run 读到最新值。
 *   - store 版本的 run 函数通过 getState() 在执行时动态读取最新状态，
 *     commands 数组可以是静态的——不依赖任何响应式数据，无需 useMemo。
 *
 * commands 数组在 store 初始化时创建一次，之后永远不变。
 * executeCommand 同样稳定，不会引起任何组件的重渲染。
 */

import { create } from 'zustand'
import type { WorkbenchCommand } from '../../PlaygroundContext'
import { useWorkspaceStore } from './workspaceStore'
import { useLayoutStore } from './layoutStore'
import { useAiStore } from './aiStore'

interface CommandsState {
  commands: WorkbenchCommand[]
}

interface CommandsActions {
  executeCommand: (id: string) => void
}

export type CommandsStore = CommandsState & CommandsActions

export const useCommandsStore = create<CommandsStore>((_set, get) => ({
  commands: [
    {
      id: 'workbench.action.showCommands',
      title: 'Show Command Palette',
      category: 'Workbench',
      keybinding: '⌘⇧P',
      // run 在执行时调用 getState()，始终读到最新的 store 状态，没有闭包过期问题
      run: () => useLayoutStore.getState().setCommandPaletteOpen(true),
    },
    {
      id: 'workbench.action.openPreview',
      title: 'Open Preview Webview',
      category: 'Webview',
      run: () => {
        useLayoutStore.getState().setActivePanel('preview')
        useLayoutStore.getState().setPanelVisible(true)
      },
    },
    {
      id: 'workbench.action.toggleTheme',
      title: 'Toggle Color Theme',
      category: 'Preferences',
      run: () => useLayoutStore.getState().setTheme((c) => (c === 'dark' ? 'light' : 'dark')),
    },
    {
      id: 'editor.action.formatDocument',
      title: 'Format Document',
      category: 'Editor',
      keybinding: '⌘J',
      run: () => {
        const { selectedFileName, formatFile } = useWorkspaceStore.getState()
        formatFile(selectedFileName)
        useAiStore.getState().setOutput((logs) => [`Format applied to ${selectedFileName}`, ...logs])
      },
    },
    {
      id: 'ai.explainSelection',
      title: 'AI: Explain Selection',
      category: 'AI',
      run: () => useAiStore.getState().askAi('explain-selection'),
    },
    {
      id: 'ai.generateComponent',
      title: 'AI: Generate Component Example',
      category: 'AI',
      run: () => useAiStore.getState().askAi('generate-component'),
    },
    {
      id: 'workspace.applyEdit',
      title: 'Apply Pending WorkspaceEdit',
      category: 'Workspace',
      run: () => useAiStore.getState().applyWorkspaceEdit(),
    },
  ],

  executeCommand: (id) => {
    const command = get().commands.find((item) => item.id === id)
    command?.run()
    useLayoutStore.getState().setCommandPaletteOpen(false)
  },
}))
