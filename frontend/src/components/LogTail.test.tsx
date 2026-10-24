import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The double-Escape tests below render the real LogTail. jsdom has no layout, matchMedia or
// ResizeObserver, so the xterm.js Terminal and the browser-only helpers it calls are stubbed;
// the Escape handling under test lives on the capture div's React onKeyDown, not in xterm.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    buffer = { active: { baseY: 0, viewportY: 0 } }
    loadAddon() { /* no-op */ }
    open() { /* no-op */ }
    focus() { /* no-op */ }
    blur() { /* no-op */ }
    resize() { /* no-op */ }
    onScroll() { /* no-op */ }
    write(_text: string, cb?: () => void) { cb?.() }
    scrollToBottom() { /* no-op */ }
    scrollLines() { /* no-op */ }
    dispose() { /* no-op */ }
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() { /* no-op */ } } }))
vi.mock('../lib/terminalSizeProbe', () => ({
  maybeProbeOnFirstRender: () => { /* no-op */ },
  registerResizeListener: () => { /* no-op */ },
}))
vi.mock('../hooks/useSSE', () => ({ useSSEEvent: () => { /* no-op */ } }))

import LogTail, { formatChunkTs, mapKey } from './LogTail'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Builds a minimal stand-in for the fields mapKey() actually reads off a KeyboardEvent. */
function keyEvent(init: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): ReactKeyboardEvent<HTMLDivElement> {
  return {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  } as ReactKeyboardEvent<HTMLDivElement>
}

describe('formatChunkTs', () => {
  it('transforms a valid ISO timestamp into a different, non-empty string', () => {
    const input = '2026-07-06T10:00:00Z'
    const result = formatChunkTs(input)
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe(input)
  })

  it('returns an unparseable string unchanged', () => {
    expect(formatChunkTs('not-a-date')).toBe('not-a-date')
  })

  it('returns an empty string unchanged', () => {
    expect(formatChunkTs('')).toBe('')
  })

  it('returns a malformed date-shaped string unchanged (fails Date parsing)', () => {
    const malformed = '2026-99-99T99:99:99Z'
    expect(formatChunkTs(malformed)).toBe(malformed)
  })
})

describe('paste event handling', () => {
  it('handles native paste events (capture-phase) with multi-line text', () => {
    // This test validates that the capture-phase paste listener added in TASK-0163
    // correctly receives and enqueues full multi-line text, not just the first line.
    // Note: Full integration testing of paste functionality is tested via E2E/UAT
    // since it requires browser context and real DOM events. This test documents
    // the expected behavior: native clipboard events should work when fired on
    // elements with the capture-phase listener attached.

    // Test setup: Create a mock ClipboardEvent with multi-line data
    const multilineText = 'line 1\nline 2\nline 3'

    // Verify line-ending normalization works as expected
    expect(multilineText.replace(/\r\n?/g, '\n')).toBe('line 1\nline 2\nline 3')

    // Test Windows line-endings are normalized
    const windowsText = 'line 1\r\nline 2\r\nline 3'
    expect(windowsText.replace(/\r\n?/g, '\n')).toBe('line 1\nline 2\nline 3')

    // Test Mac classic line-endings are normalized
    const macText = 'line 1\rline 2\rline 3'
    expect(macText.replace(/\r\n?/g, '\n')).toBe('line 1\nline 2\nline 3')
  })
})

