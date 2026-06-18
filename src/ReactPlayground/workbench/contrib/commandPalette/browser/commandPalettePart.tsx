import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLayoutStore } from '../../../stores/layoutStore'
import { useCommandsStore } from '../../../stores/commandsStore'

export default function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen } = useLayoutStore(
    useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      setCommandPaletteOpen: s.setCommandPaletteOpen,
    })),
  )
  const { commands, executeCommand } = useCommandsStore(
    useShallow((s) => ({ commands: s.commands, executeCommand: s.executeCommand })),
  )
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
