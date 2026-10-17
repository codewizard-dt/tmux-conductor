---
id: UAT-0226
aliases: [UAT-0226]
title: "UAT: Replace activeTask with the last payload in the detail-pane strip"
status: pending
task: TASK-0226
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0226 — UAT: Replace activeTask with the last payload in the detail-pane strip

implements::[[TASK-0226]]

> **Source task**: [[TASK-0226]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Dependencies installed in `frontend/` (`cd frontend && npm install` if `node_modules` is missing). Every case except UAT-EDGE-005 (static inspection) and UAT-MANUAL-001 runs under vitest/jsdom with no dev server, no host-server and no tmux.
- [ ] Concurrency caveat (do not treat as a TASK-0226 gap): other sessions are concurrently editing `frontend/src/components/AgentList.tsx`, `AgentList.test.tsx` and `BackgroundProcessesTab.tsx` (bg-restart / worktree work, TASK-0227 / TASK-0225 UAT). The full `AgentList.test.tsx` run, `tsc --noEmit` and eslint can therefore be transiently red in code that does not belong to TASK-0226 (for example `BgRestartButton is not defined`, or TS2375 / TS2339 at `BackgroundProcessesTab` / `BgRestartButton.test.tsx` sites). Every command below is scoped with `-t` to TASK-0226's own tests.
- [ ] For UAT-MANUAL-001 only: the dashboard is running (`make dev`, frontend `http://localhost:4321/`) against a real agent fleet with the Claude Code hooks installed. Do NOT restart the dev servers, kill tmux windows, run `install-hooks.sh` against the real `~/.claude`, or edit `~/.claude/settings.json`.

Source under test:
- `frontend/src/components/AgentList.tsx`: `AgentDetailView` calls `const lastPayload = useLastPayload(agent.id)` unconditionally at the top (before any other hook or early return) and renders `lastPayload && (<div className="flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate" title={lastPayload.text}>{firstLinePreview(lastPayload.text)}</div>)` directly under the header and above the shared error banner. The `Agent` interface still declares `activeTask: string | null` (API unchanged); nothing in the strip reads it.
- `frontend/src/lib/lastPayload.ts` (TASK-0224, read-only here): `useLastPayload(agentId)` via `useSyncExternalStore`, `firstLinePreview(text)` (first non-empty trimmed line + `' …'` when more non-empty lines follow), `saveLastPayload` (newest `ts` wins, 2000-char cap, whitespace-only rejected).
- `frontend/src/components/AgentList.test.tsx`: 2 rewritten TASK-154 tests (names end `(TASK-0226)`), describe `AgentDetailView last-payload strip (TASK-0226)` (4 tests, written by the tackle), and describe `AgentDetailView last-payload strip: navigation, placement and SSE mirror (TASK-0226 UAT)` (4 tests, added by this generation run). All 10 are matched by `-t "TASK-0226"`.

State of the tree at generation time: TASK-0227 (sidebar card) has already landed, so the sidebar card no longer renders `agent.activeTask` either; the tackle's "the card still shows activeTask until TASK-0227" wording is obsolete and the affected test comments were already updated. UAT-EDGE-006 records that cross-check.

Coverage note: every case except UAT-EDGE-005 (static inspection) and UAT-MANUAL-001 is unit-backed by a file-scoped command that was run at generation time (`-t "TASK-0226"`: 10 passed; `lastPayload.test.ts`: 47 passed; eslint clean on `AgentList.test.tsx`). UAT-MANUAL-001 is `[DEFERRED-TO-UAT manual]` and was NOT performed at generation time.

---

## Test Cases

### UAT-UI-001: The strip under the detail header shows the stored payload, full width, mono, with the full text in title
- **Page**: dashboard Agents page (`/`), agent detail pane (`role="region"`, name `<agent> detail`)
- **Description**: with a payload stored for the open agent (`conductor:lastPayload:<id>` = `{ text: 'npm run build', ts, source: 'hook' }`) and `agent.activeTask` null, the strip renders the payload text; it keeps `font-mono` and `text-[11px]`, uses the exact class string `flex-shrink-0 border-b border-line bg-canvas/50 px-5 py-1.5 font-mono text-[11px] text-muted-2 truncate` (a plain full-width block: no `w-`, `max-w-` or `inline` class), has `title` equal to the full text, and its previous sibling is the header that contains the agent name.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  2 passed` (`shows the last-payload strip directly under the header when a payload is stored for the agent (TASK-0226)` and `renders the strip full width with the documented class string, directly under the header`).
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (the first test was rewritten by the TASK-0226 tackle from the TASK-154 activeTask row test; the second, class-string / placement, was added by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "last-payload strip directly under the header|full width with the documented class string"` — verified: 2 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-UI-002: A multi-line payload shows the first non-empty line plus ' …' with the whole text in title
- **Page**: agent detail pane
- **Description**: payload `'first line\nsecond line\nthird'` renders as `first line …` (first non-empty line + space + ellipsis); the `title` attribute is the whole multi-line string, unmodified.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. `getByText('first line …')` finds the strip and its `title` equals `'first line\nsecond line\nthird'`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `shows the first line plus an ellipsis for a multi-line payload, with the whole text in title`, written by the TASK-0226 tackle). Helper-level rules (leading blank lines, CRLF, trailing blanks, empty) are covered in `frontend/src/lib/lastPayload.test.ts` (`firstLinePreview (TASK-0220 rule c)`).
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "shows the first line plus an ellipsis for a multi-line payload"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-UI-003: A long single-line payload is CSS-truncated and keeps the full text in title
- **Page**: agent detail pane
- **Description**: a 255-character single-line payload renders in a strip that has the `truncate` class (single-line overflow is CSS, not JS slicing); the DOM text and the `title` are the full stored text.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. `getByTitle(<full text>)` matches; `className` contains `truncate`; the element's text content equals the full text.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `truncates a long single-line payload with CSS and keeps the full text in title`, written by the TASK-0226 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "truncates a long single-line payload with CSS"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-001: No stored payload renders nothing, even when agent.activeTask is set
- **Scenario**: an agent whose `activeTask` is `'npm run build'` (the old strip trigger) but with nothing in the last-payload store. The strip must not render at all (not an empty bordered strip), and `activeTask` alone must not feed it.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. Within the detail region there is no element with `title` `'npm run build'` and no text `'npm run build'`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `renders no last-payload strip without a stored payload, even when agent.activeTask is set (TASK-0226)`, rewritten by the TASK-0226 tackle from the TASK-154 `activeTask is null` test)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "renders no last-payload strip without a stored payload"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-002: A payload seeded in localStorage before mount displays on first render and survives a simulated reload
- **Scenario**: `localStorage['conductor:lastPayload:52']` is set to `{ text: 'seeded prompt', ts, source: 'hook' }` before `render(<AgentList />)`. After the strip shows it, the tree is unmounted, the in-memory snapshot cache is reset (as a fresh page load would), and a brand-new `render(<AgentList />)` mounts.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. The strip (found by `title` `'seeded prompt'`) shows `seeded prompt` on the first mount and again after the re-mount, with nothing re-saved in between.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `displays a payload seeded before mount on first render and again after a simulated reload`, written by the TASK-0226 tackle)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "seeded before mount on first render and again after a simulated reload"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-003: The payload wins over agent.activeTask when both are present; activeTask still drives nothing in the strip
- **Scenario**: a `busy` agent has `activeTask: 'transient active task'` (still on the `Agent` payload, as the API keeps sending it) and a stored payload `'stored last payload'` (source `add-task`).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. The detail pane shows `stored last payload` (by text and `title`); neither the text nor a `title` of `'transient active task'` appears anywhere in the pane.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `shows the stored payload, not agent.activeTask, when both are present in the detail pane`, added by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "not agent.activeTask, when both are present in the detail pane"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-001: The strip updates live when the store changes (Add Task path) and ignores other agents' payloads
- **Scenario**: agent 53 has a stored payload `'first prompt'`. While the pane is mounted, `saveLastPayload(53, { text: 'newer prompt', ts: <later>, source: 'add-task' })` runs (what TASK-0223's Add Task submit does). Then a payload is saved for a different agent id (999).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. The strip changes from `first prompt` to `newer prompt` without a remount (the old `title` disappears); the payload saved for agent 999 never appears in agent 53's pane.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `updates when the store changes while mounted, and ignores a payload stored for another agent`, written by the TASK-0226 tackle). Store-level subscribe / storage-event / newest-wins behaviour is covered in `frontend/src/lib/lastPayload.test.ts`; Add Task capture itself is UAT-0223.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "updates when the store changes while mounted, and ignores a payload stored for another agent"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-002: An SSE agent-update carrying lastPrompt lights the strip live, and a later update omitting it keeps it
- **Scenario**: the open agent has no stored payload (no strip). An SSE `agent-update` for it arrives with `lastPrompt: { text: 'from the hook', ts }`; AgentList's TASK-0225 mirror writes it into the store (source `hook`). Then two partial `agent-update`s (`busy`, then `idle`) arrive without `lastPrompt`.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. The strip appears with `from the hook` after the first update (found via `title`); after the busy → idle partial updates it is still displayed (retained until replaced; an omitted `lastPrompt` means "unchanged", never "clear").
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `lights the strip live when an SSE agent-update carries lastPrompt (TASK-0225 mirror), and keeps it when a later update omits it`, added by this generation run). The mirror's own write rules are UAT-0225.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "lights the strip live when an SSE agent-update carries lastPrompt"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-INT-003: Cycling between agents keys the strip per agent id (no leakage) and never trips a hook-order error
- **Scenario**: three active agents in sidebar order A (`nav-a-agent`, id 61, payload `'payload for A'`), B (`nav-b-agent`, id 62, no payload), C (`nav-c-agent`, id 63, multi-line payload `'c first\nc second'`). Open A, then use the pane's Next / Previous buttons A → B → C → B → A while `console.error` is spied.
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  1 passed`. In B's pane neither A's nor C's payload appears and there is no strip; C's pane shows `c first …` with `title` `'c first\nc second'` and no A payload; returning to B shows no strip again; returning to A shows `payload for A`. No `console.error` call mentions a hook ("Rendered more/fewer hooks", "change in the order of Hooks"), i.e. `useLastPayload(agent.id)` stays unconditional across payload → none → payload transitions.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (test `keys the strip per agent id while cycling: no leakage between agents and no hook-order error`, added by this generation run)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "keys the strip per agent id while cycling"` — verified: 1 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-004: The whole TASK-0226 suite (all 10 tests) is green
- **Scenario**: aggregate run of every test that carries the TASK-0226 name (2 rewritten TASK-154 tests, the tackle's 4-test describe, this run's 4-test describe).
- **Steps**:
  1. Run the unit test command below.
