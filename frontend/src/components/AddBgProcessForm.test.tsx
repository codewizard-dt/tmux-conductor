import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'

// Mock the API module + git-root hook so no real network runs; the form fetches the
// project list on mount, following AddAgentForm.test.tsx.
vi.mock('../lib/api', () => ({
  API_BASE: 'http://localhost:8788/api',
  listProjects: vi.fn(),
}))
vi.mock('../lib/useGitRoot', () => ({
  useGitRoot: () => ({ loading: false, isRepo: false, isInsideRepo: false, gitRoot: null }),
}))

import { listProjects } from '../lib/api'
import AddBgProcessForm from './AddBgProcessForm'

const project = {
  id: 1,
  name: 'demo',
  workdir: '/work/demo',
  defaultLaunchCmd: 'claude',
  createdAt: '2026-01-01T00:00:00Z',
}

// POST /bg-processes resolves with the supplied response (the form no longer
// fetches /status: the Link-to-Agent select was removed in TASK-0197).
function stubFetch(postResponse?: Response) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
    return Promise.resolve(postResponse ?? new Response('{}', { status: 201 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function fillAndSubmit() {
  await screen.findByRole('option', { name: 'demo' })
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dev-server' } })
  fireEvent.change(screen.getByLabelText('Launch Command'), { target: { value: 'npm run dev' } })
  fireEvent.click(screen.getByRole('button', { name: 'Spawn Process' }))
}

describe('AddBgProcessForm', () => {
  it('renders nothing when open is false', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    stubFetch()

    const { container } = render(<AddBgProcessForm open={false} onClose={vi.fn()} />)

    expect(container.firstChild).toBeNull()
    // Mount effects run unconditionally (before the `if (!open) return null`); flush them.
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
  })

  it('renders the modal content when open is true', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    stubFetch()

    render(<AddBgProcessForm open onClose={vi.fn()} />)

    expect(screen.getByText('Add Background Process')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spawn Process' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })
  })

  it('calls onClose on Escape keydown', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    stubFetch()
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    stubFetch()
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on overlay (backdrop) click, but not on a click inside the card', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    stubFetch()
    const onClose = vi.fn()

    const { container } = render(<AddBgProcessForm open onClose={onClose} />)
    await waitFor(() => { expect(listProjects).toHaveBeenCalled() })

    fireEvent.click(screen.getByText('Add Background Process'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.firstChild as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('posts the process and calls onClose on a 201 response', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    const fetchMock = stubFetch(new Response('{}', { status: 201 }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await fillAndSubmit()

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const post = fetchMock.mock.calls.find(([url]) => url.endsWith('/bg-processes'))
    expect(post).toBeDefined()
    expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
      name: 'dev-server',
      workdir: '/work/demo',
      launchCmd: 'npm run dev',
      projectId: 1,
    })
  })

  it('keeps the modal open and shows the error on a 409 response', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    stubFetch(new Response(JSON.stringify({ error: 'name already exists' }), { status: 409 }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await fillAndSubmit()

    expect(await screen.findByText('name already exists')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Add Background Process')).toBeInTheDocument()
  })

  it('shows the fallback error and keeps the modal open when the POST rejects (network failure)', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    vi.stubGlobal('fetch', vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => {
      return Promise.reject(new TypeError('Failed to fetch'))
    }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await fillAndSubmit()

    expect(await screen.findByText('Failed to spawn bg process')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Add Background Process')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spawn Process' })).toBeEnabled()
  })

  it('shows the fallback error and keeps the modal open on a non-JSON 500 response', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    stubFetch(new Response('<html>Internal Server Error</html>', { status: 500 }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await fillAndSubmit()

    expect(await screen.findByText('Failed to spawn bg process')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Add Background Process')).toBeInTheDocument()
  })

  it('shows no "Process spawned" success text after a 201 (the modal just closes)', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    stubFetch(new Response('{}', { status: 201 }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)
    await fillAndSubmit()

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    expect(screen.queryByText(/Process spawned/)).not.toBeInTheDocument()
  })

  it('has no "Link to Agent" input and sends no linkedAgent in the POST body (TASK-0197)', async () => {
    vi.mocked(listProjects).mockResolvedValue([project])
    const fetchMock = stubFetch(new Response('{}', { status: 201 }))
    const onClose = vi.fn()

    render(<AddBgProcessForm open onClose={onClose} />)

    expect(screen.queryByText(/Show advanced/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Link to Agent/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CONDUCTOR_BG_/)).not.toBeInTheDocument()

    await fillAndSubmit()

    await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    const post = fetchMock.mock.calls.find(([url]) => url.endsWith('/bg-processes'))
    const body = JSON.parse(post?.[1]?.body as string) as Record<string, unknown>
    expect(body).toMatchObject({ projectId: 1 })
    expect(body).not.toHaveProperty('linkedAgent')
    expect(body).not.toHaveProperty('linkedAgentId')
  })
})
