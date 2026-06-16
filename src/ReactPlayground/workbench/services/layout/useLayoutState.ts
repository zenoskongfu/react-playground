/**
 * useLayoutState — 工作台布局状态服务
 *
 * 管理所有与"界面显示状态"相关的值，对应 VSCode OSS 的 ILayoutService 层：
 *   - 颜色主题（theme）
 *   - 当前激活的活动栏图标（activeActivity）→ 决定侧边栏显示什么
 *   - 底部面板的显示/隐藏和当前标签（panelVisible / activePanel）
 *   - 命令面板的显示/隐藏（commandPaletteOpen）
 *
 * 这个 hook 完全自包含，不依赖其他 service hook，
 * 也是拆分出来的几个 hook 里最简单的一个。
 */

import { useEffect, useState } from 'react'
import type { ActivityView, PanelView, Theme } from '../../../PlaygroundContext'

export function useLayoutState() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [activeActivity, setActiveActivity] = useState<ActivityView>('explorer')
  const [activePanel, setActivePanel] = useState<PanelView>('preview')
  const [panelVisible, setPanelVisible] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  /**
   * 注册全局快捷键 Cmd+Shift+P 打开命令面板。
   *
   * 为什么放在这个 hook 里而不是在 useCommands 里？
   * 快捷键监听是布局层面的行为（打开/关闭一个 UI 元素），
   * 不是命令执行逻辑，放这里职责更清晰。
   *
   * 注意：Monaco 编辑器会拦截 Cmd+Shift+P，
   * WorkbenchEditor.tsx 里用 addCommand 把这个快捷键转发给了 window，
   * 所以在编辑器里也能触发这个监听器。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandOrControl = event.metaKey || event.ctrlKey
      if (commandOrControl && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault() // 阻止浏览器默认的打印对话框（Ctrl+P）
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, []) // 依赖数组为 []：只注册一次，通过闭包始终调用 setCommandPaletteOpen

  return {
    theme,
    activeActivity,
    activePanel,
    panelVisible,
    commandPaletteOpen,
    // 直接返回 React 原始的 setter，
    // 调用方可以传值（setTheme('dark')）也可以传函数（setTheme(c => ...)）
    setTheme,
    setActiveActivity,
    setActivePanel,
    setPanelVisible,
    setCommandPaletteOpen,
  }
}
