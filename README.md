# React Playground

[中文文档](./README.zh-CN.md)

A VS Code-inspired React playground that runs entirely in the browser. It provides a Monaco-based editor, a virtual file workspace, live TSX/JSX compilation, and an iframe preview for React examples.

## Features

- VS Code-like workbench with title bar, activity bar, editor tabs, explorer, panel, and status bar
- Monaco editor with per-file models, undo history, language modes, and formatting shortcuts
- Virtual workspace with editable React, TypeScript, CSS, JSON, and Markdown files
- Live preview powered by a Babel compiler running in a Web Worker
- Local module resolution for relative imports, CSS imports, JSON imports, and index files
- Workspace persistence through `localStorage` and URL hash sharing
- Command palette with common workbench, preview, formatting, and AI-review commands
- Mock AI assistant flow with explain, generate, refactor, diff review, apply, and discard states

## Quick Start

```bash
pnpm install
pnpm dev
```

Then open the Vite dev server URL printed in your terminal.

## Scripts

```bash
pnpm dev       # Start the local development server
pnpm build     # Type-check and build for production
pnpm preview   # Preview the production build locally
pnpm lint      # Run ESLint
```

## Project Structure

```text
src/ReactPlayground/
├── PlaygroundContext.tsx        # Shared TypeScript types
├── files.ts                     # Initial virtual workspace template
├── template/                    # Default files loaded into the playground
├── components/
│   └── Message/                 # Floating message component
└── workbench/
    ├── stores/                  # Zustand state stores
    │   ├── workspaceStore.ts    # Files, tree, tabs, persistence
    │   ├── layoutStore.ts       # Theme, panel, activity view, command palette
    │   ├── aiStore.ts           # Mock AI chat and WorkspaceEdit review flow
    │   └── commandsStore.ts     # Command registry
    ├── browser/
    │   ├── workbench.tsx        # Main workbench shell
    │   └── parts/               # Title bar, activity bar, editor, panel, status bar
    └── contrib/
        ├── explorer/            # File tree and sidebar
        ├── commandPalette/      # Command palette UI
        ├── preview/             # Live preview, compiler worker, iframe template
        └── aiAssistant/         # AI action bar
```

## Architecture

The project follows a workbench/contrib layout inspired by VS Code OSS:

| Area | Responsibility |
| --- | --- |
| `workspaceStore` | Virtual files, file tree, selected file, open tabs, persistence |
| `layoutStore` | Theme, active view, panel visibility, command palette state |
| `commandsStore` | Static command registry and command execution |
| `aiStore` | Mock AI messages and pending WorkspaceEdit review |
| `WorkbenchEditor` | Monaco editor lifecycle, model cache, shortcuts, diff mode |
| `compiler.worker` | Babel transform and local module-to-blob resolution |
| `PreviewView` | Debounced compilation, iframe injection, error display |

The main data flow is:

```text
User edits code
  -> Monaco onDidChangeContent
  -> workspaceStore.updateFileValue()
  -> files snapshot changes
  -> PreviewView debounces for 500ms
  -> compiler.worker compiles the entry and local imports
  -> PreviewView injects compiled code into iframe srcDoc
```

Workspace persistence runs separately:

```text
files snapshot changes
  -> module-level Zustand subscription
  -> 1500ms debounce
  -> localStorage + URL hash
  -> dirty flags are cleared
```

## Key Implementation Notes

### Zustand Stores

State is split into focused Zustand stores instead of a single React Context provider. Components subscribe only to the fields they need, so frequent code edits do not force unrelated workbench parts to rerender.

`workspaceFiles` keeps full UI state such as `dirty` and `readonly`. The derived `files` snapshot is intentionally smaller and is used for compilation and persistence. Keeping `dirty` out of `files` prevents persistence from retriggering itself when dirty flags are cleared.

### Monaco Models

Each workspace file maps to a Monaco `ITextModel`, preserving undo history and cursor state across file switches. The editor instance is reused while models are swapped with `editor.setModel(model)`.

The editor also pre-creates models for all workspace files so Monaco TypeScript can resolve sibling imports before a file has been opened.

### Compiler Worker

`compiler.worker.ts` runs Babel in a Web Worker so synchronous transforms do not block typing. It starts from `src/main.tsx`, transforms TSX/JSX with React and TypeScript presets, and rewrites local imports to generated Blob URLs.

Supported local imports include:

- `.ts`, `.tsx`, `.js`, `.jsx`
- `.json` converted to `export default`
- `.css` converted to a style-injection module
- extensionless imports and `index.ts` / `index.tsx`

### Preview Runtime

`PreviewView` schedules compilation with a manual debounce and tags each request with a `requestId`. Older compiler responses are ignored, which prevents stale previews when the user types quickly.

If compilation fails, the iframe keeps the last successful preview instead of flashing blank. A watchdog recreates the Worker if compilation does not respond within five seconds.

### AI Flow

The AI assistant is currently mocked. The review workflow is complete: actions create a pending `WorkspaceEdit`, the editor can display the diff, and the user can apply or discard the change. To connect a real model, replace the mocked response generation inside `aiStore`.

## Development Notes

- Entry file: `src/main.tsx`
- Default editable component: `src/App.tsx`
- Read-only virtual files: `src/main.tsx`, `import-map.json`
- Workspace load priority: URL hash, then `localStorage`, then built-in template
- Main UI shell: `src/ReactPlayground/workbench/browser/workbench.tsx`

## Tech Stack

- React 18
- Vite 5
- TypeScript
- Zustand
- Monaco Editor
- Babel Standalone
- Ant Design
- Allotment
- Sass

