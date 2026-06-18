import { useShallow } from 'zustand/react/shallow'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { useWorkspaceStore } from '../stores/workspaceStore'
import { useLayoutStore } from '../stores/layoutStore'
import { useAiStore } from '../stores/aiStore'
import WorkbenchEditor from './parts/editor/workbenchEditor'
import EditorGroupsView from './parts/editor/editorGroupsView'
import PanelPart from './parts/panel/panelPart'
import TitlebarPart from './parts/titlebar/titlebarPart'
import ActivitybarPart from './parts/activitybar/activitybarPart'
import StatusbarPart from './parts/statusbar/statusbarPart'
import ExplorerView from '../contrib/explorer/browser/explorerView'
import CommandPalette from '../contrib/commandPalette/browser/commandPalettePart'
import AiActionBar from '../contrib/aiAssistant/browser/aiActionBar'
import '../../index.scss'

export default function Workbench() {
  const { selectedFileName, workspaceFiles, updateFileValue, formatFile } = useWorkspaceStore(
    useShallow((s) => ({
      selectedFileName: s.selectedFileName,
      workspaceFiles: s.workspaceFiles,
      updateFileValue: s.updateFileValue,
      formatFile: s.formatFile,
    })),
  )
  const theme = useLayoutStore((s) => s.theme)
  const pendingEdit = useAiStore((s) => s.pendingEdit)

  const selectedFile = workspaceFiles[selectedFileName]

  return (
    <div className={`workbench ${theme}`}>
      <CommandPalette />
      <TitlebarPart />

      <div className="workbench-body">
        <ActivitybarPart />
        <Allotment className="workbench-main-split" defaultSizes={[24, 76]}>
          <Allotment.Pane minSize={220} preferredSize={286}>
            <ExplorerView />
          </Allotment.Pane>
          <Allotment.Pane minSize={420}>
            <main className="editor-workbench">
              <EditorGroupsView />
              <AiActionBar />
              <Allotment vertical className="workbench-editor-split" defaultSizes={[72, 28]}>
                <Allotment.Pane minSize={220}>
                  <WorkbenchEditor
                    file={selectedFile}
                    allFiles={workspaceFiles}
                    pendingEdit={pendingEdit}
                    theme={theme}
                    onChange={updateFileValue}
                    onFormat={() => formatFile(selectedFileName)}
                  />
                </Allotment.Pane>
                <Allotment.Pane minSize={120}>
                  <PanelPart />
                </Allotment.Pane>
              </Allotment>
            </main>
          </Allotment.Pane>
        </Allotment>
      </div>

      <StatusbarPart />
    </div>
  )
}
