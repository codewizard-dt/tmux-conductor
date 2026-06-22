import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  listProjects,
  fetchAgents,
  spawnAgentInProject,
  addTask,
  fetchProjectTasks,
  type Project,
  type ApiAgent,
  type Task,
} from '../lib/api'
import TaskList from '../components/TaskList'

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState<Project | null>(null)

  const [agents, setAgents] = useState<ApiAgent[]>([])
  const [spawnBusy, setSpawnBusy] = useState(false)
  const [spawnError, setSpawnError] = useState<string | null>(null)

  const [tasks, setTasks] = useState<Task[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [taskBusy, setTaskBusy] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)

  async function loadAll() {
    const [projects, allAgents, projectTasks] = await Promise.all([
      listProjects(),
      fetchAgents(),
      fetchProjectTasks(projectId),
    ])
    const found = projects.find((p) => p.id === projectId)
    if (!found) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setProject(found)
    setAgents(allAgents.filter((a) => a.projectId === projectId))
    setTasks(projectTasks)
    setLoading(false)
  }

  useEffect(() => { void loadAll() }, [])

  async function handleSpawn() {
    if (!project) return
    setSpawnBusy(true)
    setSpawnError(null)
    try {
      await spawnAgentInProject(project.id)
      const allAgents = await fetchAgents()
      setAgents(allAgents.filter((a) => a.projectId === project.id))
    } catch (err: unknown) {
      setSpawnError(err instanceof Error ? err.message : 'Failed to spawn agent')
    } finally {
      setSpawnBusy(false)
    }
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault()
    if (!taskInput.trim() || !project) return
    setTaskBusy(true)
    setTaskError(null)
    try {
      await addTask(taskInput.trim(), { projectId: project.id })
      setTaskInput('')
      const fresh = await fetchProjectTasks(project.id)
      setTasks(fresh)
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Failed to add task')
    } finally {
      setTaskBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <p className="text-[12px] text-muted-2">Loading…</p>
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <Link to="/projects" className="text-[12px] text-muted hover:text-ink">← Projects</Link>
        <p className="mt-4 text-[13px] text-muted-2">Project not found.</p>
      </main>
    )
  }

  if (!project) return null

  const formatted = new Date(project.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-6 px-6 py-8">
      <Link to="/projects" className="w-fit text-[12px] text-muted hover:text-ink">← Projects</Link>

      {/* Header card */}
      <section className="rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <h1 className="font-mono text-[18px] font-semibold text-ink">{project.name}</h1>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Working directory</p>
            <p className="mt-0.5 font-mono text-[12px] text-ink-2">{project.workdir}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Launch command</p>
            <p className="mt-0.5 font-mono text-[12px] text-ink-2">{project.defaultLaunchCmd}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Created</p>
            <p className="mt-0.5 text-[12px] text-muted-2">{formatted}</p>
          </div>
        </div>
      </section>

      {/* Agents card */}
      <section className="rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Agents</h2>
          <button
            type="button"
            onClick={() => { void handleSpawn() }}
            disabled={spawnBusy}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {spawnBusy ? 'Spawning…' : 'Spawn agent'}
          </button>
        </div>
        {spawnError && <p className="mb-2 text-[12px] text-accent-red">{spawnError}</p>}
        {agents.length === 0 ? (
          <p className="text-[12px] text-muted-2">No agents yet. Spawn one to get started.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex items-center gap-3 rounded-[8px] border border-line bg-canvas px-3 py-2"
              >
                <span className="font-mono text-[12px] font-semibold text-ink">{agent.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-2">{agent.workdir}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Task queue card */}
      <section className="rounded-card border border-line bg-white px-5 py-4 shadow-card">
        <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Task queue</h2>
        <TaskList agentName="" tasks={tasks} onReorder={setTasks} />
        <form onSubmit={(e) => { void handleAddTask(e) }} className="mt-3 flex gap-2">
          <input
            type="text"
            value={taskInput}
            onChange={(e) => { setTaskInput(e.target.value) }}
            placeholder="Add a task for this project…"
            className="flex-1 rounded-[7px] border border-line bg-canvas px-3 py-1.5 font-mono text-[12px] text-ink placeholder:text-muted-2 focus:border-accent-blue focus:outline-none"
          />
          <button
            type="submit"
            disabled={taskBusy || !taskInput.trim()}
            className="inline-flex h-8 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >
            {taskBusy ? 'Adding…' : 'Add'}
          </button>
        </form>
        {taskError && <p className="mt-2 text-[12px] text-accent-red">{taskError}</p>}
      </section>
    </main>
  )
}
