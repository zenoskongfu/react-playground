import { useShallow } from 'zustand/react/shallow'
import { CloseOutlined, FileOutlined } from '@ant-design/icons'
import { useWorkspaceStore } from '../../../stores/workspaceStore'

export default function EditorGroupsView() {
  const { closeTab, openTabs, selectedFileName, setSelectedFileName, workspaceFiles } =
    useWorkspaceStore(
      useShallow((s) => ({
        closeTab: s.closeTab,
        openTabs: s.openTabs,
        selectedFileName: s.selectedFileName,
        setSelectedFileName: s.setSelectedFileName,
        workspaceFiles: s.workspaceFiles,
      })),
    )

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
