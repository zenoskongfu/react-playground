import metrics from './mock/dashboard.json'
import { DataCard } from './components/DataCard'
import './styles/App.css'

function App() {
  return (
    <main className="workspace-preview">
      <section className="preview-header">
        <span>Internal Web IDE</span>
        <h1>React component lab</h1>
        <p>Live preview rendered from the virtual workspace.</p>
      </section>

      <section className="metrics-grid">
        {metrics.map((item) => (
          <DataCard
            key={item.label}
            label={item.label}
            value={item.value}
            trend={item.trend}
          />
        ))}
      </section>
    </main>
  )
}

export default App
