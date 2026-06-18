import { useShallow } from 'zustand/react/shallow'
import { useAiStore } from '../../../stores/aiStore'

export default function AiActionBar() {
  const { askAi, pendingEdit, applyWorkspaceEdit, discardWorkspaceEdit } = useAiStore(
    useShallow((s) => ({
      askAi: s.askAi,
      pendingEdit: s.pendingEdit,
      applyWorkspaceEdit: s.applyWorkspaceEdit,
      discardWorkspaceEdit: s.discardWorkspaceEdit,
    })),
  )

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
