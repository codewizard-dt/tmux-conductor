---
id: TASK-131
aliases: [TASK-131]
title: "AgentDetailModal terminal-first redesign — collapse Details/Queued Tasks, default Direct Input, double-click fullscreen"
status: done
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: [TASK-001, TASK-012, TASK-122]
uat: "[[UAT-131]]"
tags: [frontend, agent-detail-modal, log-tail, ux, terminal-size-probe]
---

# TASK-131 — AgentDetailModal terminal-first redesign

## Objective

Make the terminal the visually dominant element of `AgentDetailModal` by default, with less always-visible chrome around it, and make Direct Input the modal's default interaction mode instead of something the user has to toggle to. Concretely: (1) collapse the always-expanded Details + Queued Tasks grid into the same collapsed `<details>` pattern already used by Skills/DiffPanel/UsageBreakdown/CheckpointList, freeing the terminal's default vertical space with zero new components; (2) make `LogTail`'s Direct Input mode default-on for every modal open/agent-switch rather than only when armed via the needs-attention card CTA; (3) wire a double-click on the terminal to trigger the existing `⌥F`/`logExpanded` fullscreen toggle.

Full research and line-by-line citations: `raw/research/agent-detail-modal-redesign/index.md` (see also `wiki/knowledge/sources/agent-detail-modal-redesign.md`, `wiki/knowledge/entities/components/agent-detail-modal.md`, and the new section in `wiki/knowledge/entities/components/log-tail.md`).

**Scope addition (folded in at tackle-start, 2026-08-15):** also fix a user-reported regression in TASK-130's dynamic terminal-width probe — wrapped lines land one character before the true visible edge and the cursor is consequently drawn one column/row off, attributed to the probe not consistently accounting for the terminal's own scrollbar width. See Step 4 below. Unrelated to the modal-redesign scope above but bundled into this task per explicit user direction rather than filed as a separate bug.

## Approach

`LogTail` (`frontend/src/components/LogTail.tsx`) has exactly one render call site in the whole `components/` tree — `AgentDetailModal` in `frontend/src/components/AgentList.tsx:514-869` (confirmed via `mcp__serena__search_for_pattern` for `<LogTail` across `frontend/src/components`) — so default-behavior changes can be made directly inside `LogTail` without threading new props through other call sites or worrying about other consumers.

Skills (`AgentList.tsx` ~791-819), `DiffPanel` (`DiffPanel.tsx:76`), `UsageBreakdown` (`AgentList.tsx:365-424`), and `CheckpointList` (`CheckpointList.tsx:84`) are all already `<details className="mt-3 flex-shrink-0">` — collapsed, one-line-summary panels. The Details + Queued Tasks grid (`AgentList.tsx:734-780`, `grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.5fr] flex-shrink-0`) is the one block that doesn't follow that pattern and is the actual source of the reported visual noise pushing the terminal down. Converting it to the same pattern is the lowest-risk, highest-leverage change — no new components, reuses a proven pattern.

`logExpanded` (owned by `AgentDetailModal`, `AgentList.tsx` ~540) already implements "terminal takes the whole modal" — it's driven today by a document-level `⌥F` keydown listener (`isLogExpandShortcut`, `AgentList.tsx:74-76`) and an icon button inside `LogTail` (~700-725) that both call the same `onToggleExpand` prop. A double-click handler on the terminal container reuses this exact mechanism.

`interacting` state lives in `LogTail` (`useState(false)`, ~L157) and is today only auto-armed via an `interactSignal` prop that increments when `AgentDetailModal` is opened from the needs-attention card CTA (`armInteract`, `AgentItem` ~L928-938, gated on `needsAttention(status)`). Making Direct Input unconditionally default-on requires a mount effect that fires regardless of `interactSignal`. Because `AgentDetailModal` renders `<LogTail key={agent.id} .../>` (`AgentList.tsx:807`), switching agents via `onNavigate` already remounts `LogTail`, so a plain mount effect naturally re-arms Direct Input on every agent switch too — matching "as soon as the modal is opened."