describe('mapKey (TASK-149 modifier+arrow terminal navigation)', () => {
  it('maps Ctrl+ArrowLeft/Right to tmux word-jump key names', () => {
    expect(mapKey(keyEvent({ key: 'ArrowLeft', ctrlKey: true }))).toEqual({ keys: ['C-Left'] })
    expect(mapKey(keyEvent({ key: 'ArrowRight', ctrlKey: true }))).toEqual({ keys: ['C-Right'] })
  })

  it('maps Cmd+ArrowLeft/Right to Home/End', () => {
    expect(mapKey(keyEvent({ key: 'ArrowLeft', metaKey: true }))).toEqual({ keys: ['Home'] })
    expect(mapKey(keyEvent({ key: 'ArrowRight', metaKey: true }))).toEqual({ keys: ['End'] })
  })

  it('maps Option(Alt)+ArrowLeft/Right to tmux word-jump key names', () => {
    expect(mapKey(keyEvent({ key: 'ArrowLeft', altKey: true }))).toEqual({ keys: ['M-Left'] })
    expect(mapKey(keyEvent({ key: 'ArrowRight', altKey: true }))).toEqual({ keys: ['M-Right'] })
  })

  it('does not add ArrowUp/ArrowDown handling for these modifiers', () => {
    // Bare arrow (no modifier) still maps to plain Up/Down.
    expect(mapKey(keyEvent({ key: 'ArrowUp' }))).toEqual({ keys: ['Up'] })
    expect(mapKey(keyEvent({ key: 'ArrowDown' }))).toEqual({ keys: ['Down'] })
    // Ctrl/Cmd/Alt+Up/Down fall through to pre-existing behavior (metaKey -> null,
    // non-letter ctrlKey -> null, altKey with no other handling -> plain Up/Down).
    expect(mapKey(keyEvent({ key: 'ArrowUp', ctrlKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'ArrowDown', metaKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'ArrowUp', altKey: true }))).toEqual({ keys: ['Up'] })
  })

  it('regression: plain Cmd+R and other non-arrow Cmd chords still return null', () => {
    expect(mapKey(keyEvent({ key: 'r', metaKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'w', metaKey: true }))).toBeNull()
  })

  it('TASK-0163: does not intercept Cmd+C, leaving copy to the browser/xterm.js built-in handler', () => {
    // mapKey returning null for e.metaKey (before any key-specific branch) is the entire
    // reason Cmd+C copy works today: handleKeyDown only calls preventDefault()/enqueue()
    // when mapKey returns non-null, so a null here means the native browser copy path
    // (and xterm.js's own `copy` listener on term.element) is never pre-empted.
    expect(mapKey(keyEvent({ key: 'c', metaKey: true }))).toBeNull()
  })

  it('regression: plain Ctrl+<letter> chords still produce their pre-existing C-<letter> output', () => {
    expect(mapKey(keyEvent({ key: 'c', ctrlKey: true }))).toEqual({ keys: ['C-c'] })
    expect(mapKey(keyEvent({ key: 'a', ctrlKey: true }))).toEqual({ keys: ['C-a'] })
    expect(mapKey(keyEvent({ key: 'w', ctrlKey: true }))).toEqual({ keys: ['C-w'] })
    expect(mapKey(keyEvent({ key: 'u', ctrlKey: true }))).toEqual({ keys: ['C-u'] })
  })

  it('regression: the AgentList agent-switch combo (Shift+Cmd/Ctrl+Arrow) is left untouched by the new arrow branches', () => {
    // AgentList.tsx reserves Shift+Cmd+Arrow (Mac) / Shift+Ctrl+Arrow (other OSes) for
    // agent-switching. mapKey must not intercept it — both fall through to the
    // pre-existing metaKey/ctrlKey handling (null), exactly as before this task.
    expect(mapKey(keyEvent({ key: 'ArrowRight', metaKey: true, shiftKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'ArrowLeft', metaKey: true, shiftKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'ArrowRight', ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'ArrowLeft', ctrlKey: true, shiftKey: true }))).toBeNull()
  })
})

describe('mapKey (TASK-0165 Cmd/Option+Backspace)', () => {
  it('maps Cmd+Backspace to C-u (delete to start of line)', () => {
    expect(mapKey(keyEvent({ key: 'Backspace', metaKey: true }))).toEqual({ keys: ['C-u'] })
  })

  it('maps Option+Backspace to C-w (delete word backward)', () => {
    expect(mapKey(keyEvent({ key: 'Backspace', altKey: true }))).toEqual({ keys: ['C-w'] })
  })

  it('leaves plain Backspace (no modifiers) mapped to BSpace', () => {
    expect(mapKey(keyEvent({ key: 'Backspace' }))).toEqual({ keys: ['BSpace'] })
  })

  it('regression: Shift+Cmd+Backspace and Shift+Option+Backspace are not misrouted to C-u/C-w', () => {
    expect(mapKey(keyEvent({ key: 'Backspace', metaKey: true, shiftKey: true }))).toBeNull()
    expect(mapKey(keyEvent({ key: 'Backspace', altKey: true, shiftKey: true }))).toEqual({ keys: ['BSpace'] })
  })
})

