---
id: TASK-162
aliases: [TASK-162]
title: "Move the Details and Queued Tasks accordions into the AgentInfoTabs structure"
status: pending-uat
created: 2026-09-13
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-162]]"
tags: [frontend, ux, accessibility]
---

# TASK-162 — Move the Details and Queued Tasks accordions into the AgentInfoTabs structure

## Objective

`AgentDetailModal` (`frontend/src/components/AgentList.tsx`) currently renders two native `<details>`/`<summary>` accordions — "Details" (~lines 940-988: Command, Workdir, Window present/missing, Worktree branch/"Create worktree", `ModeSwitcher`, conditional "Create window") and "Queued tasks" (~lines 990-998: `TaskList` + `AddTaskForm`) — **above** the `AgentInfoTabs` tab strip TASK-157 shipped (Terminal/Skills/Diff/Usage/Checkpoints). Fold both into that same tab strip as two more tabs, so the modal has one consistent navigation model instead of a mix of "two always-visible accordions + a five-tab strip."

## Approach

Mechanically this is straightforward — `AgentInfoTabDef` (`frontend/src/components/AgentInfoTabs.tsx:2-20`) is `{ id, label, present?, content }`, and both Details and Queued-tasks are always-present content (unlike Diff/Usage/Checkpoints, which conditionally omit), so they need no `present`-tracking plumbing — just two more entries pushed onto the `tabs` array literal built inline in `AgentDetailModal` (~lines 823-875), same pattern as the always-shown `skills` tab.

