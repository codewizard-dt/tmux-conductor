import AgentList from '../components/AgentList'
import ErrorBoundary from '../components/ErrorBoundary'

export default function AgentsPage() {
  return (
    <main className="flex h-[calc(100vh-3rem)] w-full flex-col overflow-hidden">
      <ErrorBoundary>
        <AgentList />
      </ErrorBoundary>
    </main>
  )
}