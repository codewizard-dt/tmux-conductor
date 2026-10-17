import { afterAll, describe, expect, it, vi } from 'vitest'

// Mocks xterm.js and the API module. This test targets the module-level once-per-session/
// once-per-resize guards in terminalSizeProbe.ts, not xterm's own rendering — jsdom lacks
// window.matchMedia, which a real xterm.js Terminal needs, so a real Terminal is out of
// scope for this environment without adding a jsdom shim. The guard logic under test only
// depends on `term.cols`/`term.rows` being read and `syncTerminalSize` being called, so a
// minimal stub is a faithful enough double for what's actually being asserted here.
// Real `class` stubs (not vi.fn().mockImplementation(...)) — `new Terminal()` needs a genuine
// constructor, and a mock function's returned-object trick doesn't reliably survive this
// module's ESM live-binding re-export through vi.mock.
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    cols = 137
    rows = 41
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    resize = vi.fn(function (this: { cols: number; rows: number }, cols: number, rows: number) {
      this.cols = cols
      this.rows = rows
    })
  }
  return { Terminal: MockTerminal }
})
vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit = vi.fn()
  }
  return { FitAddon: MockFitAddon }
})
vi.mock('./api', () => ({
  syncTerminalSize: vi.fn(),
}))

import { syncTerminalSize } from './api'
import { SIDEBAR_COLLAPSED_WIDTH_PX, SIDEBAR_WIDTH_PX } from './layoutConstants'
import { setSidebarCollapsed } from './sidebarState'
import {
  maybeProbeOnFirstRender,
  probeAndSyncTerminalSize,
  registerResizeListener,
  reprobeTerminalSize,
} from './terminalSizeProbe'

afterAll(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

// terminalSizeProbe.ts's `hasProbedOnce`/`registered` guards are module-level singletons —
// exactly like the real app, where the module loads once per page lifetime. These cases are
// deliberately sequential (not isolated with vi.resetModules()) so they exercise the guards
// the same way the real app's call sequence does: first render probes, later opens don't,
// only a genuine resize probes again.
describe('terminalSizeProbe — first-render and resize guards (TASK-130)', () => {
  it('probes once on the first call to maybeProbeOnFirstRender', () => {
    maybeProbeOnFirstRender()

    expect(vi.mocked(syncTerminalSize)).toHaveBeenCalledTimes(1)
    // 137 - RIGHT_EDGE_COLUMN_MARGIN (6, see terminalTheme.ts's fitWithRightEdgeMargin)
    expect(vi.mocked(syncTerminalSize)).toHaveBeenCalledWith(131, 41)
  })

  it('does not probe again on subsequent maybeProbeOnFirstRender calls (e.g. opening a second agent terminal)', () => {
    maybeProbeOnFirstRender()
    maybeProbeOnFirstRender()

    // Still just the single call from the previous test's first-ever invocation.
    expect(vi.mocked(syncTerminalSize)).toHaveBeenCalledTimes(1)
  })

  it('registerResizeListener attaches only one resize listener, and a resize always re-probes', () => {
    vi.useFakeTimers()

    // Two registration attempts — if the module-level `registered` guard failed, this would
    // attach two independent 'resize' listeners, and a single resize event would debounce-fire
    // syncTerminalSize twice instead of once.
    registerResizeListener()
    registerResizeListener()

    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(500) // clears the 400ms trailing debounce

    // 1 call carried over from the earlier first-render tests + exactly 1 more for this resize
    // (not 2 more, which a broken double-registration guard would have produced).
    expect(vi.mocked(syncTerminalSize)).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  // Regression test for TASK-131: getProbeMount() previously mounted the throwaway terminal
  // directly inside the `p-5` wrapper, one DOM level shallower than the real terminal's mount
  // point (LogTail's `xtermContainerRef`, which sits inside `captureRef` — a div with an
  // unconditional 1px border). That missing ancestor border let the probe measure 2px more
  // width than the real terminal ever has, enough to compute one extra xterm column at this
  // font size — lines then wrapped, and the cursor drew, one column early. This asserts the
  // fix's DOM shape directly: a bordered wrapper (mirroring `captureRef`) must sit between the
  // `p-5` body wrapper and the terminal's actual mount point.
  it('mounts the throwaway terminal inside a bordered wrapper mirroring LogTail\'s captureRef (TASK-131)', () => {
    const capture = document.body.querySelector('.border.border-line')
    expect(capture).not.toBeNull()

    const mount = capture?.querySelector('.overflow-hidden') ?? null
    expect(mount).not.toBeNull()

    // The bordered wrapper must live inside the `p-5` body-padding element, which must in turn
    // live inside the pane-geometry element — the full ancestry the real terminal actually
    // renders inside (AgentList.tsx's AgentDetailView, in the detail pane right of the sidebar).
    const inner = capture?.parentElement ?? null
    expect(inner?.className).toBe('p-5')

    const outer = inner?.parentElement as HTMLElement | null
    expect(outer?.className).toBe('fixed inset-y-0 right-0')
  })

  // TASK-0173: the terminal now renders in the pane to the right of the sidebar, not in a
  // near-full-viewport overlay, so the probe's hidden node must start at the sidebar's edge —
  // otherwise it over-measures and tmux windows get sized wider than the visible terminal.
  it('positions the probe node to the right of the sidebar using the shared SIDEBAR_WIDTH_PX (TASK-0173)', () => {
    const outer = document.body.querySelector<HTMLElement>('.fixed.inset-y-0.right-0')
    expect(outer).not.toBeNull()
    expect(outer?.style.left).toBe(`${SIDEBAR_WIDTH_PX.toString()}px`)
    expect(outer?.style.visibility).toBe('hidden')
    expect(outer?.style.pointerEvents).toBe('none')
  })

  // TASK-0201: the sidebar can collapse to a narrow rail, so the probe must measure against the
  // live sidebar width rather than the width captured when the node was first created.
  it('positions the probe node at the collapsed rail width after setSidebarCollapsed(true) (TASK-0201)', () => {
    setSidebarCollapsed(true)
    probeAndSyncTerminalSize()

    const outer = document.body.querySelector<HTMLElement>('.fixed.inset-y-0.right-0')
    expect(outer?.style.left).toBe(`${SIDEBAR_COLLAPSED_WIDTH_PX.toString()}px`)
    expect(SIDEBAR_COLLAPSED_WIDTH_PX).toBe(48)
  })

  it('a cached probe mount picks up a sidebar width change between probes (TASK-0201)', () => {
    const before = document.body.querySelector<HTMLElement>('.fixed.inset-y-0.right-0')

    setSidebarCollapsed(false)
    probeAndSyncTerminalSize()

    const after = document.body.querySelector<HTMLElement>('.fixed.inset-y-0.right-0')
    // Same node reused (created once), but its left edge followed the width change.
    expect(after).toBe(before)
    expect(after?.style.left).toBe(`${SIDEBAR_WIDTH_PX.toString()}px`)
    expect(document.body.querySelectorAll('.fixed.inset-y-0.right-0')).toHaveLength(1)
  })

  it('reprobeTerminalSize is debounced: rapid calls coalesce into a single sync (TASK-0201)', () => {
    vi.useFakeTimers()
    const callsBefore = vi.mocked(syncTerminalSize).mock.calls.length

    reprobeTerminalSize()
    reprobeTerminalSize()
    reprobeTerminalSize()
    vi.advanceTimersByTime(500)

    expect(vi.mocked(syncTerminalSize).mock.calls.length).toBe(callsBefore + 1)

    vi.useRealTimers()
  })
})