**Known risk to verify manually (not a blocking unknown, just needs a check after implementation):** auto-focusing `captureRef` (a plain `<div>`, not an `<input>`/`<textarea>`) on mount bypasses the modal's `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out used to protect the `⌘←/→` agent-navigation shortcut (`AgentList.tsx` ~L561-563) from being captured by form fields. The modal's `keydown` listener and `LogTail`'s own `handleKeyDown` currently coexist without conflict for Escape/`⌥F`; this needs to be re-verified once the terminal auto-focuses on open, since `captureRef` was previously only focused after an explicit user action (click or CTA).

## Steps

### 1. Collapse Details + Queued Tasks into `<details>` rows  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, inside `AgentDetailModal` (~L734-780), replace the `grid grid-cols-1 gap-5 md:grid-cols-[1fr_1.5fr] flex-shrink-0` wrapper and its two `<div>` columns with two stacked `<details className="flex-shrink-0">` blocks, styled to match the existing `Skills`/`DiffPanel`/`UsageBreakdown`/`CheckpointList` summary markup (`cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none` on the `<summary>`):
  - **Details** panel: `<summary>Details</summary>` wrapping the existing `<dl>` of Command/Workdir/Window, `<ModeSwitcher agentId={agent.id} mode={agent.mode} windowPresent={agent.windowPresent} />`, and the conditional "Create window" button block. Default **closed**, except default **open** (`open` attribute, conditionally applied via JSX) when `!agent.windowPresent` — so the "Create window" CTA for a closed agent stays visible without an extra click.
  - **Queued tasks** panel: `<summary>Queued tasks ({agent.queuedTasks})</summary>` wrapping the existing `<TaskList agentName={agent.name} tasks={tasks} onReorder={setTasks} />` and `<AddTaskForm agentId={agent.id} onAdded={...} projectId={projectId} projectName={project} />`. Default **closed**, except default **open** when `agent.queuedTasks > 0`.