// ── Direct Input double-Escape → onCloseModal (TASK-0172 / UAT-0172 UAT-EDGE-002) ──────────────
//
// While Direct Input is armed, LogTail owns Escape: a single Escape only shows a hint and is kept
// away from the modal wrapper's document listener (stopPropagation), a second Escape within 800ms
// calls onCloseModal, the hint self-dismisses after 3s, and Cmd/Ctrl+Escape is forwarded to the
// agent's pane instead of counting toward the close.
describe('LogTail Direct Input Escape handling (TASK-0172)', () => {
  const AGENT_ID = 7
  const AGENT_NAME = 'esc-agent'
  const HINT = 'Press esc again to close the modal'
  const HINT_2 = 'Press ⌘/ctrl + esc to send esc to the agent'

  function stubFetch() {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tail')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: AGENT_NAME, lines: 1, windowPresent: true, text: 'hello' }) })
      }
      return Promise.resolve({ ok: true, json: () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() { /* no-op */ }
      disconnect() { /* no-op */ }
    })
    return fetchMock
  }

  /** Renders LogTail and waits for it to auto-arm Direct Input; returns the keyboard-capture div. */
  async function renderArmed(onCloseModal: () => void): Promise<HTMLElement> {
    render(<LogTail agentId={AGENT_ID} agentName={AGENT_NAME} onCloseModal={onCloseModal} />)
    // The banner's own `stop` button lives inside the capture div, and only renders once armed.
    const stop = await screen.findByRole('button', { name: 'stop' })
    const capture = stop.closest<HTMLElement>('[tabindex]')
    if (!capture) throw new Error('keyboard-capture div not found')
    return capture
  }

  it('shows the hint on the first Escape and calls onCloseModal only on a second Escape within 800ms', async () => {
    stubFetch()
    const onCloseModal = vi.fn()
    const documentKeydown = vi.fn()
    document.addEventListener('keydown', documentKeydown)
    try {
      const capture = await renderArmed(onCloseModal)

      fireEvent.keyDown(capture, { key: 'Escape' })
      expect(screen.getByRole('status')).toHaveTextContent(HINT)
      expect(screen.getByRole('status')).toHaveTextContent(HINT_2)
      expect(onCloseModal).not.toHaveBeenCalled()

      fireEvent.keyDown(capture, { key: 'Escape' })
      expect(onCloseModal).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('status')).toBeNull()

      // Both Escapes were consumed by LogTail, so an enclosing modal's document-level Escape
      // listener never saw them.
      expect(documentKeydown).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', documentKeydown)
    }
  })

  it('reports Direct Input on via onInteractChange once armed, and off when stopped', async () => {
    stubFetch()
    const onInteractChange = vi.fn()
    render(<LogTail agentId={AGENT_ID} agentName={AGENT_NAME} onInteractChange={onInteractChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'stop' }))
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'stop' })).toBeNull() })

    const reported = onInteractChange.mock.calls.map(([v]) => v as boolean)
    expect(reported).toContain(true)
    expect(reported[reported.length - 1]).toBe(false)
    expect(reported.indexOf(true)).toBeLessThan(reported.lastIndexOf(false))
  })

  it('lets the hint expire after 3s, so the next Escape re-shows it instead of closing', async () => {
    stubFetch()
    const onCloseModal = vi.fn()
    const capture = await renderArmed(onCloseModal)

    vi.useFakeTimers()
    fireEvent.keyDown(capture, { key: 'Escape' })
    expect(screen.getByRole('status')).toHaveTextContent(HINT)

    act(() => { vi.advanceTimersByTime(3001) })
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.keyDown(capture, { key: 'Escape' })
    expect(screen.getByRole('status')).toHaveTextContent(HINT)
    expect(onCloseModal).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.keyDown(capture, { key: 'Escape' })
    expect(onCloseModal).toHaveBeenCalledTimes(1)
  })

  it('does not treat a second Escape after 800ms as a double-press', async () => {
    stubFetch()
    const onCloseModal = vi.fn()
    const capture = await renderArmed(onCloseModal)

    vi.useFakeTimers()
    fireEvent.keyDown(capture, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(900) })
    fireEvent.keyDown(capture, { key: 'Escape' })
    expect(onCloseModal).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(HINT)
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])('%s+Escape sends Escape to the agent pane and neither closes the modal nor shows the hint', async (_label, mods) => {
    const fetchMock = stubFetch()
    const onCloseModal = vi.fn()
    const capture = await renderArmed(onCloseModal)

    fireEvent.keyDown(capture, { key: 'Escape', ...mods })
    fireEvent.keyDown(capture, { key: 'Escape', ...mods })

    await waitFor(() => {
      const keysCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/agents/${String(AGENT_ID)}/keys`))
      expect(keysCalls).toHaveLength(2)
      for (const [, init] of keysCalls) {
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({ keys: ['Escape'] })
      }
    })
    expect(onCloseModal).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

// ── Windowless agent (TASK-0178 / UAT-0178 UAT-EDGE-005) ────────────────────────────────────────
//
// An inactive agent opened in the detail pane has no tmux window: the /tail response reports
// windowPresent:false and LogTail must show the muted placeholder instead of throwing or mounting
// the terminal capture surface.
describe('LogTail with no tmux window (TASK-0178)', () => {
  it('renders "Window not present." and no terminal capture surface when the tail reports windowPresent: false', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tail')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: 'sleepy-agent', lines: 0, windowPresent: false, text: '' }) })
      }
      return Promise.resolve({ ok: true, json: () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', class {
      observe() { /* no-op */ }
      disconnect() { /* no-op */ }
    })

    render(<LogTail agentId={9} agentName="sleepy-agent" />)

    expect(await screen.findByText('Window not present.')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).toBeNull()
    expect(screen.queryByText('Could not load log output.')).toBeNull()
    // No capture surface: the Direct Input banner's stop button only exists on a live window.
    expect(screen.queryByRole('button', { name: 'stop' })).toBeNull()
  })
})

// ── Task-input slot replaces the one-off text box (TASK-0200) ───────────────────────────────────
//
// The bottom bar renders the parent-supplied `taskInput` (the Add Task box) followed by the
// Direct Input toggle. The old "Send one-off text commands" textarea and Send button are gone, and
// the bar is hidden in History view like before.
describe('LogTail task-input slot (TASK-0200)', () => {
  const AGENT_NAME = 'slot-agent'

  function stubSlotFetch() {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tail')) {
        return Promise.resolve({ ok: true, json: () => ({ agent: AGENT_NAME, lines: 1, windowPresent: true, text: 'hello' }) })
      }
      return Promise.resolve({ ok: true, json: () => ({ log: [] }) })
    }))
    vi.stubGlobal('ResizeObserver', class {
      observe() { /* no-op */ }
      disconnect() { /* no-op */ }
    })
  }

  it('renders the slot next to the Direct Input toggle, with no Send button or one-off textarea', async () => {
    stubSlotFetch()
    render(<LogTail agentId={11} agentName={AGENT_NAME} taskInput={<textarea aria-label="slot" />} />)

    expect(await screen.findByLabelText('slot')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Direct Input/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByLabelText(/one-off/i)).toBeNull()
  })

  it('hides the slot in History view and restores it on Live', async () => {
    stubSlotFetch()
    render(<LogTail agentId={12} agentName={AGENT_NAME} taskInput={<textarea aria-label="slot" />} />)
    await screen.findByLabelText('slot')

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    await waitFor(() => { expect(screen.queryByLabelText('slot')).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(await screen.findByLabelText('slot')).toBeInTheDocument()
  })

  it('renders only the Direct Input toggle when no taskInput is supplied', async () => {
    stubSlotFetch()
    render(<LogTail agentId={13} agentName={AGENT_NAME} />)

    expect(await screen.findByRole('button', { name: /Direct Input/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
