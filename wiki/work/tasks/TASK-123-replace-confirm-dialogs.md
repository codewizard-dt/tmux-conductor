---
id: TASK-123
aliases: [TASK-123]
title: "Replace window.confirm() destructive-action dialogs with the app's custom modal styling"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: [TASK-122, TASK-124]
uat: "[[UAT-123]]"
tags: [frontend, ui, roadmap-017]
---

# TASK-123 — Replace window.confirm() destructive-action dialogs with the app's custom modal styling

## Objective

Replace every native `window.confirm()` destructive-action dialog in the dashboard with a styled in-app confirmation modal matching the app's existing modal visual language, so destructive actions get a UI-consistent confirmation instead of the browser's native (and easily-misclicked, unstyleable) confirm box.

## Approach

**Full call-site inventory — broader than the roadmap bullet implies.** The roadmap text says "remove/close agent," but a repo-wide search (`mcp__serena__search_for_pattern` for `window\.confirm`, done during task creation) found **6 call sites across 3 files**, not 2:

| File | Function | Action |
|---|---|---|
| `frontend/src/components/AgentList.tsx:540` | `handleRemove` | Remove agent |
| `frontend/src/components/AgentList.tsx:560` | `handleCloseWindow` | Close agent's tmux window |
| `frontend/src/components/AgentList.tsx:985` | bg-process `handleRemove` | Remove background process |
| `frontend/src/components/AgentList.tsx:993` | bg-process `handleCloseWindow` | Close background process's window |
| `frontend/src/components/InactiveAgentsPanel.tsx:43` | `handleRemoveInactive` | Remove an inactive agent |
| `frontend/src/components/CheckpointList.tsx:59` | `handleRollback` | Roll back to a checkpoint (landed today via TASK-071 — not yet reflected in the roadmap text, which predates it) |

All 6 must move to the new component for this task to be complete — the roadmap's "remove/close agent" phrasing undercounts by 4 sites (2 bg-process variants, 1 inactive-agent variant, 1 checkpoint-rollback confirm).

