---
topic: Redesign the AgentDetail modal — terminal front-and-center/larger, reduce non-terminal noise, shrink Queued Tasks, default to Direct Input on open, double-click terminal to fullscreen
slug: agent-detail-modal-redesign
researched: 2026-08-15
sources: [./sources.md]
---

# Research: AgentDetail Modal Redesign

> The modal's non-terminal chrome is already mostly collapsed by default (Skills/Diff/Usage/Checkpoints are all `<details>` one-liners) — the actual noise is the always-expanded **Details + Queued Tasks** two-column grid sitting above the terminal. Collapsing that grid into two one-line `<details>` rows (matching the existing pattern) is the single highest-leverage layout change and requires no new components. Direct Input and double-click-to-fullscreen are small, isolated wiring changes: `LogTail` is a single-consumer component (only `AgentDetailModal` renders it), so its defaults can be changed directly with no other call site to protect.

## Research Questions
- Where does the AgentDetail modal live and how is its layout structured today?
- What already-collapsed vs. always-expanded sections exist, and which ones are the actual "noise"?
- How does Direct Input (`interacting`) state get initialized/armed today, and can it default on without breaking the existing needs-attention CTA path?
- How does the existing ⌥F / fullscreen toggle (`logExpanded`) work, so double-click can reuse the exact same mechanism?
- Are there other consumers of `LogTail` that a default-behavior change could break?

## Current State (Codebase)

**Component**: `AgentDetailModal` in `frontend/src/components/AgentList.tsx:514-869`. Rendered via `createPortal` into `document.body`, full-viewport overlay (`fixed inset-4 md:inset-8`, `flex flex-col`).

Layout, top to bottom, inside `<div className="flex flex-col flex-1 overflow-hidden p-5">` (AgentList.tsx:733):

1. **Header row** (AgentList.tsx ~528-620): name/label, ProjectBadge, StatusBadge, AgentTypeBadge, RoleBadge, ContextMeter, needs-attention flag, Rename/Close/Remove buttons, agent-nav kbd hints, close ✕. Already a single compact row — not the source of the reported noise.
2. **Top grid** (AgentList.tsx:734-780): `grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.5fr] flex-shrink-0`, hidden only when `logExpanded` is true. Two **always-fully-expanded** columns:
   - **Details** (734-757): "Details" label + `<dl>` of Command/Workdir/Window, `<ModeSwitcher>`, conditional "Create window" button.
   - **Queued tasks** (759-780): "Queued tasks (N)" label + `<TaskList>` (`frontend/src/components/TaskList.tsx:151`) + `<AddTaskForm>` (`frontend/src/components/AddTaskForm.tsx:10`) — always rendered, never collapsed. This is target #3 in the request ("Queued tasks could be refactored to be smaller").
3. **LogTail** (AgentList.tsx 782-789): `flex flex-col flex-1 min-h-0`, with `mt-5 border-t border-line pt-4` when *not* expanded (i.e. it only gets a plain top border and margin — its actual size is whatever `flex-1` leaves over after the grid above it, `Skills`, and the three `<details>` panels below all take their space).
4. **Skills** (791-819): already a collapsed `<details>` (`<summary>Skills (N)</summary>`), hidden entirely when `logExpanded`.
5. **DiffPanel** (`frontend/src/components/DiffPanel.tsx:76`) and **CheckpointList** (`frontend/src/components/CheckpointList.tsx:84`): both already `<details className="mt-3 flex-shrink-0">` — collapsed by default, ~1 line each when closed. CheckpointList's own doc comment even says *"Structural mirror of DiffPanel.tsx (both are agent-scoped `<details>` panels…)"*.
6. **UsageBreakdown** (`AgentList.tsx:365-424`): also `<details className="mt-3 flex-shrink-0">`, collapsed by default, returns `null` entirely if there are no sessions.

**Key finding**: Skills/Diff/Usage/Checkpoints are *already* the compact collapsed pattern the request is implicitly asking for elsewhere. The one block that breaks that pattern — and is the real contributor to "noise" pushing the terminal down and shrinking it — is the **top Details + Queued Tasks grid**, which has no collapse affordance at all.

### Direct Input (`interacting`) state

