import { useContext } from 'react'
import { PlaygroundContext } from '../../../../PlaygroundContext'

export default function StatusbarPart() {
  const { selectedFileName } = useContext(PlaygroundContext)

  return (
    <footer className="statusbar">
      <span>main</span>
      <span>FileSystemProvider: local-adapter</span>
      <span>Extension Host: mock</span>
      <span>{selectedFileName}</span>
    </footer>
  )
}
