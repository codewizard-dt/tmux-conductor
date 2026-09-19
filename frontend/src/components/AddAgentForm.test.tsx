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

import { listProjects } from '../lib/api'
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