- Owned entirely inside `LogTail` (`frontend/src/components/LogTail.tsx:135-749`): `const [interacting, setInteracting] = useState(false)` (line ~157, initial state hardcoded `false`).
- `LogTail` has **exactly one consumer in the entire `components/` tree**: `AgentList.tsx:807`. No other call site to protect against a default-behavior change.
- `AgentDetailModal` computes `const interactSignal = armInteract ? 1 : 0` (AgentList.tsx ~541) and passes it as the `interactSignal` prop. `armInteract` is only ever `true` when the modal was opened via the amber/red "Direct Input — needs you" CTA button on the agent card (`AgentItem`, AgentList.tsx ~928-938, `needsAttention(status)` gated).
- Inside `LogTail`, an effect watches `interactSignal`: when it increments above 0, it does `setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0)` (LogTail.tsx ~419-424). This is the exact mechanism the request wants firing unconditionally on every modal open, not just the CTA path.
- Entering Direct Input by clicking the terminal already exists too: the `xtermContainerRef` div has `onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}` (LogTail.tsx ~660-664) — single click already arms it when not already interacting.
- Leaving/entering interact mode elsewhere: clicking "Live" tab while interacting turns it off (LogTail.tsx ~571-573); blur turns it off (`handleBlur`, LogTail.tsx ~617-621) unless focus moved to something inside `captureRef`.

### Fullscreen / ⌥F (`logExpanded`)

- State owned by `AgentDetailModal`: `const [logExpanded, setLogExpanded] = useState(false)` (AgentList.tsx ~540), passed to `LogTail` as `expanded={logExpanded} onToggleExpand={() => { setLogExpanded((v) => !v) }}` (AgentList.tsx:807).
- Toggled two ways today, both already routed through the same `setLogExpanded` toggle:
  1. Global modal-level keydown listener checks `isLogExpandShortcut(e)` (AgentList.tsx:74-76 — `e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyF' || key === 'f')`) and calls `setLogExpanded((v) => !v)` directly (AgentList.tsx ~565-569), intercepting **before** the Escape-closes-modal handler.
  2. `LogTail`'s own `handleKeyDown` (only wired when `interacting`) checks the twin `isExpandShortcut` (LogTail.tsx:12-14, identical logic, duplicated) and calls the passed-in `onToggleExpand()` (LogTail.tsx ~458-463).
  3. An explicit icon button next to the "⌥F" kbd hint (LogTail.tsx ~700-725) also calls `onToggleExpand` directly.
- When `logExpanded` is true: the top grid, Skills, DiffPanel, UsageBreakdown, CheckpointList are all conditionally hidden (`{!logExpanded && ...}` / trailing `${logExpanded ? ' hidden' : ''}` class), and the `LogTail` wrapper drops its `mt-5 border-t border-line pt-4` styling — i.e. **`logExpanded` is already exactly "give the terminal the whole modal"**, which is precisely what a double-click should trigger.
- There is currently **no `onDoubleClick` anywhere in `LogTail.tsx`** — only the single-click-to-interact handler on `xtermContainerRef` (LogTail.tsx ~660-664). Double-click is unhandled today (browsers will fire a native `dblclick`/text-selection but nothing in the app listens for it).

## Constraints

