import AddAgentForm from '../components/AddAgentForm'
import InactiveAgentsPanel from '../components/InactiveAgentsPanel'
import AgentList from '../components/AgentList'
import ErrorBoundary from '../components/ErrorBoundary'

export default function AgentsPage() {
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
      <div className="grid grid-cols-2 gap-4">
        <AddAgentForm />
        <InactiveAgentsPanel />
      </div>
      <ErrorBoundary>
        <AgentList />
      </ErrorBoundary>
    </main>
  )
}