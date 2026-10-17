import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({
  addTask: vi.fn(),
  uploadImageForPath: vi.fn(),
}))

vi.mock('../lib/lastPayload', () => ({
  saveLastPayload: vi.fn(),
}))

import { addTask } from '../lib/api'
import type { Task } from '../lib/api'
import { saveLastPayload } from '../lib/lastPayload'
import AddTaskForm from './AddTaskForm'

const ISO_TS = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) as unknown as string

const queuedTask = { id: 1, command: 'do it', agentId: 7 } as unknown as Task

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function typeAndSubmit(text: string) {
  fireEvent.change(screen.getByLabelText('New task text'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
}

describe('AddTaskForm last-payload recording', () => {
  it('records the trimmed text after a queued agent-scoped submit', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    const onAdded = vi.fn()
    render(<AddTaskForm agentId={7} onAdded={onAdded} />)

    typeAndSubmit('do it')

    await waitFor(() => { expect(onAdded).toHaveBeenCalledWith(queuedTask) })
    expect(addTask).toHaveBeenCalledWith('do it', { agentId: 7 })
    expect(saveLastPayload).toHaveBeenCalledTimes(1)
    expect(saveLastPayload).toHaveBeenCalledWith(7, { text: 'do it', ts: ISO_TS, source: 'add-task' })
  })

  it('records after a dispatched (fast path) submit without calling onAdded', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: null, dispatched: true })
    const onAdded = vi.fn()
    render(<AddTaskForm agentId={7} onAdded={onAdded} />)

    typeAndSubmit('run now')

    await waitFor(() => { expect(saveLastPayload).toHaveBeenCalledTimes(1) })
    expect(saveLastPayload).toHaveBeenCalledWith(7, { text: 'run now', ts: ISO_TS, source: 'add-task' })
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('records the trimmed text, not the raw textarea value', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} />)

    typeAndSubmit('   padded text \n')

    await waitFor(() => { expect(saveLastPayload).toHaveBeenCalledTimes(1) })
    expect(addTask).toHaveBeenCalledWith('padded text', { agentId: 7 })
    expect(saveLastPayload).toHaveBeenCalledWith(7, { text: 'padded text', ts: ISO_TS, source: 'add-task' })
  })

  it('records nothing and shows the error when the submit fails', async () => {
    vi.mocked(addTask).mockRejectedValue(new Error('server down'))
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} />)

    typeAndSubmit('will fail')

    expect(await screen.findByText('server down')).toBeTruthy()
    expect(saveLastPayload).not.toHaveBeenCalled()
  })

  it('records only for the agent scope when a project scope is available', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} projectId={3} projectName="proj" />)

    fireEvent.click(screen.getByRole('button', { name: /proj\s*\(project\)/ }))
    typeAndSubmit('project task')

    await waitFor(() => { expect(addTask).toHaveBeenCalledWith('project task', { projectId: 3 }) })
    await waitFor(() => { expect(screen.getByLabelText<HTMLTextAreaElement>('New task text').value).toBe('') })
    expect(saveLastPayload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /this agent\s*\(local\)/ }))
    typeAndSubmit('agent task')

    await waitFor(() => { expect(addTask).toHaveBeenCalledWith('agent task', { agentId: 7 }) })
    await waitFor(() => { expect(saveLastPayload).toHaveBeenCalledTimes(1) })
    expect(saveLastPayload).toHaveBeenCalledWith(7, { text: 'agent task', ts: ISO_TS, source: 'add-task' })
  })

  it('disables Add and records nothing for empty or whitespace-only input', () => {
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} />)
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add task' })
    expect(add.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('New task text'), { target: { value: '   ' } })
    expect(add.disabled).toBe(true)
    fireEvent.click(add)

    expect(addTask).not.toHaveBeenCalled()
    expect(saveLastPayload).not.toHaveBeenCalled()
  })
})

// UAT-0223: exercise the REAL store (not the mock above) so the persisted shape, the
// newest-ts-wins interplay and the storage-failure guard are verified end to end.
describe('AddTaskForm with the real last-payload store (UAT-0223)', () => {
  let actual: typeof import('../lib/lastPayload')

  beforeEach(async () => {
    actual = await vi.importActual<typeof import('../lib/lastPayload')>('../lib/lastPayload')
    actual.__resetLastPayloadCacheForTests()
    vi.mocked(saveLastPayload).mockImplementation(actual.saveLastPayload)
  })

  afterEach(() => {
    vi.mocked(saveLastPayload).mockReset()
    vi.restoreAllMocks()
  })

  it('persists {text, ts, source} under conductor:lastPayload:<numeric agentId> with an ISO ts', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} />)

    typeAndSubmit('  persisted text \n')

    await waitFor(() => { expect(localStorage.getItem('conductor:lastPayload:7')).not.toBeNull() })
    const stored = JSON.parse(localStorage.getItem('conductor:lastPayload:7') ?? 'null') as {
      text: string
      ts: string
      source: string
    }
    expect(stored.text).toBe('persisted text')
    expect(stored.source).toBe('add-task')
    expect(new Date(stored.ts).toISOString()).toBe(stored.ts)
    expect(actual.loadLastPayload(7)?.text).toBe('persisted text')
  })

  it('a later hook value replaces the add-task value; an older hook value does not', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: null, dispatched: true })
    render(<AddTaskForm agentId={7} onAdded={vi.fn()} />)

    typeAndSubmit('typed in box')
    await waitFor(() => { expect(actual.loadLastPayload(7)?.source).toBe('add-task') })
    const boxTs = actual.loadLastPayload(7)?.ts ?? ''

    const older = new Date(Date.parse(boxTs) - 60_000).toISOString()
    expect(actual.saveLastPayload(7, { text: 'stale hook', ts: older, source: 'hook' })).toBe(false)
    expect(actual.loadLastPayload(7)?.text).toBe('typed in box')

    const newer = new Date(Date.parse(boxTs) + 60_000).toISOString()
    expect(actual.saveLastPayload(7, { text: 'hook echo', ts: newer, source: 'hook' })).toBe(true)
    expect(actual.loadLastPayload(7)).toEqual({ text: 'hook echo', ts: newer, source: 'hook' })
  })

  it('records only under the submitting form agentId regardless of what else is mounted', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    render(
      <div data-testid="anywhere">
        <div><AddTaskForm agentId={12} onAdded={vi.fn()} /></div>
      </div>,
    )

    typeAndSubmit('from a relocated mount')

    await waitFor(() => { expect(actual.loadLastPayload(12)?.text).toBe('from a relocated mount') })
    expect(addTask).toHaveBeenCalledWith('from a relocated mount', { agentId: 12 })
    expect(actual.loadLastPayload(7)).toBeNull()
  })

  it('a storage failure adds no console noise and does not turn a successful submit into an error', async () => {
    vi.mocked(addTask).mockResolvedValue({ task: queuedTask, dispatched: false })
    const onAdded = vi.fn()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(<AddTaskForm agentId={7} onAdded={onAdded} />)

    fireEvent.change(screen.getByLabelText('New task text'), { target: { value: 'quota run' } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))

    await waitFor(() => { expect(onAdded).toHaveBeenCalledWith(queuedTask) })
    expect(screen.queryByText('quota')).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(actual.loadLastPayload(7)).toBeNull()
  })
})
