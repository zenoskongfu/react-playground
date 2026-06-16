import { useContext, useEffect, useState } from 'react'
import { CodeOutlined, FileAddOutlined } from '@ant-design/icons'
import { PlaygroundContext, WorkspaceTreeNode } from '../../../../PlaygroundContext'
import { FileDraftRow, PendingTreeFile, TreeNodeView } from './fileTree'

const activityLabels: Record<string, string> = {
  search: 'Search',
  'source-control': 'Source Control',
  extensions: 'Extensions',
}

export default function ExplorerView() {
  const { activeActivity, addFile, aiMessages, selectedFileName, tree } =
    useContext(PlaygroundContext)
  const [pendingFile, setPendingFile] = useState<PendingTreeFile | null>(null)
  const [selectedTreePath, setSelectedTreePath] = useState(selectedFileName)
  const [selectedTreeType, setSelectedTreeType] = useState<WorkspaceTreeNode['type']>('file')

  useEffect(() => {
    setSelectedTreePath(selectedFileName)
    setSelectedTreeType('file')
  }, [selectedFileName])

  if (activeActivity === 'ai') {
    return (
      <aside className="primary-sidebar">
        <header className="sidebar-header">
          <span>AI Assistant</span>
        </header>
        <div className="chat-log">
          {aiMessages.map((message) => (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <span>{message.role === 'assistant' ? 'Copilot' : 'You'}</span>
              <p>{message.content}</p>
            </article>
          ))}
        </div>
      </aside>
    )
  }

  if (activeActivity !== 'explorer') {
    return (
      <aside className="primary-sidebar">
        <header className="sidebar-header">
          <span>{activityLabels[activeActivity] ?? activeActivity}</span>
        </header>
        <div className="placeholder-panel">
          <CodeOutlined />
          <p>This view is registered by the local Extension Host adapter.</p>
        </div>
      </aside>
    )
  }

  const handleSelectNode = (path: string, type: WorkspaceTreeNode['type']) => {
    setSelectedTreePath(path)
    setSelectedTreeType(type)
  }

  const handleCreateFile = () => {
    const parentPath =
      selectedTreeType === 'folder'
        ? selectedTreePath
        : selectedTreePath.includes('/')
          ? selectedTreePath.split('/').slice(0, -1).join('/')
          : ''
    setPendingFile({ parentPath })
  }

  const commitPendingFile = (name: string, parentPath: string) => {
    const nextPath = parentPath ? `${parentPath}/${name}` : name
    addFile(nextPath)
    setSelectedTreePath(nextPath)
    setSelectedTreeType('file')
    setPendingFile(null)
  }

  return (
    <aside className="primary-sidebar">
      <header className="sidebar-header">
        <span>Explorer</span>
        <button onClick={handleCreateFile} title="New file">
          <FileAddOutlined />
        </button>
      </header>
      <div className="workspace-name">WORKSPACE</div>
      <nav className="tree">
        {pendingFile?.parentPath === '' ? (
          <FileDraftRow
            depth={0}
            onCancel={() => setPendingFile(null)}
            onSubmit={(name) => commitPendingFile(name, '')}
          />
        ) : null}
        {tree.map((node) => (
          <TreeNodeView
            key={node.path}
            depth={0}
            node={node}
            onCancelPendingFile={() => setPendingFile(null)}
            onCreatePendingFile={commitPendingFile}
            onSelectNode={handleSelectNode}
            pendingFile={pendingFile}
            selectedTreePath={selectedTreePath}
          />
        ))}
      </nav>
    </aside>
  )
}
