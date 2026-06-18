import { useWorkspaceStore } from '../../../stores/workspaceStore'

export default function StatusbarPart() {
  const selectedFileName = useWorkspaceStore((s) => s.selectedFileName)

  return (
    <footer className="statusbar">
      <span>main</span>
      <span>FileSystemProvider: local-adapter</span>
      <span>Extension Host: mock</span>
      <span>{selectedFileName}</span>
    </footer>
  )
}
