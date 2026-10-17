import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BgRestartButton } from './BgRestartButton'

// vitest.config doesn't set `test.globals`, so RTL's auto-cleanup never registers.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const OK_BODY = { ok: true, name: 'acme-web', restartedAt: '2026-09-20T10:00:00.000Z', mechanism: 'respawn-window' }

function okResponse() {
  return { ok: true, status: 200, json: () => Promise.resolve(OK_BODY) }
}

function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: () => Promise.resolve(body) }
}

function stubFetch(impl: () => unknown) {
  const fetchMock = vi.fn().mockImplementation(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function renderButton(props: Partial<React.ComponentProps<typeof BgRestartButton>> = {}) {
  return render(
    <BgRestartButton slug="acme-web" label="web" windowPresent projectName="acme" {...props} />,
  )
}

describe('BgRestartButton (TASK-0206)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('opens the confirmation on click and sends nothing', () => {
    const fetchMock = stubFetch(() => okResponse())
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))

    expect(screen.getByText(/Stops the running process/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the project alongside the process in the dialog, and warns that others are interrupted', () => {
    stubFetch(() => okResponse())
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))

    expect(screen.getByText('Restart "web" (project acme)?')).toBeTruthy()
    expect(screen.getByText(/Everyone in project acme who is using it will be interrupted/)).toBeTruthy()
  })

  it('Cancel closes the dialog without a request', () => {
    const fetchMock = stubFetch(() => okResponse())
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText(/Stops the running process/)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Escape closes the dialog without a request', () => {
    const fetchMock = stubFetch(() => okResponse())
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText(/Stops the running process/)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Confirm POSTs the encoded slug to /restart with no X-Conductor-Agent header', async () => {
    const fetchMock = stubFetch(() => okResponse())
    renderButton({ slug: 'acme web/x' })

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.endsWith('/bg-processes/acme%20web%2Fx/restart')).toBe(true)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).has('X-Conductor-Agent')).toBe(false)
    expect(init.body).toBeUndefined()
  })

  it('is disabled and reads "Restarting…" while in flight, and a second click sends nothing', async () => {
    let resolveFetch: (r: unknown) => void = () => undefined
    const fetchMock = stubFetch(() => new Promise((resolve) => { resolveFetch = resolve }))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    const button = screen.getByRole('button', { name: 'Restart web' })
    expect(button).toBeDisabled()
    expect(button.textContent).toBe('Restarting…')

    fireEvent.click(button)
    await flush()
    expect(screen.queryByText(/Stops the running process/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => { resolveFetch(okResponse()) })
    await flush()
    expect(screen.getByRole('button', { name: 'Restart web' })).toBeEnabled()
  })

  it('calls onRestarted with the result and shows a transient "Restarted" notice', async () => {
    stubFetch(() => okResponse())
    const onRestarted = vi.fn()
    renderButton({ onRestarted })

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(onRestarted).toHaveBeenCalledTimes(1)
    expect(onRestarted).toHaveBeenCalledWith(OK_BODY)
    expect(screen.getByText('Restarted')).toBeTruthy()
    expect(screen.getByText('Restarted').getAttribute('aria-live')).toBe('polite')

    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.queryByText('Restarted')).toBeNull()
  })

  it.each([
    [409, {}, 'The conductor tmux session is not running'],
    [404, {}, 'Process no longer exists (it may have been removed)'],
    [500, { error: 'restart failed', step: 'respawn-window', status: 1 }, 'Restart failed at step respawn-window'],
    [429, { error: 'restart cooldown', retryAfterS: 12 }, 'Restarted too recently, try again in 12s'],
  ])('renders the mapped message for a %i and re-enables the button', async (status, body, message) => {
    stubFetch(() => errResponse(status, body))
    const onRestarted = vi.fn()
    renderButton({ onRestarted })

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByRole('button', { name: 'Restart web' })).toBeEnabled()
    expect(onRestarted).not.toHaveBeenCalled()
    expect(screen.queryByText('Restarted')).toBeNull()
  })

  it('renders "Could not reach the host-server" on a network failure and re-enables the button', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()

    expect(screen.getByRole('alert').textContent).toBe('Could not reach the host-server')
    expect(screen.getByRole('button', { name: 'Restart web' })).toBeEnabled()
  })

  it('clears a previous error when the next attempt starts', async () => {
    const responses = [errResponse(409, {}), okResponse()]
    stubFetch(() => responses.shift())
    renderButton()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Restarted')).toBeTruthy()
  })

  it('is a "Start" with adapted copy when the window is not present', async () => {
    const fetchMock = stubFetch(() => okResponse())
    renderButton({ windowPresent: false })

    const trigger = screen.getByRole('button', { name: 'Start web' })
    expect(trigger.textContent).toBe('Start')
    fireEvent.click(trigger)

    expect(screen.getByText('Start "web" (project acme)?')).toBeTruthy()
    expect(screen.getByText('Starts web; its window is not running.')).toBeTruthy()
    expect(screen.queryByText(/Stops the running process/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Started')).toBeTruthy()
  })
})
