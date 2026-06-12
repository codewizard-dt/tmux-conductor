import AddAgentForm from './components/AddAgentForm'
import AgentList from './components/AgentList'

export default function App() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-line bg-canvas/80 px-6 backdrop-blur-sm">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-ink">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          conductor
        </span>
      </header>
      <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
        <AddAgentForm />
        <AgentList />
      </main>
    </div>
  )
}
