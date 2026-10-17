import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mocks the API module so no real network/fetch is involved — TaskList's group handlers
// (scope-to-project, delete, reorder, jump-to-head) all call through lib/api, and these
// tests need deterministic control over resolve/reject to reach the optimistic-update and
// rollback paths, following the pattern in CheckpointList.test.tsx.
vi.mock('../lib/api', () => ({
  scopeTaskToProject: vi.fn(),
  deleteTask: vi.fn(),
  reorderTasks: vi.fn(),
  jumpTaskToHead: vi.fn(),
}))

import { scopeTaskToProject } from '../lib/api'
import TaskList from './TaskList'
import type { Task } from '../lib/api'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    command: 'do the thing',
    agentId: 5,
    projectId: null,
    position: 0,
    status: 'queued',
    source: 'manual',
    scheduleId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('TaskList command text selectability', () => {
  it('renders the command text as select-text, with no select-none ancestor', () => {
    const task = makeTask()
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={vi.fn()} />)

    const commandEl = screen.getByText(task.command)
    expect(commandEl.className).toContain('select-text')

    let node: HTMLElement | null = commandEl
    while (node) {
      expect(node.className).not.toContain('select-none')
      node = node.parentElement
    }
  })
})

describe('TaskList "→ project" scope button', () => {
  it('renders the button on an agent-scoped task when projectId is provided', () => {
    const task = makeTask({ agentId: 5, projectId: null })
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={vi.fn()} projectId={7} />)

    expect(screen.getByRole('button', { name: `Scope to project: ${task.command}` })).toBeInTheDocument()
  })

  it('does not render the button when projectId is null', () => {
    const task = makeTask({ agentId: 5, projectId: null })
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={vi.fn()} projectId={null} />)

    expect(screen.queryByRole('button', { name: `Scope to project: ${task.command}` })).not.toBeInTheDocument()
  })

  it('does not render the button when projectId is omitted', () => {
    const task = makeTask({ agentId: 5, projectId: null })
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={vi.fn()} />)

    expect(screen.queryByRole('button', { name: `Scope to project: ${task.command}` })).not.toBeInTheDocument()
  })

  it('does not render the button on a task that is already project-scoped', () => {
    const task = makeTask({ agentId: null, projectId: 7 })
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={vi.fn()} projectId={7} />)

    expect(screen.queryByRole('button', { name: `Scope to project: ${task.command}` })).not.toBeInTheDocument()
  })

  it('calls scopeTaskToProject and optimistically reorders on click', async () => {
    vi.mocked(scopeTaskToProject).mockResolvedValue(undefined)
    const task = makeTask({ agentId: 5, projectId: null })
    const onReorder = vi.fn()
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={onReorder} projectId={7} />)

    fireEvent.click(screen.getByRole('button', { name: `Scope to project: ${task.command}` }))

    expect(scopeTaskToProject).toHaveBeenCalledWith(task.id)
    expect(onReorder).toHaveBeenCalledWith([{ ...task, agentId: null, projectId: 7 }])

    await waitFor(() => { expect(scopeTaskToProject).toHaveBeenCalledTimes(1) })
  })

  it('rolls back to the original list and shows an error message when scopeTaskToProject rejects', async () => {
    vi.mocked(scopeTaskToProject).mockRejectedValue(new Error('boom'))
    const task = makeTask({ agentId: 5, projectId: null })
    const onReorder = vi.fn()
    render(<TaskList agentName="agent-a" tasks={[task]} onReorder={onReorder} projectId={7} />)

    fireEvent.click(screen.getByRole('button', { name: `Scope to project: ${task.command}` }))

    expect(onReorder).toHaveBeenNthCalledWith(1, [{ ...task, agentId: null, projectId: 7 }])

    await waitFor(() => {
      expect(onReorder).toHaveBeenNthCalledWith(2, [task])
    })
    await waitFor(() => {
      expect(screen.getByText('Scope to project failed: boom')).toBeInTheDocument()
    })
  })
})
