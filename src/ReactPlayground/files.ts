import { Files } from './PlaygroundContext'
import importMap from './template/import-map.json?raw'
import AppCss from './template/App.css?raw'
import App from './template/App.tsx?raw'
import main from './template/main.tsx?raw'
import { fileName2Language } from './utils'

export const APP_COMPONENT_FILE_NAME = 'src/App.tsx'
export const IMPORT_MAP_FILE_NAME = 'import-map.json'
export const ENTRY_FILE_NAME = 'src/main.tsx'

export const readOnlyFilePaths = [ENTRY_FILE_NAME, IMPORT_MAP_FILE_NAME]

const createFile = (name: string, value: string) => ({
  name,
  language: fileName2Language(name),
  value,
})

export const initFiles: Files = {
  [ENTRY_FILE_NAME]: createFile(ENTRY_FILE_NAME, main),
  [APP_COMPONENT_FILE_NAME]: createFile(APP_COMPONENT_FILE_NAME, App),
  'src/components/DataCard.tsx': createFile(
    'src/components/DataCard.tsx',
    `interface DataCardProps {
  label: string
  value: string
  trend: string
}

export function DataCard(props: DataCardProps) {
  const { label, value, trend } = props

  return (
    <article className="data-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{trend}</em>
    </article>
  )
}
`,
  ),
  'src/mock/dashboard.json': createFile(
    'src/mock/dashboard.json',
    JSON.stringify(
      [
        { label: 'Deployments', value: '128', trend: '+18%' },
        { label: 'Preview sessions', value: '2.4k', trend: '+34%' },
        { label: 'AI edits reviewed', value: '86', trend: '+12%' },
      ],
      null,
      2,
    ),
  ),
  'src/styles/App.css': createFile('src/styles/App.css', AppCss),
  'docs/Button.md': createFile(
    'docs/Button.md',
    `# Button

This markdown document is part of the virtual workspace and can be edited beside React examples.
`,
  ),
  [IMPORT_MAP_FILE_NAME]: createFile(IMPORT_MAP_FILE_NAME, importMap),
}
