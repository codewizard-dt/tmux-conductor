import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloneAgent, createWorktreeForAgent, restartAgentWindow, restartBgProcess } from './api'

// TASK-0210: createWorktreeForAgent surfaces the backend's real `{ error }` reason, and turns a
// fetch network failure (TypeError) into a friendly host-server-unreachable message.
describe('createWorktreeForAgent error reasons (TASK-0210)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws the backend { error } reason verbatim on a non-ok response', async () => {
    const reason = "failed to create git worktree at /x/y: a branch named 'conductor/7' already exists"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: reason }) }))
    await expect(createWorktreeForAgent(7)).rejects.toThrow(reason)
  })

  it('falls back to HTTP <status> when the error body has no { error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) }))
    await expect(createWorktreeForAgent(7)).rejects.toThrow('HTTP 502')
  })

  it('converts a fetch TypeError into "Could not reach the host-server"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(createWorktreeForAgent(7)).rejects.toThrow('Could not reach the host-server')
  })

  it('rethrows non-TypeError failures unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    await expect(createWorktreeForAgent(7)).rejects.toThrow('boom')
  })
})

// TASK-0213: cloneAgent sends no body for a plain clone and a JSON `{ forceWorktree: true }` body
// (with a Content-Type header) when the caller asks for a forced worktree.
describe('cloneAgent request shape (TASK-0213)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubOk() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({ agent: { id: 9 } }) })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends a bodiless POST by default', async () => {
    const fetchMock = stubOk()
    await cloneAgent(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/agents\/3\/clone$/)
    expect(init).toEqual({ method: 'POST' })
  })

  it('sends a bodiless POST when forceWorktree is false', async () => {
    const fetchMock = stubOk()
    await cloneAgent(3, { forceWorktree: false })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init).toEqual({ method: 'POST' })
  })

  it('sends a JSON { forceWorktree: true } body when forced', async () => {
    const fetchMock = stubOk()
    await cloneAgent(3, { forceWorktree: true })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init.body).toBe(JSON.stringify({ forceWorktree: true }))
  })

  it('surfaces the backend { error } reason on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: 'workdir is not inside a git repository' }) }))
    await expect(cloneAgent(3, { forceWorktree: true })).rejects.toThrow('workdir is not inside a git repository')
  })
})

// TASK-0216: restartAgentWindow = DELETE then POST /agents/:id/window, with staged failure messages.
describe('restartAgentWindow (TASK-0216)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const ok = { ok: true, status: 200, json: () => Promise.resolve({}) }

  it('issues DELETE then POST against the same window URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok)
    vi.stubGlobal('fetch', fetchMock)
    await restartAgentWindow(5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url1, init1] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url1).toMatch(/\/agents\/5\/window$/)
    expect(url2).toBe(url1)
    expect(init1.method).toBe('DELETE')
    expect(init2.method).toBe('POST')
  })

  it('short-circuits when DELETE fails (no POST)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({ error: 'kill failed' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(restartAgentWindow(5)).rejects.toThrow('kill failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a staged message when the relaunch POST fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'spawn failed' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(restartAgentWindow(5)).rejects.toThrow('Window stopped but relaunch failed: spawn failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

// TASK-0206: restartBgProcess = bodiless, header-less POST /bg-processes/:slug/restart (a dashboard
// caller, exempt from the agent cooldown) with known statuses mapped to readable messages.
describe('restartBgProcess (TASK-0206)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const result = { ok: true, name: 'acme-web', restartedAt: '2026-09-20T10:00:00.000Z', mechanism: 'respawn-window' }

  it('POSTs the encoded slug with no body and no X-Conductor-Agent header, returning the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(result) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(restartBgProcess('acme web')).resolves.toEqual(result)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/bg-processes\/acme%20web\/restart$/)
    expect(init).toEqual({ method: 'POST' })
  })

  it.each([
    [409, {}, 'The conductor tmux session is not running'],
    [404, { error: "bg process 'x' not found" }, 'Process no longer exists (it may have been removed)'],
    [500, { error: 'restart failed', step: 'pipe-pane', status: 1 }, 'Restart failed at step pipe-pane'],
    [500, {}, 'Restart failed'],
    [429, { error: 'restart cooldown', retryAfterS: 30 }, 'Restarted too recently, try again in 30s'],
    [403, { error: 'restart denied: different-project' }, 'restart denied: different-project'],
    [502, {}, 'HTTP 502'],
  ])('maps a %i response to a readable message', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json: () => Promise.resolve(body) }))
    await expect(restartBgProcess('acme-web')).rejects.toThrow(message)
  })

  it('falls back to HTTP <status> when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) }))
    await expect(restartBgProcess('acme-web')).rejects.toThrow('HTTP 502')
  })

  it('converts a fetch TypeError into "Could not reach the host-server"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(restartBgProcess('acme-web')).rejects.toThrow('Could not reach the host-server')
  })
})
