---
id: TASK-0226
aliases: [TASK-0226]
title: "Replace activeTask with the last payload in the detail-pane strip"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0225, TASK-0224]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0226]]"
tags: [last-payload, agents, dashboard, frontend, detail-pane]
---

# TASK-0226 — Replace activeTask with the last payload in the detail-pane strip

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0225]]
depends_on::[[TASK-0224]]

> **Roadmap**: ROADMAP-0027 (last user payload per agent), display phase, item "Replace activeTask with the last payload in the detail-pane strip (full width, truncated, full text in title)". Research: `raw/research/last-user-message-capture/index.md`, `raw/research/terminal-typed-command-persistence/index.md`. Storage and display rules: TASK-0220 Decision (newest `ts` wins, 2000-char cap, first non-empty line + ` …`, full capped text in `title`, empty never overwrites).
> **Collision note**: edits `AgentDetailView` in `frontend/src/components/AgentList.tsx` and the TASK-154 describe block in `frontend/src/components/AgentList.test.tsx`. TASK-0227 edits the sidebar card in the same two files, so 0226 and 0227 must be sequenced (0226 first). Other agents edit this repo concurrently: re-locate every anchor with Serena, never trust line numbers.

## Objective

The strip at the top of the agent detail pane currently shows `agent.activeTask`, a transient value that is only set while the agent is `busy`/`awaiting`/`stalled` and disappears when the agent goes idle. Replace it with the agent's **last user payload** (the last thing the user actually submitted, from `useLastPayload(agent.id)`), shown full width, truncated with CSS, with the full capped text in the `title` tooltip. It is retained until replaced, survives page reloads (localStorage) and renders nothing when there is no stored payload. `agent.activeTask` stays in the `Agent` type and the API; the sidebar card keeps rendering it until TASK-0227.

## Approach

- **Data source.** `useLastPayload(agentId: number)` from `frontend/src/lib/lastPayload.ts` (TASK-0224) returns the stored `{ text, ts, source }` or `null`, via `useSyncExternalStore`, so the strip updates when TASK-0225 mirrors an SSE `lastPrompt` into the store or when Add Task saves one (TASK-0223). No new props are needed on `AgentDetailView`: it already has `agent`, and the hook is keyed by `agent.id`.
- **Display text.** Use the shared `firstLinePreview(text)` helper from the same module (TASK-0220 decision c; it is defined in the `lastPayload.ts` item, TASK-0224). Confirm the exported name when implementing; if TASK-0224 named it differently, use its actual export rather than adding a second helper. `title` receives the full stored text (already capped at 2000 chars by the store, do not re-cap or trim).
- **Styling unchanged.** Keep the exact class string `flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate`. The strip is already full width (a block child of the detail column); single-line overflow stays the CSS `truncate`.
- **Empty rule.** No stored payload (or `null`) renders nothing, not an empty strip. This deliberately drops the old "show activeTask while busy" behaviour for the strip.
- **Out of scope**: the sidebar agent card (TASK-0227); removing `activeTask` from the type/API (stays); the store, the SSE mirror and Add Task capture (TASK-0224, 0225, 0223).

## Steps

### 1. Re-verify anchors  <!-- agent: Explore -->

- [x] With Serena `find_symbol` (`AgentDetailView`, `include_body=true`, in `frontend/src/components/AgentList.tsx`) confirm the strip is still the `agent.activeTask && (<div className="flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate" title={agent.activeTask}>…)` block directly above the shared error banner (`renameError ?? roleError ?? …`), and that it sits inside `AgentDetailView` (not the sidebar card component, which has its own `agent.activeTask` span with `text-[10px]`).
- [x] Confirm `frontend/src/lib/lastPayload.ts` exists and exports `useLastPayload`, `firstLinePreview` (or the name TASK-0224 chose), `loadLastPayload`, `saveLastPayload`, `clearLastPayload`, and the localStorage key `conductor:lastPayload:<agentId>` with value `{ text, ts, source: 'hook' | 'add-task' }`.

### 2. Swap the strip to the last payload  <!-- agent: general-purpose -->

- [x] `frontend/src/components/AgentList.tsx`: import `useLastPayload` and `firstLinePreview` from `../lib/lastPayload`. In `AgentDetailView`, call `const lastPayload = useLastPayload(agent.id)` unconditionally near the other hooks at the top of the component (never inside the JSX conditional; keep hook order stable).
- [x] Replace the `agent.activeTask && (...)` strip with `lastPayload && (<div className="<same classes>" title={lastPayload.text}>{firstLinePreview(lastPayload.text)}</div>)`. Do not touch the sidebar card's `agent.activeTask` span or the `Agent` interface.
- [x] Update any comment above the strip that still says it shows the most recently dispatched command.

### 3. Update and add tests  <!-- agent: general-purpose -->