**Reusable component**: create a single `ConfirmDialog` (or similarly named) component rather than restyling each call site inline. There is no existing generic confirm/dialog component in this repo to extend — the two current modals (`AgentDetailModal` in `AgentList.tsx`, `FolderPickerModal.tsx`) are both single-purpose, not reusable primitives. Base the new component's visual language on `FolderPickerModal.tsx`'s established overlay pattern (`frontend/src/components/FolderPickerModal.tsx:62-65`: `fixed inset-0 z-50 flex items-center justify-center bg-black/40` backdrop, `shadow-pop` from `tailwind.config.js`'s custom `boxShadow.pop` token, click-outside-to-dismiss via an overlay `onClick` handler) rather than inventing new styling.

**API shape**: each call site today is synchronous — `window.confirm(message)` blocks and returns a boolean immediately, so the surrounding code does `if (!confirmed) return;` then proceeds. A React modal is asynchronous (renders, waits for a click), so every call site's calling function needs to change from a synchronous early-return to either (a) a promise-based helper (`await confirmDialog(message)` backed by a rendered-and-resolved-on-click component instance), or (b) local component state (`const [pending, setPending] = useState<PendingAction | null>(null)`) that renders the dialog conditionally and calls the real action from the dialog's own confirm handler. Prefer whichever pattern keeps the diff smallest per call site — investigate both during implementation and pick one consistently across all 6 sites.

**Verification is human-gated.** No frontend test runner exists in this repo (no vitest/jest, confirmed by three agents earlier today) — `/uat-generate` should expect all cases to fail-close to `/uat-walk`.

## Steps

### 1. Build the reusable confirm component  <!-- agent: general-purpose -->

- [x] Create `frontend/src/components/ConfirmDialog.tsx` (or equivalent name) — props: a message/title, a confirm-button label (destructive actions should say something like "Remove"/"Close"/"Roll back," not a generic "OK"), a cancel label, and callbacks for confirm/cancel. Style per the `FolderPickerModal.tsx` overlay pattern (`bg-black/40` backdrop, centered card, `shadow-pop`, `rounded-card`).
- [x] Support both Escape-to-cancel and click-outside-to-cancel, matching `FolderPickerModal`'s existing `handleOverlayClick` pattern.
<!-- Updated: 2026-08-15 -- Created ConfirmDialog.tsx (props: open, title?, message, confirmLabel, cancelLabel='Cancel', onConfirm, onCancel) and ConfirmDialog.test.tsx (8 cases: render-when-open, render-nothing-when-closed, confirm-click, cancel-click, Escape, Escape-while-closed-noop, overlay-click, inside-card-click — all asserting exact call counts on both callbacks). Escape listener only attaches while open (useEffect early-return + cleanup). Overlay-click uses FolderPickerModal's e.target===e.currentTarget idiom. Styled with shadow-pop/rounded-card tokens and existing bg-accent-red destructive-button convention. Full suite: 3 files, 36/36 passing. tsc --noEmit clean. No call sites wired yet (Steps 2-3). -->

### 2. Wire up AgentList.tsx's 4 call sites  <!-- agent: general-purpose -->

- [x] **Hot file** — re-read `frontend/src/components/AgentList.tsx` immediately before editing (concurrently edited by other Phase-3-adjacent work). Replace `handleRemove` (line ~540) and `handleCloseWindow` (line ~560) for agents, and the bg-process `handleRemove` (line ~985) and `handleCloseWindow` (line ~993), with the new `ConfirmDialog`, preserving each site's existing message text and post-confirm logic exactly.
<!-- Updated: 2026-08-15 -- Re-located AgentDetailModal/BgProcessRow by symbol name (hot file). Both components gained confirmingRemove/confirmingClose useState booleans; original handleRemove/handleCloseWindow bodies renamed to doRemove/doCloseWindow (unchanged apart from resetting the confirming flag first), triggered from a ConfirmDialog's onConfirm. All 4 messages verified byte-identical to the originals; confirmLabel "Remove"/"Close" per site. window.confirm now has zero matches in AgentList.tsx. tsc --noEmit clean. -->

### 3. Wire up InactiveAgentsPanel.tsx and CheckpointList.tsx  <!-- agent: general-purpose -->

- [x] Replace `handleRemoveInactive`'s `window.confirm` (`frontend/src/components/InactiveAgentsPanel.tsx:43`) with `ConfirmDialog`.
- [x] Replace `handleRollback`'s `window.confirm` (`frontend/src/components/CheckpointList.tsx:59`) with `ConfirmDialog`, preserving its existing message ("Roll back to this checkpoint? This will overwrite uncommitted work in the worktree.").
<!-- Updated: 2026-08-15 -- InactiveAgentsPanel gained pendingRemove: Agent | null state + one shared ConfirmDialog; CheckpointList gained pendingRollback: number | null + one shared ConfirmDialog, confirmLabel "Roll back", message preserved byte-for-byte. Both post-confirm bodies (doRemoveInactive/doRollback) unchanged apart from the confirm gate. Repo-wide search for window\.confirm across frontend/src/ now returns zero matches — all 6 original sites migrated. tsc --noEmit clean. -->

### 4. Typecheck and smoke  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] `npm run build` in `frontend/` — clean.
- [x] `mcp__serena__search_for_pattern` for `window\.confirm` across `frontend/src/` returns zero matches once this task is complete.
- [DEFERRED-TO-UAT] With `make dev` running, manually trigger each of the 6 actions and confirm the styled dialog appears, Cancel aborts with no side effect, and Confirm performs the original action.
<!-- Updated: 2026-08-15 -- tsc --noEmit clean; npm run build clean (72 modules, pre-existing chunk-size advisory only); repo-wide window\.confirm search returns zero matches; npm test 3 files/36 tests passing (includes new ConfirmDialog.test.tsx). Manual browser trigger deferred to UAT — headless session, no browser available. -->

## Acceptance Criteria

- [ ] All 6 `window.confirm()` call sites (`AgentList.tsx` x4, `InactiveAgentsPanel.tsx` x1, `CheckpointList.tsx` x1) are replaced with the new styled `ConfirmDialog` component.
- [ ] `window.confirm` no longer appears anywhere under `frontend/src/`.
- [ ] Each replaced dialog preserves its original message text and post-confirm behavior exactly.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.

## Dependencies

- None — UI-only, independent of the other ROADMAP-017 Phase 3 items.
- **Parallel-safe with** [TASK-122](TASK-122-dashboard-dark-mode.md) and [TASK-124](TASK-124-agentlist-text-filter.md) — different concerns. This task and TASK-124 both touch `frontend/src/components/AgentList.tsx` (a hot file per this repo's existing convention) — re-read immediately before every edit.

### Roadmap

Implements ROADMAP-017 Phase 3, item "Replace `window.confirm()` destructive-action dialogs (remove/close agent) with the app's existing custom modal styling" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
