---
id: TASK-130
aliases: [TASK-130]
title: "Dynamic tmux pane sizing from the browser terminal's full-width probe"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-130]]"
tags: [frontend, backend, tmux, terminal, log-tail]
---

# TASK-130 — Dynamic tmux pane sizing from the browser terminal's full-width probe

## Objective

Fix the browser dashboard's terminal text wrapping well short of the panel's actual width. Root cause (see `raw/research/terminal-width-early-wrap/index.md` and `wiki/knowledge/concepts/tmux-headless-window-sizing.md`): `tmux capture-pane -p` bakes hard line-wraps into plain text at the pane's *own* current width, and the conductor's headless tmux session (never attached by a real terminal) has never had its window size configured anywhere, so every window sits at tmux's factory default `80x24` — confirmed live against the running session. No frontend/xterm.js/CSS change can undo a wrap that already happened server-side.

Per explicit product direction, the fix is **dynamic, not a static config default**: the first time any terminal renders in the browser, compute the widest realistic panel size and push it to the backend, which resizes the shared tmux session's window size for every agent at once. The same calculation re-runs only on a genuine browser window resize — never on every subsequent agent card/modal open.

## Approach

**Why a "full-width probe" instead of measuring whatever terminal opens first**: `LogTail` renders in two very different-width contexts — the compact accordion card and the wide `AgentDetailModal` (`fixed inset-0` overlay, `absolute inset-4 md:inset-8` panel, `p-5` inner padding — see `frontend/src/components/AgentList.tsx` lines 654–767). If the calculation used whichever terminal happened to mount first, a small card opening first would undersize the *shared* tmux window for every agent, silently reintroducing the exact bug this task fixes. Instead, build a hidden DOM element that reproduces the modal's real Tailwind geometry (same `inset-4`/`md:inset-8`/`p-5` classes, so its rendered width tracks the same responsive breakpoints as the real modal) and measure against that, regardless of which LogTail surface actually triggers the probe.

**Why an actual xterm.js Terminal + FitAddon inside the probe instead of hand-computing `pixelWidth / charWidth`**: font metrics (monospace advance width at 11px, browser/OS font substitution, DPI) are exactly what `FitAddon.fit()` already resolves correctly for the real `LogTail` terminal — reusing the identical mechanism guarantees the probed `cols`/`rows` match what the real terminal would compute at that width, with zero risk of drift between a hand-rolled formula and xterm's actual layout.

**Why "first render, then only on resize" (not on every agent open)**: the target tmux window size is a single global value shared by every agent's window — recomputing and re-POSTing it every time a new agent card mounts would be redundant work with no visual benefit (the shared size is already correct), and would risk resize-thrashing multiple agents' panes on every accordion expand/collapse. A module-level one-shot guard plus a single debounced `resize` listener matches the actual invalidation event: the size only needs to change when the viewport itself changes.

**Why the backend applies the new size to *every existing* window, not just future ones**: agents are typically already spawned and running before the dashboard is opened in a browser tab. Only setting `default-size` (which governs *newly created* windows) would leave every already-running agent's pane at the stale size until it happened to be respawned — defeating the fix for the common case.

## Steps

### 1. Backend: new `/api/terminal-size` endpoint  <!-- agent: general-purpose -->

- [x] In `host-server/state.ts`, add a helper near the other tmux `spawnSync` wrappers (`capturePaneTail`/`capturePaneTailRaw`/`readTmuxWindowInventory`):
  - `applyGlobalPaneSize(sessionName: string, cols: number, rows: number): { ok: boolean; resizedWindows: number; error?: string }`
  - Runs, in order, via `spawnSync('tmux', [...])` with the existing `TMUX_SYNC_TIMEOUT_MS` timeout pattern already used in this file:
    1. `set-option -g window-size manual`
    2. `set-option -g default-size <cols>x<rows>`
    3. `list-windows -t <sessionName> -F '#{window_name}'` to enumerate every current window
    4. `resize-window -t <sessionName>:<windowName> -x <cols> -y <rows>` for each window name returned
  - If the session doesn't exist yet (step 1 or 3 fails / non-zero exit), return `{ ok: false, resizedWindows: 0, error: '...' }` — never throw. This must be a soft no-op, not a crash, since the dashboard can be opened before any agent session exists.
- [x] In `host-server/index.ts`, register `POST /api/terminal-size`:
  - Body schema: `{ cols: number, rows: number }`. Validate both are integers within sane bounds — reject (400) outside `cols: 20–500`, `rows: 10–200` (mirrors the kind of bounds-checking already used for other POST bodies in this file — grep an existing validated route for the house style before writing this one).
  - Calls `applyGlobalPaneSize(conf.sessionName, cols, rows)`. Returns `200 { cols, rows, resizedWindows }` on success, or `503 { error }` when `ok: false` (session not up yet — not a client error, so not 400).
  - No auth/rate-limiting needed (single-user local system, matches every other route in this file).

<!-- Updated: 2026-08-15 15:10 -->