In `frontend/src/components/AgentList.test.tsx`, the `describe('AgentDetailModal header emphasis and last-command row (TASK-154)', …)` block (find via Serena, do not use line numbers). The file-level `beforeEach` already calls `localStorage.clear()`, so seed `localStorage` before `render(<AgentList />)` using `saveLastPayload` (or `localStorage.setItem('conductor:lastPayload:<id>', JSON.stringify({ text, ts, source: 'hook' }))`).

- [x] Rewrite `'shows the most-recent-dispatched-command row directly under the header when agent.activeTask is set'`: seed a stored payload `'npm run build'` for the agent id, leave `activeTask` null, open the detail, assert the strip (`within(dialog).getByTitle('npm run build')`) has the text and keeps `font-mono` and `text-[11px]`. Rename to describe the last-payload strip.
- [x] Rewrite `'renders no most-recent-command row when agent.activeTask is null'`: no stored payload, assert no strip renders, and additionally set `activeTask: 'npm run build'` on the agent to prove `activeTask` alone no longer renders the strip in the detail pane (scope the query to the dialog/detail region, because the sidebar card may still show `activeTask` until TASK-0227).
- [x] Add: multi-line payload (`'first line\nsecond line\nthird'`) shows `first line …` as text content and the whole multi-line string as the `title` (use a `title` matcher function or `getByText('first line …')` then `.getAttribute('title')`).
- [x] Add: a payload seeded in `localStorage` before mount is displayed on first render, and is still displayed after `unmount()` followed by a fresh `render(<AgentList />)` (reload simulation).
- [x] Add: the strip updates when the store changes while mounted (`saveLastPayload` with a newer `ts` inside `act`), and a stored payload for a different agent id does not appear.
- [x] Add a long single-line payload (over 200 chars) test asserting the `truncate` class is present and the full text is in `title`.

### 4. Wiki docs  <!-- agent: general-purpose -->

- [x] Checked at task-creation time: `wiki/knowledge/entities/components/agent-detail-modal.md` does not mention the strip or `activeTask` (no match), so no change is expected. Re-check with Serena `search_for_pattern` for `activeTask|strip`; update the page only if it now documents this strip. `hook-authoritative-last-prompt.md` already describes the target behaviour.

### 5. Verify  <!-- agent: general-purpose -->

- [x] `cd frontend && npm run typecheck && npm run lint && npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts`.
- [DEFERRED-TO-UAT] Human live-fleet check: in the dashboard, submit a prompt to a real agent and confirm the detail-pane strip shows the last prompt (first line + ellipsis for multi-line, full text on hover), stays after the agent goes idle, and survives a page reload. Do not have an autonomous agent perform this.

<!-- Updated: 2026-09-20 02:40 -->

### Implementation notes

- Decision: `firstLinePreview` / `useLastPayload(agent.id)` (numeric id) used as exported by TASK-0224; hook called unconditionally at the top of `AgentDetailView`. There was no comment above the strip to update.
- Tests: the two TASK-154 tests were rewritten in place; a new `describe('AgentDetailView last-payload strip (TASK-0226)')` covers multi-line, seeded/reload, live update + other-agent isolation, and long single-line truncation. Each test calls `__resetLastPayloadCacheForTests()` because `localStorage.clear()` does not invalidate the store snapshot cache.
- Wiki: `agent-detail-modal.md` has no `activeTask`/strip mention, no change needed.
- Verification: `npx vitest run src/components/AgentList.test.tsx src/lib/lastPayload.test.ts` 270 passed; eslint clean on both edited files; `tsc --noEmit` reports only 4 `BgRestartButton.test.tsx` TS2339 errors (another session's concurrent work, not touched). Caveat: concurrent edits to AgentList.tsx/BackgroundProcessesTab.tsx by another session can make full-file gates transiently red.

## Files expected to be touched

- `frontend/src/components/AgentList.tsx`
- `frontend/src/components/AgentList.test.tsx`

## Dependencies

- TASK-0225
- TASK-0224

Blocks TASK-0227 (sidebar card edits the same two files; sequence 0226 first). Not parallel-safe with TASK-0227.

## Notes

Guardrails for whoever implements this task (the autonomous-agent rules for this repo session):

- Never run `install-hooks.sh` against the real `~/.claude` and never edit `~/.claude/settings.json`.
- Never kill or restart tmux windows or sessions, or the running host-server / dev servers (they hot-reload; leave them alone).
- Live-fleet verification is a documented UAT step for a human, not something an autonomous agent performs.
- Concurrent-edit hazard: other agents edit `AgentList.tsx` and its test at the same time. Re-locate every anchor with Serena immediately before editing and make minimal, targeted edits; do not trust line numbers in this file.
- Follow `wiki/guides/mcp-tools.md`: Serena for code exploration and edits, `Read`/`Edit`/`Write` only for markdown and config files.
- The TASK-0220 Decision names the shared helper `firstLinePreview`; the parent request called it `firstLine()`. Use whatever TASK-0224 actually exports.
