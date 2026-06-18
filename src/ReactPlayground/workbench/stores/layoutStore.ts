/**
 * layoutStore — 工作台布局状态（Zustand 版）
 *
 * 取代了原来的 useLayoutState hook，管理所有与 UI 显示相关的状态：
 *   - 颜色主题（theme）
 *   - 活动栏激活的图标（activeActivity）
 *   - 底部面板状态（activePanel / panelVisible）
 *   - 命令面板的打开/关闭（commandPaletteOpen）
 *
 * 键盘快捷键（Cmd+Shift+P）也在模块级注册，逻辑和 hook 版本一样，
 * 但放在 store 模块而不是 useEffect，只注册一次，不受组件生命周期影响。
 */

import { create } from 'zustand'
import type { ActivityView, PanelView, Theme } from '../../PlaygroundContext'

interface LayoutState {
  theme: Theme
  activeActivity: ActivityView
  activePanel: PanelView
  panelVisible: boolean
  commandPaletteOpen: boolean
}

interface LayoutActions {
  setTheme: (theme: Theme | ((current: Theme) => Theme)) => void
  setActiveActivity: (view: ActivityView) => void
  setActivePanel: (view: PanelView) => void
  setPanelVisible: (visible: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
}

export type LayoutStore = LayoutState & LayoutActions

export const useLayoutStore = create<LayoutStore>((set) => ({
  theme: 'dark',
  activeActivity: 'explorer',
  activePanel: 'preview',
  panelVisible: true,
  commandPaletteOpen: false,

  setTheme: (theme) =>
    set((state) => ({ theme: typeof theme === 'function' ? theme(state.theme) : theme })),
  setActiveActivity: (view) => set({ activeActivity: view }),
  setActivePanel: (view) => set({ activePanel: view }),
  setPanelVisible: (visible) => set({ panelVisible: visible }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}))

// 模块级注册 Cmd+Shift+P 快捷键，只注册一次
// Monaco 编辑器会拦截这个快捷键，WorkbenchEditor 里用 addCommand 把它转发到 window
window.addEventListener('keydown', (event) => {
  const commandOrControl = event.metaKey || event.ctrlKey
  if (commandOrControl && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault()
    useLayoutStore.getState().setCommandPaletteOpen(true)
  }
})