**Three design questions this task must resolve before/while implementing** (do not assume answers — decide explicitly, documenting the choice in this task's Notes or via a quick `/decision-create` if the tradeoff is non-obvious):

1. **Lost default-visibility signal.** Today, Details auto-opens via `open={!agent.windowPresent}` (surfaces "no window" problems immediately) and Queued tasks auto-opens via `open={agent.queuedTasks > 0}` (surfaces pending work immediately) — both without a click. As tabs, neither auto-opens; Terminal remains the default-active tab per TASK-157/DEC-0005#D1. Decide whether to accept this loss, or replace it with a lightweight signal on the tab label itself (e.g. a small count badge on "Queued tasks (N)" already gives count without opening; a dot/badge on "Details" when `!agent.windowPresent`).
2. **`logExpanded` special-casing must be removed cleanly, not left dangling.** The `' hidden'` className on both `<details>` blocks and the explanatory comment near `handleActiveTabChange` (~line 819) exist solely to keep these two sections in sync with Terminal-fullscreen state (`⌥F`). Once both move into the tab strip (which `AgentInfoTabs` already hides via its own `hidden` toggling when a different tab is active), this entire mechanism — the conditional className logic and the comment — becomes dead code and must be deleted as part of this task, not left behind.
3. **Semantic fit of "Details" content.** Some of it (worktree branch, "Create worktree"/"Create window" buttons, `ModeSwitcher`) reads as interactive/actionable chrome, while other parts (Command, Workdir) are closer to static identity info that might belong in the header instead of a tab. Decide whether all of Details' current content moves into the new tab as-is, or whether some fields get promoted to the modal header (leaving a leaner "Details" tab for just the interactive bits).

## Steps

### 1. Resolve the design questions <!-- agent: general-purpose -->

- [x] Decide the answer to design questions 1-3 above (document the decision inline in this task's Notes section before writing code, or spin off a `/decision-create` first if any answer is contentious enough to want a recorded rationale).

<!-- Updated: 2026-09-13 -->
<!-- Decisions documented in ## Notes → "Step 1 decisions" below: (1) label-only visibility cue (Queued tasks (N) always shown, Details gets a trailing "•" when !windowPresent), no AgentInfoTabDef type change; (2) exact delete/rewrite pointers confirmed (AgentList.tsx:1029-1078, :1080-1088 deleted; :785-791 comment trimmed, not blanked; :1095 explicitly untouched); (3) all Details content stays together in the tab, nothing promoted to the header. -->

### 2. Add Details and Queued Tasks as tabs <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, move the "Details" `<details>` block's content (~lines 940-988) into a new tab entry `{ id: 'details', label: 'Details', content: <...> }` pushed onto the `tabs` array (~lines 823-875), following the always-present pattern already used for `id: 'skills'` (no `present` key needed).
- [x] Move the "Queued tasks" `<details>` block's content (~lines 990-998, `TaskList` + `AddTaskForm`) into a second new tab entry `{ id: 'queued-tasks', label: <dynamic 'Queued tasks (N)' per design question 1>, content: <...> }`.
- [x] Delete both original `<details>` elements from the modal body.
- [x] Remove the `logExpanded`-driven `' hidden'` className logic from both (now-deleted) blocks and the explanatory comment near `handleActiveTabChange` (~line 819) that only existed to justify that coupling — confirm via `search_for_pattern` that no other code still references the old accordion-specific hiding logic.
- [x] Implement whatever visibility-signal replacement design question 1 settled on (count badge, dot indicator, or explicitly none).

<!-- Updated: 2026-09-13 -->
<!-- Final tab order: Terminal, Skills, Details, Queued Tasks, Diff, Usage, Checkpoints (7 entries, up from 5). Both original <details> blocks confirmed gone via search_for_pattern (zero accordion matches remain in AgentDetailModal). handleActiveTabChange comment trimmed (stale Details/Queued-tasks clause removed), function logic byte-for-byte unchanged. AgentInfoTabs element's logExpanded-conditional className left untouched as specified. Details label: 'Details' / 'Details •' (bullet when !windowPresent); Queued Tasks label: `Queued tasks (${agent.queuedTasks})` always shown. tsc --noEmit clean; existing 73 AgentList tests still pass unmodified (none asserted the old <details> structure by queryable text). -->

### 3. Tests <!-- agent: general-purpose -->

- [x] Update `frontend/src/components/AgentList.test.tsx`: locate and update any existing tests asserting the old `<details>`/`<summary>` structure for "Details" or "Queued tasks" (search for `'Details'`/`'Queued tasks'` summary text assertions) to match the new tab-based structure.
- [x] Add tests covering: both new tabs appear in the tablist in the correct position (decide/document tab order — e.g. Terminal, Skills, Details, Queued Tasks, Diff, Usage, Checkpoints, or another ordering that makes sense), their content renders when selected, and (if design question 1 added a badge/indicator) that it reflects the underlying data correctly.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean.

<!-- Updated: 2026-09-13 -->
<!-- Confirmed a no-op: nothing in the existing suite asserted the old <details>/<summary> structure by queryable text. Added new describe block "AgentDetailModal Details/Queued Tasks tabs (TASK-162 Step 3)" (6 tests): tab order (Terminal, Skills, Details, Queued tasks (0), Diff, Checkpoints — Usage intentionally excluded, see below), Details label toggling ('Details' / 'Details •'), Queued Tasks label reflecting agent.queuedTasks (0 and 5), Details tab content rendering (Command/Workdir/ModeSwitcher), Queued Tasks tab content rendering (TaskList/AddTaskForm). One real bug found and fixed during verification (not present in the shipped app code, purely a test-timing issue): the tab-order test originally waited for the Usage tab, which times out — usagePresent defaults to true so UsageBreakdown mounts once, but its own onPresenceChange(false) fires synchronously before its fetch resolves (sessions still null), the modal reacts by unmounting it, and the fetch effect's cleanup sets cancelled=true before the in-flight fetch can ever complete — Usage never reappears in this test environment. Same documented precedent as the pre-existing TASK-157 describe block above it, which already excludes Usage for the identical reason. Fixed by waiting for Checkpoints (present synchronously via agent.worktreePath) instead and dropping Usage from the order assertion. tsc --noEmit clean; full suite 121/121 (up from 115). -->
<!-- Process note: two background agents were briefly double-dispatched for this step (one killed mid-run by user instruction, a second launched under the mistaken belief the first had made no edits) — the killed agent had in fact already completed all the work described above before being stopped; the second, redundant agent was killed before it duplicated anything. No lasting effect beyond this note. -->

### 4. Verify <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Via `/run` or `make dev`, open an agent's detail modal; confirm Details and Queued Tasks are reachable as tabs alongside Terminal/Skills/Diff/Usage/Checkpoints, keyboard tab navigation (arrow keys/Home/End) still correctly cycles through the now-larger tab set without wrapping oddly or overflowing the modal width, and that `⌥F` Terminal-fullscreen no longer needs special-case handling for these two sections (since `AgentInfoTabs` already hides inactive tabs).

## Notes

- No active task currently touches `AgentDetailModal`'s header/details/queued-tasks structure (checked `wiki/work/tasks/index.md` at time of filing) — no dependency conflicts.
- Follows directly from `TASK-157` (ROADMAP-021 Phase 5, `implements::[[DEC-0005#D1]]`), which established the `AgentInfoTabs` component, its WAI-ARIA tablist pattern (roving tabindex, arrow/Home/End nav, `present`-based omission), and the "always mounted, `hidden`-class toggled" persistence guarantee — this task reuses that pattern with no new accessibility design needed.
- Growing from 5 tabs to 7 in a fixed-width modal header strip has not been checked for overflow/wrapping behavior at narrow modal widths — flagged as a verify-phase concern, not a known defect.
- Filed from a user-supplied screenshot of a terminal command (`/task-add move the details and queued tasks accordions into the new tabs structure`), researched via Serena against the current `AgentList.tsx`/`AgentInfoTabs.tsx` state before writing.

### Step 1 decisions (design questions 1-3)

Made directly (no `/decision-create`) — all three are component-level implementation choices within the already-accepted `AgentInfoTabs` architecture (TASK-157/DEC-0005#D1), not new product/architecture decisions.

**Design question 1 — lost default-visibility signal.** Accept the loss of auto-open; replace it with a label-only signal, no `AgentInfoTabDef` interface change:
- **Queued tasks tab:** label is `` `Queued tasks (${agent.queuedTasks})` `` — exactly reuses today's `<summary>` text (`AgentList.tsx:1082`) and is always shown, including `(0)`. This already surfaces the count without a click, matching the existing "Skills (N)" tab-label precedent already in the `tabs` array (`AgentList.tsx:872`). No open-on-mount behavior is replicated.
- **Details tab:** label is `agent.windowPresent ? 'Details' : 'Details •'` — append a plain bullet character (U+2022, one space before it) when `!agent.windowPresent`. `AgentInfoTabDef.label` is typed `string` and rendered as a plain text child (`{tab.label}`, `AgentInfoTabs.tsx:119`), so this needs no type change. It's lower-fidelity than the old auto-open (no color, can't reuse the header's red `!`/`needsAttention` styling at `AgentList.tsx:942`), but it's cheap, in scope, and gives an at-a-glance cue without opening the tab. A richer colored/dot indicator would require widening `label` to `ReactNode` — explicitly out of scope for this task.

**Design question 2 — logExpanded dead-code cleanup, confirmed locations:**
- Delete the two `<details>` wrapper elements outright as part of Step 2's move-into-tabs work: `AgentList.tsx:1029` `<details className={`flex-shrink-0${logExpanded ? ' hidden' : ''}`} open={!agent.windowPresent}>` through `:1078`, and `AgentList.tsx:1080` `<details className={`mt-3 flex-shrink-0${logExpanded ? ' hidden' : ''}`} open={agent.queuedTasks > 0}>` through `:1088`. Their `' hidden'`-on-`logExpanded` className logic disappears along with the elements — nothing extra to strip there.
- Rewrite (don't blank-delete) the comment at `AgentList.tsx:785-791` above `handleActiveTabChange`. It currently justifies `setLogExpanded(false)` partly by "closes fullscreen Terminal so it doesn't leave the Details/Queued-tasks sections above the tab strip incorrectly hidden" — that clause goes stale once those sections are tabs. The underlying *behavior* stays and is still correct: `if (id !== 'terminal' && logExpanded) setLogExpanded(false)` (`AgentList.tsx:793`) should keep collapsing a fullscreen Terminal when the user switches to any other tab (now 7 instead of 5), so fullscreen state isn't left dangling off-screen. Step 2 should trim the comment to the still-valid reason and drop the Details/Queued-tasks-specific clause, not delete `handleActiveTabChange`'s logic.
- Explicitly out of scope, leave alone: `AgentList.tsx:1095`'s `className={`flex flex-col flex-1 min-h-0${logExpanded ? '' : ' mt-5 border-t border-line pt-4'}`}` on the `AgentInfoTabs` element itself is a *different* use of `logExpanded` (spacing/border above the tab strip when Terminal goes fullscreen) — it isn't accordion-specific and isn't part of the dead code this question targets.

**Design question 3 — semantic fit of Details content.** All of Details' current content (Command, Workdir, Window present/missing, Worktree branch/"Create worktree", `ModeSwitcher`, conditional "Create window" — `AgentList.tsx:1033-1077`) moves into the new "Details" tab as-is, in its current order; nothing is promoted to the modal header. Rationale:
1. The header (`AgentList.tsx:930-1011`) is a single fixed-height `flex items-center` row of compact badges/controls (name, `ProjectBadge`, `StatusBadge`, `AgentIdentityBadge`, `ContextMeter`, attention/skill indicators, actions menu, nav, close). Command and Workdir are unbounded-length strings rendered with `break-all font-mono` precisely because they can be long full paths/commands — incompatible with a one-line badge strip.
2. Command/Workdir/Window/Worktree read as one coherent "agent identity & config" block today; splitting the static fields (Command, Workdir, Window) from the interactive ones (Worktree action, `ModeSwitcher`, Create window) across two locations fragments that block for no clear benefit — a user opening "Details" wants the whole picture, not half of it plus a header glance.
3. Keeps this task mechanical, matching its own framing ("just two more entries pushed onto the `tabs` array") rather than expanding into an unplanned header redesign.