- **Expected Result**: `Tests  10 passed` (other tests skipped by the filter). Also run `cd frontend && npx vitest run src/lib/lastPayload.test.ts` for the store the strip depends on: `Tests  47 passed`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (aggregate of UAT-UI-001..003, UAT-EDGE-001..003, UAT-INT-001..003)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0226"` — verified: 10 passed
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-005: activeTask stays in the Agent type and API, and the hook is called unconditionally at the top of AgentDetailView
- **Scenario**: static inspection. `agent.activeTask` must remain a declared field (only the strip stopped reading it), and `useLastPayload(agent.id)` must be a top-level statement of `AgentDetailView` before other hooks and any early return (never inside the JSX conditional).
- **Steps**:
  1. Run the command below.
  2. Confirm the `activeTask: string | null` line sits inside `interface Agent`, and that of the two `useLastPayload(agent.id)` lines the first belongs to `AgentDetailView` (directly after `const isMac = ...` and the TASK-0226 comment, ahead of the `useState` calls) and the second to the sidebar card `AgentItem` (TASK-0227).
- **Command**:
  ```bash
  grep -n 'activeTask: string | null\|const lastPayload = useLastPayload(agent.id)' frontend/src/components/AgentList.tsx
  ```
- **Expected Result**: exactly 3 lines: one `activeTask: string | null` (the `Agent` interface, near the top of the file), then two `const lastPayload = useLastPayload(agent.id)` lines (`AgentDetailView` first, `AgentItem` second). No `useLastPayload` call appears inside a `lastPayload && (...)` / `if` block. Runtime evidence for hook-order stability is UAT-INT-003.
- **Repeatable Unit Test**: Not applicable: static source inspection; the runtime half (no hook-order error across payload / none / payload) is unit-backed by UAT-INT-003.
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-EDGE-006: The sidebar card no longer renders activeTask either (TASK-0227 has landed); the pane and card show the same payload independently
- **Scenario**: the tackle expected the card to keep rendering `activeTask` "until TASK-0227". TASK-0227 is already in the tree, so the expected state is now: neither the detail strip nor the sidebar card renders `agent.activeTask`; both render the stored payload from `useLastPayload(agent.id)`.
- **Steps**:
  1. Run the unit test command below (TASK-0227's own sidebar tests; they also guard the detail-pane scoping used by UAT-0226's queries).
