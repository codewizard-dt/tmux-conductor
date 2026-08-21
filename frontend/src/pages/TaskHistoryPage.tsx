import { useEffect, useState } from 'react'
import { fetchTaskHistory, listProjects, type Project, type Task } from '../lib/api'
import { useAgents } from '../lib/useAgents'
import { formatSessionStart } from '../components/AgentList'

export default function TaskHistoryPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { agents } = useAgents()

  useEffect(() => {
    async function load() {
      try {
        const [history, projectList] = await Promise.all([fetchTaskHistory(), listProjects()])
        setError(null)
        setTasks(history)
        setProjects(projectList)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load task history')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const agentName = (id: number | null) => {
    if (id === null) return '—'
    return agents.find((a) => a.id === id)?.name ?? `#${id.toString()}`
  }

  const projectName = (id: number | null) => {
    if (id === null) return '—'
    return projects.find((p) => p.id === id)?.name ?? `#${id.toString()}`
  }

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
      <div className="animate-riseIn rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          Task History
        </h2>

        {error && <p className="text-[12px] text-accent-red">{error}</p>}

        {loading ? (
          <p className="text-[12px] text-muted-2">Loading task history…</p>
        ) : tasks.length === 0 ? (
          <p className="text-[12px] text-muted-2">No completed tasks yet</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-col gap-1 rounded-[8px] border border-line bg-canvas px-3 py-2"
              >
                <span className="block truncate font-mono text-[12px] font-semibold text-ink">
                  {task.command}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-2">
                  <span>Agent: {agentName(task.agentId)}</span>
                  <span>Project: {projectName(task.projectId)}</span>
                  <span>
                    Completed: {task.completedAt ? formatSessionStart(task.completedAt) : '—'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
