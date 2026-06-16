import { useContext } from 'react'
import { DownloadOutlined, MoonOutlined, PlayCircleOutlined, SunOutlined } from '@ant-design/icons'
import { PlaygroundContext } from '../../../../PlaygroundContext'
import { downloadFiles } from '../../../../utils'

export default function TitlebarPart() {
  const { executeCommand, files, setCommandPaletteOpen, setTheme, theme } =
    useContext(PlaygroundContext)

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
