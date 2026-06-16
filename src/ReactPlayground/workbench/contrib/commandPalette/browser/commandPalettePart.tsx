import { useContext, useMemo, useState } from 'react'
import { PlaygroundContext } from '../../../../PlaygroundContext'

export default function CommandPalette() {
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