- [x] Keep the existing `${logExpanded ? ' hidden' : ''}` conditional class on this block (harmless now that it's collapsed by default, but preserves existing fullscreen behavior without extra logic).
- [x] Verify the `mt-5 border-t border-line pt-4` spacing on the `LogTail` wrapper (~L805) still reads well now that the block above it is much shorter by default — adjust the top margin/padding only if it looks visually cramped, not as a speculative change.

<!-- Updated: 2026-08-15 -->
Implemented: two-column grid replaced with two stacked `<details>` (Details, Queued tasks), no wrapping `<div>`; each carries `flex-shrink-0${logExpanded ? ' hidden' : ''}` on its own className; `open={!agent.windowPresent}` / `open={agent.queuedTasks > 0}`; no `key` prop (avoids remount-on-render). LogTail wrapper spacing left unchanged (still reads fine). `npx tsc --noEmit` in `frontend/` — clean pass.

### 2. Default Direct Input to on for every LogTail mount  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, locate the existing `interactSignal`-watching effect (~L419-424: `useEffect(() => { if (interactSignal !== undefined && interactSignal > 0) { setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0) } }, [interactSignal])`).
- [x] Add a second effect that runs once on mount (empty dependency array) performing the same `setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0)` — do not remove or alter the existing `interactSignal` effect; it becomes a harmless no-op re-affirmation when the CTA path also arms it.
- [x] Confirm this only applies inside the modal context: since `LogTail` has a single consumer (`AgentDetailModal`), no additional gating prop is needed — verify via `mcp__serena__search_for_pattern` for `<LogTail` across `frontend/src/components` immediately before making this change, in case a new consumer was added since this task was written.

<!-- Updated: 2026-08-15 -->
Implemented: new mount-only `useEffect(() => { setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0) }, [])` added right after the existing `interactSignal` effect (both preserved). Single-consumer check confirmed exactly one `<LogTail` call site (`AgentList.tsx:811`, inside `AgentDetailModal`). `npx tsc --noEmit` in `frontend/` — clean pass.

### 3. Double-click terminal to trigger fullscreen  <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, on the `xtermContainerRef` div (~L660-664, the one with the existing `onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}` handler), add `onDoubleClick={onToggleExpand}` (the prop is already `(() => void) | undefined`, so no additional guard is needed — passing `undefined` when the prop isn't provided is a no-op for React).
- [x] Do not modify the existing `onClick` handler — single-click-to-interact and double-click-to-expand should coexist independently (a double-click will fire both a `click` and a `dblclick`, which is fine: the first click enters Direct Input, the dblclick separately expands).

<!-- Updated: 2026-08-15 -->
Implemented: `onDoubleClick={onToggleExpand}` added to the `xtermContainerRef` div (now ~L675-680 after prior steps' shifts), `onClick` left untouched. `npx tsc --noEmit` in `frontend/` — clean pass.

### 4. Fix terminal-size probe scrollbar off-by-one (TASK-130 follow-up, folded in during tackle)  <!-- agent: general-purpose -->

User-reported (2026-08-15, screenshot at `tmp/dashboard-drops/1786833660749-Screenshot-2026-08-15-at-5.39.51-PM.png`): since the TASK-130 dynamic terminal-width probe landed, terminal lines wrap one character before the true visible edge, and the block cursor is consequently drawn one column/line off from where it should be (it lags behind where the text actually wrapped). Reported as caused by the scroll bar — i.e. the computed `cols` is one character wider than what actually fits once a scrollbar is present, so xterm wraps text at the "no scrollbar" width while something (the container measurement, or the probe) doesn't consistently account for the scrollbar's reserved width.

- [x] In `frontend/src/lib/terminalSizeProbe.ts`, compare `getProbeMount()`'s DOM structure (`outer` = `fixed inset-4 md:inset-8`, `inner` = `p-5`, plain `mount` div with no border/overflow styling) against the **real** terminal's actual DOM nesting in `frontend/src/components/LogTail.tsx`'s `captureRef`/`xtermContainerRef` divs (the bordered `border bg-[#0b0b0d] rounded-[10px]` wrapper around `xtermContainerRef`, and `xtermContainerRef`'s own `overflow-hidden`). Identify any width-affecting style (border width, padding, or — most likely — xterm's own `.xterm-viewport` scrollbar, which xterm.js sets to `overflow-y: scroll` so it always reserves scrollbar-gutter width) that the probe's freshly-created throwaway `Terminal`/`FitAddon` measures differently than the real, already-mounted terminal.
  - Specifically check: does `fitAddon.fit()` on the probe's `Terminal` (created and fit synchronously in the same tick as `term.open(mount)`, before the browser has necessarily laid out/painted `.xterm-viewport`'s scrollbar) produce the same `cols` as `fitAddon.fit()` on the real `LogTail` terminal once its scrollbar is actually rendered? If the probe's measurement race means its `.xterm-viewport` scrollbar isn't reserving width yet at fit-time, the probe will compute one column more than the real terminal ever has room for.
- [x] Fix the discrepancy so the probed `cols` exactly matches what the real `LogTail` terminal can display without wrapping into/behind its own scrollbar — likely fixes include: forcing a layout flush (e.g. read `mount.offsetWidth` or use `requestAnimationFrame`/a microtask before calling `fitAddon.fit()`) so the scrollbar has been reserved before measuring, or explicitly reserving the scrollbar's width (`term.options.scrollback` doesn't affect this — measure `.xterm-viewport`'s actual `clientWidth` vs `offsetWidth` delta) before computing `cols`. Do not hand-roll a hardcoded scrollbar-width constant (e.g. `-15px`) — that hardcodes an assumption about OS/browser scrollbar rendering (overlay vs. reserved-space scrollbars differ by platform) that will drift; prefer measuring the actual rendered delta.
- [x] Re-run `frontend/src/lib/terminalSizeProbe.test.ts` after the fix — its existing assertions hardcode expected `cols`/`rows` values (e.g. `toHaveBeenCalledWith(137, 41)`) against a jsdom-mocked terminal; update those expected values if the fix legitimately changes the computed `cols` by one, but do not weaken the test's precision (no `toBeCloseTo`/range assertions) to paper over an unresolved off-by-one.

<!-- Updated: 2026-08-15 -->
**Root cause was not the scrollbar hypothesis — corrected during execution.** Traced `@xterm/addon-fit`'s `proposeDimensions()`: it computes `cols` from `getComputedStyle(...).width` on the `term.open()` target (synchronous, no race) minus a fixed constant that's identical for probe and real terminal — `.xterm-viewport`'s CSS scrollbar is never live-measured by `fit()`, so there was no scrollbar/timing race to begin with. The actual bug: `getProbeMount()`'s `mount` div was a *direct child* of the `p-5` wrapper, but the real terminal's equivalent mount (`xtermContainerRef`) sits one level deeper, inside `captureRef` — a div with an unconditional 1px `border` (`LogTail.tsx` ~L657-661, present in every interaction-state branch). That ancestor border isn't in the probe's DOM at all, so the probe measured 2px (1px × 2 sides) more available width than the real terminal ever has, which at `fontSize: 11` was enough to tip `Math.floor(availableWidth / cellWidth)` up by exactly one column — matching the user's reported symptom exactly, just via a different mechanism than "scrollbar". Fixed by adding a `capture` div (`border border-line`) between `inner` and `mount` in `getProbeMount()`, mirroring `captureRef`'s border, plus `overflow-hidden` on `mount` to mirror `xtermContainerRef`. `terminalSizeProbe.test.ts`'s mocked `Terminal`/`FitAddon` don't exercise real CSS geometry, so no test expectations needed updating (verified by reading the mock setup before concluding this, not assumed) — `npx vitest run src/lib/terminalSizeProbe.test.ts` (3/3 pass) and `npx tsc --noEmit` both clean. Real-browser confirmation deferred to Step 5.

### 5. Manual verification pass  <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Run `make dev` (or the project's `/run` skill) and open the AgentDetailModal for a live agent.
- [DEFERRED-TO-UAT] Confirm: modal opens with the amber "Direct Input — keys go to …" banner already visible and the terminal focused, with no extra click needed.
- [DEFERRED-TO-UAT] Confirm: double-clicking the terminal expands it to fill the modal (matches pressing `⌥F`), and double-clicking again (or `⌥F`, or the icon button) collapses it back.
- [DEFERRED-TO-UAT] Confirm: `⌘←`/`⌘→` (or `Ctrl+←`/`Ctrl+→` on non-Mac) still navigates between agents with the terminal auto-focused on open.
- [DEFERRED-TO-UAT] Confirm: pressing Escape once shows the "press esc again" hint; pressing Escape twice within 800ms closes the modal; `⌘/Ctrl+Escape` still sends a literal Escape to the agent.
- [DEFERRED-TO-UAT] Confirm: for an agent with `!agent.windowPresent`, the "Details" panel is open by default and the "Create window" button is visible without an extra click.
- [DEFERRED-TO-UAT] Confirm: for an agent with queued tasks, the "Queued tasks (N)" panel is open by default; for an agent with none, it's collapsed.
- [DEFERRED-TO-UAT] Confirm the Step 4 scrollbar fix: open a live terminal wide enough to trigger wrapping and print a long line (e.g. `ls -la` on a wide directory, or ask the agent to echo a long string) — the line should wrap exactly at the visible edge (not one character early), and the block cursor should sit on the character it's actually at, not one column/row behind.
- [DEFERRED-TO-UAT] No automated frontend test runner exists in this repo for component-level UI checks (per prior task notes, e.g. TASK-114) — this verification is manual/human-gated; note this explicitly in the UAT file.

<!-- Updated: 2026-08-15 -->
All items in this step are runtime/E2E by nature (dev server, live browser, tmux/terminal interaction) — per `wiki/guides/command-anti-patterns.md#verification-belongs-to-the-right-phase`, deferred to UAT generation/walkthrough rather than executed inline during tackle, matching TASK-130's own precedent for its equivalent step.
