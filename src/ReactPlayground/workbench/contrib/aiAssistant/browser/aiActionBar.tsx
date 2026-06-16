import { useContext } from 'react'
import { PlaygroundContext } from '../../../../PlaygroundContext'

export default function AiActionBar() {
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