- `LogTail` having a single consumer means new default behavior (default-on Direct Input, double-click) can be hardcoded in `LogTail` itself rather than threaded through as new boolean props — simpler diff, but slightly reduces reusability if `LogTail` is ever embedded read-only elsewhere in the future (it currently isn't).
- The existing `interactSignal`/`armInteract` plumbing exists specifically for the needs-attention card CTA (`AgentItem`, AgentList.tsx ~928-938) — that path must keep working (open modal from a stalled/awaiting agent card and land straight in Direct Input), so it should be preserved or subsumed, not deleted outright.
- `isLogExpandShortcut` (AgentList.tsx:74-76) and `isExpandShortcut` (LogTail.tsx:12-14) are byte-for-byte duplicated logic in two files — worth a shared-helper note but out of scope for this feature.
- Both `⌥F` handlers already coexist peacefully (modal-level listener fires first via `document.addEventListener('keydown', ...)`, LogTail's own `handleKeyDown` only runs while `interacting` and stops propagation) — a double-click handler is fully additive and doesn't need to touch either.
- The top grid's `Command`/`Workdir` fields and the `ModeSwitcher` (`frontend/src/components/ModeSwitcher.tsx:11`) plus the conditional "Create window" button are the only parts of "Details" not purely informational — a collapse must not hide the "Create window" CTA when `!agent.windowPresent`, since that's the only way to relaunch a closed agent from this modal.
- `TaskList` (`frontend/src/components/TaskList.tsx:151`) already supports drag-reorder (`onReorder` prop) — collapsing it into a `<details>` doesn't change its internals, only its default visibility.

## Recommendation

**1. Terminal front-and-center / larger, and Details+Queued Tasks noise reduction (points 1–3) — one change, not two:**

Convert the top grid (AgentList.tsx:734-780) from an always-expanded two-column grid into two collapsed `<details>` rows, styled exactly like Skills/Diff/Usage/Checkpoints below:

```
<details className="flex-shrink-0">
  <summary>Details</summary>
  ...existing <dl> + ModeSwitcher + Create-window button...
</details>
<details className="flex-shrink-0">
  <summary>Queued tasks ({agent.queuedTasks})</summary>
  ...existing <TaskList> + <AddTaskForm>...
</details>
```

Stack them in a single column (drop `md:grid-cols-[1fr_1.5fr]`) directly above the terminal, remove `logExpanded`'s special-case hiding of this block (a collapsed `<details>` is already ~24px, no need to hide it during expand — though keeping the hide is harmless too). This alone gives the terminal materially more default height with **zero new components** — it reuses the pattern already proven by Skills/Diff/Usage/Checkpoints, so it's the lowest-risk, highest-leverage change. Default them to open only when there's something actionable — e.g. auto-open "Queued tasks" via the `open` attribute when `agent.queuedTasks > 0`, closed otherwise; "Details" always closed by default since it's rarely needed at a glance.

**2. Direct Input as the default state on open (point 4):**

In `LogTail`, replace the `interactSignal`-gated mount effect with one that also fires unconditionally once on mount:

```tsx
useEffect(() => {
  setTimeout(() => {
    setInteracting(true)
    captureRef.current?.focus()
  }, 0)
}, []) // fires once per LogTail mount — i.e. once per modal open, since key={agent.id} remounts it
```

Keep the existing `interactSignal`-increment effect as-is for the needs-attention CTA path (`armInteract`) — it becomes a no-op re-affirmation (`interacting` is already `true`), which is harmless. Because `AgentDetailModal` renders `<LogTail key={agent.id} ... />` (AgentList.tsx:807), switching agents (via `onNavigate`/prev-next) already remounts `LogTail` fresh, so the mount effect naturally re-arms Direct Input on every agent switch too, not just first open — matching "as soon as the modal is opened."

**3. Double-click terminal → fullscreen (point 5):**

Add `onDoubleClick` to the same `xtermContainerRef` div that already has the single-click-to-interact handler (LogTail.tsx ~660-664), calling the existing `onToggleExpand` prop — no new state, no new mechanism, reuses the identical `logExpanded` toggle that ⌥F and the icon button already drive:

```tsx
<div
  ref={xtermContainerRef}
  ...
  onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}
  onDoubleClick={onToggleExpand}
  ...
/>
```

Since Direct Input is now default-on (point 2), the single-click branch (`!interacting && ...`) will rarely fire in practice post-open — the double-click handler is independent of it either way, so this is safe regardless of point 2 landing.

## Risks and Mitigations

- **Auto-focusing the terminal on modal open captures keystrokes immediately**, including the arrow-key agent-navigation shortcuts (`⌘←`/`⌘→`, AgentList.tsx ~600-610) which are checked in the modal-level `keydown` listener with a `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out (AgentList.tsx ~561-563) — `captureRef` is a plain `<div>`, not an input, so that check won't block it, but the *modal's* listener also runs before/independently of `LogTail`'s own handler and both currently coexist without conflict for Escape/⌥F. Verify manually after the change that `⌘←/→` and Escape (single/double) behavior is unaffected once the terminal auto-focuses.
- **Auto-collapsing "Details" by default hides "Create window"** for agents with `!agent.windowPresent` — mitigate by defaulting that `<details>` `open` when `!agent.windowPresent`, closed otherwise (mirrors the "auto-open Queued tasks when non-empty" idea above).
- **Removing the `md:grid-cols-[1fr_1.5fr]` split** changes the modal's visual identity notably — worth a quick manual pass in the browser (`/run` skill or manual `make dev`) to confirm spacing/padding still reads well at both mobile (`inset-4`) and desktop (`inset-8`) breakpoints before calling it done.

## Next Steps

- `/task-add Collapse AgentDetailModal's Details and Queued Tasks sections into <details> rows above the terminal, default Direct Input to on when the modal opens, and wire double-click on the terminal to trigger the existing ⌥F expand toggle` — implementation-ready scope matching this report's three-part recommendation.
- Manually verify in the browser after implementation: modal open → terminal already in Direct Input (amber banner visible) with focus; double-click terminal → fullscreen (matches ⌥F); Escape/Escape-twice and ⌘←/⌘→ still work with the terminal auto-focused; "Create window" still reachable for closed agents.
