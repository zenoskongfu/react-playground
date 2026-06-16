import { useContext } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { PlaygroundContext } from '../../../../PlaygroundContext'
import PreviewView from '../../../contrib/preview/browser/previewView'

export default function PanelPart() {
  const { activePanel, output, panelVisible, setActivePanel, setPanelVisible } =
    useContext(PlaygroundContext)

  if (!panelVisible) return null

  return (
    <section className="bottom-panel">
      <div className="panel-tabs">
        {(['preview', 'problems', 'output'] as const).map((panel) => (
          <button
            key={panel}
            className={activePanel === panel ? 'active' : ''}
            onClick={() => setActivePanel(panel)}
          >
            {panel}
          </button>
        ))}
        <button className="panel-close" onClick={() => setPanelVisible(false)}>
          <CloseOutlined />
        </button>
      </div>
      <div className="panel-body">
        {activePanel === 'preview' ? <PreviewView /> : null}
        {activePanel === 'problems' ? (
          <div className="problems-view">No problems have been detected in the mock workspace.</div>
        ) : null}
        {activePanel === 'output' ? (
          <pre className="output-view">{output.join('\n')}</pre>
        ) : null}
      </div>
    </section>
  )
}