### 2. Frontend: the full-width probe module  <!-- agent: general-purpose -->

- [x] Add `syncTerminalSize(cols: number, rows: number): Promise<void>` to `frontend/src/lib/api.ts` — `POST ${API_BASE}/terminal-size` with `{cols, rows}`, following the existing fetch-wrapper conventions already used for the other POST helpers in this file (e.g. `sendAgentKeys`). Swallow/log network errors — this is a best-effort background sync, never something that should surface an error banner to the user.
- [x] Create `frontend/src/lib/terminalSizeProbe.ts`:
  - A lazily-created, reused (not recreated per call) hidden probe DOM node appended to `document.body`: outer element with the exact classes `fixed inset-4 md:inset-8` (matching `AgentDetailModal`'s panel geometry in `AgentList.tsx` line 661) plus `visibility: hidden; pointer-events: none; z-index: -1` inline styles (do NOT use `display: none` — it collapses layout, which is exactly what must be measured); inner element with `p-5` (matching line 767's body wrapper) wrapping a plain empty div that becomes the xterm mount target.
  - `probeAndSyncTerminalSize()`: mounts a throwaway `Terminal` from `@xterm/xterm` into the inner probe div using the **same** `fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'`, `fontSize: 11`, `lineHeight: 1.1` options as the real terminal in `LogTail.tsx`'s terminal-creation effect (keep these in sync — consider extracting a shared constant both files import, e.g. `frontend/src/lib/terminalTheme.ts`, rather than duplicating the literal object). Loads a `FitAddon`, calls `term.open(innerDiv)` then `fitAddon.fit()`, reads `term.cols`/`term.rows`, disposes the throwaway `Terminal` immediately (do not leak it — the probe DOM node stays, but the xterm instance inside it should not persist between calls). Calls `syncTerminalSize(cols, rows)`.
  - Exports a single module-level `let hasProbedOnce = false` guard and a `maybeProbeOnFirstRender()` that only calls `probeAndSyncTerminalSize()` when `hasProbedOnce` is false, then sets it true.
  - Exports a `registerResizeListener()` that attaches exactly one `window.addEventListener('resize', debounced)` (guard against double-registration with its own module-level `let registered = false`), debounced ~400ms (trailing), calling `probeAndSyncTerminalSize()` directly (not `maybeProbeOnFirstRender` — a resize should always re-probe).

<!-- Updated: 2026-08-15 15:25 -->

### 3. Frontend: wire the triggers into LogTail  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, inside the existing terminal-creation `useEffect` (gated on `loaded && windowPresent && xtermContainerRef.current`, where the real `Terminal`/`FitAddon` are constructed), call `maybeProbeOnFirstRender()` and `registerResizeListener()` (both imported from `terminalSizeProbe.ts`) once per effect run — both are internally guarded so calling them from every `LogTail` instance's mount is safe and only has an effect the very first time / on registration.
- [x] Do not call the probe from anywhere else (no per-render, no on-focus, no on-fit-addon-resize-observer trigger) — the ResizeObserver-driven `fitAddon.fit()` calls already in this effect are for the *local* xterm display grid and must stay untouched; they are unrelated to the global pane-size sync.

<!-- Updated: 2026-08-15 15:38 -->

### 4. Remove the superseded static-default groundwork  <!-- agent: general-purpose -->

- [x] Confirm `conductor.conf`, `scripts/conductor.sh`, and `scripts/spawn.sh` have no `default-size`/`window-size`/`resize-window` additions from any earlier exploration of this bug (there should be none yet on `main` — this step is a guard against accidentally shipping both the static and dynamic approaches, not an expectation of finding anything).

<!-- Updated: 2026-08-15 15:42 -->

### 5. Manual verification  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] With the host-server and frontend dev servers running (`make dev`) and at least one agent spawned, open the dashboard, open any agent's terminal (card or modal), then run `tmux list-windows -a -F '#{session_name}:#{window_name} #{window_width}x#{window_height}'` on the host and confirm every window now reports a width well above 80 (matching the browser viewport, not the default 80x24).
- [DEFERRED-TO-UAT] Resize the browser window (or open the expanded/focused modal at a different width) and re-run the same `tmux list-windows` command after ~1s — confirm the size updates.
- [DEFERRED-TO-UAT] Confirm a long-running command's output (e.g. `ls -la` on a wide directory, or ask an agent to print a long line) now fills the terminal panel width instead of wrapping at ~80 columns.
- [DEFERRED-TO-UAT] Confirm opening a *second* agent's terminal after the first does **not** trigger another `POST /api/terminal-size` call (check the Network tab) — only the first-ever terminal render and actual window resizes should fire it.

These four checks are runtime/E2E by nature (dev servers, browser, tmux geometry, Network tab) — deferred to UAT generation per this task's own note below, rather than executed inline during tackle.

No automated UAT for this task — the observable behavior is tmux window geometry and visual terminal wrapping, which isn't meaningfully assertable via a curl-based API check; verification is the manual protocol above.

<!-- Updated: 2026-08-15 15:45 -->
