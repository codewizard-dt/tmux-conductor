import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mocks the API module so no real network/fetch is involved — AddAgentForm fetches the
// project list on mount (fire-and-forget, non-fatal on failure), and this test needs
// deterministic control over that call so it can flush before assertions/unmount,
// following the pattern in CheckpointList.test.tsx.
vi.mock('../lib/api', () => ({
  API_BASE: 'http://localhost:8788/api',
  listProjects: vi.fn(),
  spawnAgentInProject: vi.fn(),
  createProject: vi.fn(),
}))

import { listProjects, spawnAgentInProject, type Project } from '../lib/api'
import AddAgentForm from './AddAgentForm'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AddAgentForm', () => {
  it('renders nothing when open is false', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    const { container } = render(<AddAgentForm open={false} onClose={vi.fn()} />)

    expect(container.firstChild).toBeNull()
    // The project-list fetch effect still runs on mount regardless of `open` (hooks run
    // unconditionally before the `if (!open) return null` in the component body) — wait
    // for it so the state update doesn't leak into the next test as an act() warning.
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
  })

  it('renders the modal content when open is true', async () => {
    vi.mocked(listProjects).mockResolvedValue([])

    render(<AddAgentForm open onClose={vi.fn()} />)

    expect(screen.getByText('Add Agent')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Working Directory')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spawn Agent' })).toBeInTheDocument()

    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
  })

  it('calls onClose on Escape keydown', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    const onClose = vi.fn()

    render(<AddAgentForm open onClose={onClose} />)
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on overlay (backdrop) click, but not on a click inside the card', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    const onClose = vi.fn()

    const { container } = render(<AddAgentForm open onClose={onClose} />)
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })

    // Click inside the card first — should not close.
    fireEvent.click(screen.getByText('Add Agent'))
    expect(onClose).not.toHaveBeenCalled()

    const overlay = container.firstChild as HTMLElement
    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('AddAgentForm defaultProjectId (TASK-0232)', () => {
  const proj = (id: number, name: string, cmd: string) =>
    ({ id, name, workdir: `/work/${name}`, defaultLaunchCmd: cmd }) as unknown as Project
  const projects = [proj(1, 'alpha', 'claude'), proj(7, 'beta', 'codex')]

  it('preselects the project and applies its default launch command once the list loads', async () => {
    vi.mocked(listProjects).mockResolvedValue(projects)
    render(<AddAgentForm open onClose={vi.fn()} defaultProjectId={7} />)

    await waitFor(() => { expect(screen.getByLabelText('Project')).toHaveValue('7') })
    fireEvent.click(screen.getByText('▸ Show advanced'))
    await waitFor(() => { expect(screen.getByLabelText('Launch Command')).toHaveValue('codex') })
  })

  it('falls back to None when the seeded project is not in the list', async () => {
    vi.mocked(listProjects).mockResolvedValue(projects)
    render(<AddAgentForm open onClose={vi.fn()} defaultProjectId={99} />)

    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
    await waitFor(() => { expect(screen.getByLabelText('Project')).toHaveValue('') })
  })

  it('defaults to None with no prop', async () => {
    vi.mocked(listProjects).mockResolvedValue(projects)
    render(<AddAgentForm open onClose={vi.fn()} />)

    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
    expect(screen.getByLabelText('Project')).toHaveValue('')
  })

  it('does not overwrite a project the user picked before the list resolved', async () => {
    let resolve: (v: Project[]) => void = () => {}
    vi.mocked(listProjects).mockReturnValue(new Promise<Project[]>((r) => { resolve = r }))
    render(<AddAgentForm open onClose={vi.fn()} defaultProjectId={7} />)

    fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } })
    resolve(projects)

    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByLabelText('Project')).toHaveValue('')
    fireEvent.click(screen.getByText('▸ Show advanced'))
    expect(screen.getByLabelText('Launch Command')).not.toHaveValue('codex')
  })

  it('submits with the seeded project id', async () => {
    vi.mocked(listProjects).mockResolvedValue(projects)
    vi.mocked(spawnAgentInProject).mockResolvedValue(undefined)
    render(<AddAgentForm open onClose={vi.fn()} defaultProjectId={7} />)

    await waitFor(() => { expect(screen.getByLabelText('Project')).toHaveValue('7') })
    fireEvent.click(screen.getByRole('button', { name: 'Spawn Agent' }))

    await waitFor(() => { expect(spawnAgentInProject).toHaveBeenCalled() })
    expect(vi.mocked(spawnAgentInProject).mock.calls[0]).toEqual(expect.arrayContaining([7]))
  })
})