- **Expected Result**: every test in that describe passes (8 at generation time, 0 failed), including `renders no payload line without a stored payload, even when agent.activeTask is set` and `does not show activeTask on the card when a payload is stored; the payload wins`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (describe `AgentList sidebar card last payload (TASK-0227)`, written by the TASK-0227 tackle). Owned by UAT-0227; referenced here as the cross-check for TASK-0226's "sidebar card" rule.
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "AgentList sidebar card last payload"` — verified: 8 passed (the count grows if TASK-0227 adds tests; judge on zero failures)
- [x] Pass <!-- 2026-09-20 -->

---

### UAT-MANUAL-001: [DEFERRED-TO-UAT manual] Live fleet: submit a prompt to a real agent, see it at the top of the detail pane, after idle, and after a reload
- **Page**: `http://localhost:4321/` — Agents page, a real running agent
- **Description**: live end-to-end check of the display path with a real Claude Code agent (real hook, real SSE, real browser localStorage). Human only: an autonomous agent must NOT perform this.
- **Steps**:
  1. Open the dashboard, select a real agent in the sidebar, open its Direct Input (Interact) and type a message, e.g. `summarise the repo in one line`, then press Enter.
  2. Look at the top of the detail pane, directly under the agent header: the strip shows the submitted message (full width, monospace, small text). Hover it: the tooltip shows the full text.
  3. Submit a multi-line prompt (paste two lines) and confirm the strip shows only the first line followed by ` …`, with the full text on hover.
  4. Wait until the agent finishes and goes idle: the strip still shows the last prompt (it is not cleared when the agent stops being busy).
  5. Reload the page (browser refresh) and reselect the agent: the strip shows the same last prompt immediately.
  6. Select an agent that has never been prompted from this dashboard/hook: no strip and no empty bordered line appear under its header.
- **Expected Result**: the strip shows the last thing you submitted, first line plus ` …` for multi-line with full text in the tooltip, retained after idle and across a reload, and nothing (no empty strip) for an agent with no stored payload.
- **Repeatable Unit Test**: Not applicable: real agent, real hook, real browser storage and a page reload; the deterministic pieces are covered by UAT-UI-001..003, UAT-EDGE-001..003 and UAT-INT-001..003.
- [FAIL: auto-judge: manual test requires human verification (live fleet, real hook, real browser reload; [DEFERRED-TO-UAT manual]) — use /uat-walk] <!-- 2026-09-20 -->
