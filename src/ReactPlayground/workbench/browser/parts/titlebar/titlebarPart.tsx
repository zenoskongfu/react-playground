import { useShallow } from 'zustand/react/shallow'
import { DownloadOutlined, MoonOutlined, PlayCircleOutlined, SunOutlined } from '@ant-design/icons'
import { useLayoutStore } from '../../../stores/layoutStore'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useCommandsStore } from '../../../stores/commandsStore'
import { downloadFiles } from '../../../../utils'

export default function TitlebarPart() {
  const { setCommandPaletteOpen, setTheme, theme } = useLayoutStore(
    useShallow((s) => ({
      setCommandPaletteOpen: s.setCommandPaletteOpen,
      setTheme: s.setTheme,
      theme: s.theme,
    })),
  )
  const files = useWorkspaceStore((s) => s.files)
  const executeCommand = useCommandsStore((s) => s.executeCommand)

  return (
    <header className="titlebar">
      <div className="traffic-lights">
        <span />
        <span />
        <span />
      </div>
      <button className="command-center" onClick={() => setCommandPaletteOpen(true)}>
        react-playground-project · Command Center
      </button>
      <div className="titlebar-actions">
        <button onClick={() => executeCommand('workbench.action.openPreview')} title="Open preview">
          <PlayCircleOutlined />
        </button>
        <button onClick={() => downloadFiles(files)} title="Download workspace">
          <DownloadOutlined />
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
        >
          {theme === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
      </div>
    </header>
  )
}
