import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CloseOutlined, FileOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { WorkspaceTreeNode } from '../../../../PlaygroundContext'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

export interface PendingTreeFile {
  parentPath: string
}

export function FileDraftRow(props: {
  depth: number
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const { depth, onCancel, onSubmit } = props
  const [draftName, setDraftName] = useState('')

  const commit = () => {
    const nextName = draftName.trim()
    if (!nextName) {
      onCancel()
      return
    }
    onSubmit(nextName)
  }

  return (
    <div className="tree-row-wrap tree-row-wrap--draft" style={{ paddingLeft: 10 + depth * 14 }}>
      <div className="tree-row tree-row--file">
        <FileOutlined />
        <input
          value={draftName}
          onBlur={commit}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') onCancel()
          }}
          autoFocus
        />
      </div>
    </div>
  )
}

export function TreeNodeView(props: {
  node: WorkspaceTreeNode
  depth: number
  onSelectNode: (path: string, type: WorkspaceTreeNode['type']) => void
  pendingFile: PendingTreeFile | null
  onCancelPendingFile: () => void
  onCreatePendingFile: (name: string, parentPath: string) => void
  selectedTreePath: string
}) {
  const {
    node,
    depth,
    onCancelPendingFile,
    onCreatePendingFile,
    onSelectNode,
    pendingFile,
    selectedTreePath,
  } = props
  const { removeFile, selectedFileName, setSelectedFileName, updateFileName } = useWorkspaceStore(
    useShallow((s) => ({
      removeFile: s.removeFile,
      selectedFileName: s.selectedFileName,
      setSelectedFileName: s.setSelectedFileName,
      updateFileName: s.updateFileName,
    })),
  )
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)

  if (node.type === 'folder') {
    return (
      <div>
        <button
          className={
            selectedTreePath === node.path
              ? 'tree-row tree-row--folder active'
              : 'tree-row tree-row--folder'
          }
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            onSelectNode(node.path, 'folder')
            setExpanded((value) => !value)
          }}
          title={node.path}
        >
          <FolderOpenOutlined />
          <span>{node.name}</span>
        </button>
        {expanded ? (
          <>
            {node.children?.map((child) => (
              <TreeNodeView
                key={child.path}
                depth={depth + 1}
                node={child}
                onCancelPendingFile={onCancelPendingFile}
                onCreatePendingFile={onCreatePendingFile}
                onSelectNode={onSelectNode}
                pendingFile={pendingFile}
                selectedTreePath={selectedTreePath}
              />
            ))}
            {pendingFile?.parentPath === node.path ? (
              <FileDraftRow
                depth={depth + 1}
                onCancel={onCancelPendingFile}
                onSubmit={(name) => onCreatePendingFile(name, node.path)}
              />
            ) : null}
          </>
        ) : null}
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
        onClick={() => {
          onSelectNode(node.path, 'file')
          setSelectedFileName(node.path)
        }}
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
