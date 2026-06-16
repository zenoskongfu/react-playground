import { useContext, useMemo, useState } from 'react'
import {
  ApiOutlined,
  BranchesOutlined,
  CloseOutlined,
  CodeOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FileOutlined,
  FolderOpenOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { PlaygroundContext, WorkspaceTreeNode } from './PlaygroundContext'
import Preview from './components/Preview'
import WorkbenchEditor from './components/WorkbenchEditor'
import { downloadFiles } from './utils'
import './index.scss'

const activityItems = [
  { id: 'explorer', label: 'Explorer', icon: FolderOpenOutlined },
  { id: 'search', label: 'Search', icon: SearchOutlined },
  { id: 'source-control', label: 'Source Control', icon: BranchesOutlined },
  { id: 'extensions', label: 'Extensions', icon: ApiOutlined },
  { id: 'ai', label: 'AI Assistant', icon: RobotOutlined },
] as const

function TreeNodeView(props: { node: WorkspaceTreeNode; depth: number }) {
  const { node, depth } = props
  const { removeFile, selectedFileName, setSelectedFileName, updateFileName } =
    useContext(PlaygroundContext)
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)

  if (node.type === 'folder') {
    return (
      <div>
        <button
          className="tree-row tree-row--folder"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => setExpanded((value) => !value)}
          title={node.path}
        >
          <FolderOpenOutlined />
          <span>{node.name}</span>
        </button>
        {expanded
          ? node.children?.map((child) => (
              <TreeNodeView key={child.path} node={child} depth={depth + 1} />
            ))
          : null}
      </div>
    )
  }

  const onRename = () => {
    const parent = node.path.split('/').slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${draftName}` : draftName
    updateFileName(node.path, nextPath)
    setEditing(false)
  }

  return (
    <div
      className={selectedFileName === node.path ? 'tree-row-wrap active' : 'tree-row-wrap'}
      style={{ paddingLeft: 10 + depth * 14 }}
    >
      <button
        className="tree-row tree-row--file"
        onClick={() => setSelectedFileName(node.path)}
        title={node.path}
      >
        <FileOutlined />
        {editing ? (
          <input
            value={draftName}
            onBlur={onRename}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onRename()
              if (event.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
        ) : (
          <span onDoubleClick={() => !node.file?.readonly && setEditing(true)}>
            {node.name}
            {node.file?.dirty ? ' *' : ''}
          </span>
        )}
      </button>
      {!node.file?.readonly ? (
        <button className="tree-action" onClick={() => removeFile(node.path)} title="Delete file">
          <CloseOutlined />
        </button>
      ) : null}
    </div>
  )
}

function PrimarySideBar() {
  const { activeActivity, addFile, aiMessages, tree } = useContext(PlaygroundContext)

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
          <span>{activityItems.find((item) => item.id === activeActivity)?.label}</span>
        </header>
        <div className="placeholder-panel">
          <CodeOutlined />
          <p>This view is registered by the local Extension Host adapter.</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="primary-sidebar">
      <header className="sidebar-header">
        <span>Explorer</span>
        <button onClick={() => addFile('src/components/NewComponent.tsx')} title="New file">
          <FileAddOutlined />
        </button>
      </header>
      <div className="workspace-name">WORKSPACE</div>
      <nav className="tree">
        {tree.map((node) => (
          <TreeNodeView key={node.path} node={node} depth={0} />
        ))}
      </nav>
    </aside>
  )
}

function EditorTabs() {
  const { closeTab, openTabs, selectedFileName, setSelectedFileName, workspaceFiles } =
    useContext(PlaygroundContext)

  return (
    <div className="editor-tabs">
      {openTabs.map((path) => {
        const file = workspaceFiles[path]
        if (!file) return null
        return (
          <button
            key={path}
            className={selectedFileName === path ? 'editor-tab active' : 'editor-tab'}
            onClick={() => setSelectedFileName(path)}
            title={path}
          >
            <FileOutlined />
            <span>{file.name}</span>
            {file.dirty ? <b>*</b> : null}
            <CloseOutlined
              onClick={(event) => {
                event.stopPropagation()
                closeTab(path)
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

function CommandPalette() {
  const { commandPaletteOpen, commands, executeCommand, setCommandPaletteOpen } =
    useContext(PlaygroundContext)
  const [query, setQuery] = useState('')
  const filteredCommands = useMemo(
    () =>
      commands.filter((command) =>
        `${command.category} ${command.title}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [commands, query],
  )

  if (!commandPaletteOpen) return null

  return (
    <div className="command-backdrop" onClick={() => setCommandPaletteOpen(false)}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command"
          autoFocus
        />
        <div className="command-list">
          {filteredCommands.map((command) => (
            <button key={command.id} onClick={() => executeCommand(command.id)}>
              <span>{command.title}</span>
              <small>
                {command.category}
                {command.keybinding ? ` · ${command.keybinding}` : ''}
              </small>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function Panel() {
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
        {activePanel === 'preview' ? <Preview /> : null}
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

function AiActionBar() {
  const { askAi, pendingEdit, applyWorkspaceEdit, discardWorkspaceEdit } =
    useContext(PlaygroundContext)

  return (
    <div className="ai-action-bar">
      <button onClick={() => askAi('explain-selection')}>Explain</button>
      <button onClick={() => askAi('generate-component')}>Generate Component</button>
      <button onClick={() => askAi('refactor-file')}>Refactor</button>
      {pendingEdit ? (
        <div className="review-actions">
          <span>{pendingEdit.title}</span>
          <button onClick={discardWorkspaceEdit}>Discard</button>
          <button className="primary" onClick={applyWorkspaceEdit}>
            Apply WorkspaceEdit
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function ReactPlayground() {
  const {
    activeActivity,
    files,
    pendingEdit,
    selectedFileName,
    setActiveActivity,
    setCommandPaletteOpen,
    setTheme,
    theme,
    updateFileValue,
    workspaceFiles,
    executeCommand,
  } = useContext(PlaygroundContext)
  const selectedFile = workspaceFiles[selectedFileName]

  return (
    <div className={`workbench ${theme}`}>
      <CommandPalette />
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

      <div className="workbench-body">
        <nav className="activity-bar">
          {activityItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={activeActivity === item.id ? 'active' : ''}
                onClick={() => setActiveActivity(item.id)}
                title={item.label}
              >
                <Icon />
              </button>
            )
          })}
          <button className="settings" title="Settings">
            <SettingOutlined />
          </button>
        </nav>

        <PrimarySideBar />

        <main className="editor-workbench">
          <EditorTabs />
          <AiActionBar />
          <WorkbenchEditor
            file={selectedFile}
            pendingEdit={pendingEdit}
            theme={theme}
            onChange={updateFileValue}
            onFormat={() => executeCommand('editor.action.formatDocument')}
          />
          <Panel />
        </main>
      </div>

      <footer className="statusbar">
        <span>main</span>
        <span>FileSystemProvider: local-adapter</span>
        <span>Extension Host: mock</span>
        <span>{selectedFileName}</span>
      </footer>
    </div>
  )
}
