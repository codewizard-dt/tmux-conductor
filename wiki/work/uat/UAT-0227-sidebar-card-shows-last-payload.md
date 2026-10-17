---
id: UAT-0227
aliases: [UAT-0227]
title: "UAT: Replace activeTask with the last payload in the sidebar agent card"
status: pending
task: TASK-0227
created: 2026-09-20
updated: 2026-09-20
---

# UAT-0227 — UAT: Replace activeTask with the last payload in the sidebar agent card

implements::[[TASK-0227]]

> **Source task**: [[TASK-0227]]
> **Generated**: 2026-09-20

---

## Prerequisites

- [ ] Unit-backed cases (EDGE) need only `frontend/node_modules` (jsdom + vitest); no dev server. Run them from `frontend/`.
- [ ] Live cases (API-001, UI-001) need the dev servers: `make dev` (host-server on port 8788, frontend on port 4321). The Agents page is the `/` route. Viewport at least 768px wide.
- [ ] **Concurrent-edit caveat (not a gap):** another session is editing `AgentList.tsx` and `BackgroundProcessesTab.tsx` (bg-restart / worktree work). `tsc --noEmit` and eslint are transiently red in code that does not belong to TASK-0227 (`BgLastRestart` unused near `AgentList.tsx` L17; TS2322 at the `BackgroundProcessesTab` call site). Do not judge this UAT on repo-wide typecheck or lint; every unit command below is scoped to TASK-0227's tests with `-t`.
- [ ] Guardrails for anyone running the live cases: never run `install-hooks.sh` against the real `~/.claude`, never edit `~/.claude/settings.json`, never kill or restart tmux windows/sessions or the running dev servers. UI-001 is a human check; do not automate it against the real fleet.

Source under test:
- `frontend/src/components/AgentList.tsx` `AgentItem` (compact sidebar card): `useLastPayload(agent.id)`, `lastPayloadPreview = firstLinePreview(lastPayload.text)`, and the span in the slot that used to show `agent.activeTask` (`block truncate font-mono text-[10px] text-muted-2`, `title={lastPayload.text}`), rendered only when `lastPayload && lastPayloadPreview !== ''`.
- `frontend/src/lib/lastPayload.ts` (TASK-0224): `useLastPayload`, `firstLinePreview`, per-agent cached `getLastPayloadSnapshot`.
- `frontend/src/components/AgentList.tsx` `SidebarRailDot` (collapsed 48px rail; renders a status dot only).
- `frontend/src/lib/api.ts` and `host-server/index.ts`: `activeTask` stays in the `Agent`/status contract.

Coverage note: the EDGE cases are unit-backed in `frontend/src/components/AgentList.test.tsx` (`describe('AgentList sidebar card last payload (TASK-0227)')`, 6 cases from the implementation, plus `describe('AgentList sidebar card last payload (TASK-0227) UAT edge cases')`, 2 cases added by this UAT). jsdom does no layout, so CSS-driven truncation and the 320px width are asserted through class names and full text in the DOM; the visual result is UAT-UI-001 (`[DEFERRED-TO-UAT manual]`).

---

## Test Cases

### UAT-API-001: activeTask is still part of the status contract
- **Endpoint**: `GET /api/status`
- **Description**: TASK-0227 replaces only the card's display of `activeTask`. The field must remain on every agent in the status payload (and in the `Agent` interface, see UAT-EDGE-010).
- **Steps**:
  1. Run the curl command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '[.agents[] | has("activeTask")] | unique'
  ```
- **Expected Result**: `[true]` (every agent object has the `activeTask` key, whether its value is a string or `null`). Empty `[]` means no agents are registered, which is a prerequisite failure, not a pass.
- **Repeatable Unit Test**: Not applicable: exercises the live host-server payload; the source assertion is UAT-EDGE-010
- [ ] Pass

---

### UAT-UI-001: [DEFERRED-TO-UAT manual] Live check of the card line, long-string width and the collapsed rail
- **Page**: `http://localhost:4321/` (Agents page, left sidebar)
- **Description**: Real-browser confirmation of what jsdom cannot show: the last message survives a reload on each card, a very long unbroken payload is clipped with an ellipsis without widening the 320px sidebar, and the collapsed rail shows dots only. **Do NOT perform this case autonomously; it is a human check on the real fleet.**
- **Steps**:
  1. Open the dashboard with at least two agents. In one agent's terminal (Interact mode) or its Add Task box, send a short message such as `hello from uat 0227`. In a second agent send a different message.
  2. Reload the page (hard reload). Look at both sidebar cards and open each agent's detail pane.
  3. Send a very long unbroken payload to a third (throwaway) agent, for example a single 300-character token with no spaces, and look at that card. Repeat with a multi-line message (two or three lines).
  4. Click the sidebar collapse toggle to shrink the sidebar to the 48px rail, then expand it again.
- **Expected Result**:
  1. Each card shows its own agent's last message under the name/branch rows in small monospace muted text (same look as the old active-task line). The card's line and the detail pane's strip show the same text.
  2. The long unbroken payload is cut off with an ellipsis at the card's right edge; the sidebar stays 320px wide with no horizontal scrollbar and no wrapped second line. Hovering the line shows the full text as a tooltip. The multi-line message shows only its first line followed by ` …`.
  3. An agent with no stored payload shows no extra line (no placeholder) and the card looks as it did before the task.
  4. In the collapsed 48px rail only status dots are visible (no payload text); expanding restores the lines.
- **Repeatable Unit Test**: Not applicable: real browser layout, live agents and a real localStorage across a reload
- [ ] Pass

---

### UAT-EDGE-001: The card shows the stored payload in the old activeTask slot with the same classes and the full text in title
- **Scenario**: A payload is stored for an agent and the sidebar card renders. The line must be a `block truncate font-mono text-[10px]` span whose `title` is the full stored text.
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: `getByTitle(text)` inside the sidebar (`role=complementary`, name `Agents`) finds the span; its text content equals the stored text and its class list contains `truncate`, `block`, `font-mono` and `text-[10px]`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('shows a stored payload on the card as a truncated mono line with the full text in title')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*truncated mono line"`
- [ ] Pass

---

### UAT-EDGE-002: A long single-line payload is truncated by CSS, not by JavaScript
- **Scenario**: A 254-character single-line payload (`card-` plus 250 `y`). The DOM must hold the whole string; only the `truncate` class clips it visually. Any JS `slice`/`substring` cap in the card would fail this case.
- **Steps**: Run the unit test command below (same test as UAT-EDGE-001; this case owns the full-text-in-DOM assertion).
- **Expected Result**: 1 test passes: `expect(line).toHaveTextContent(text)` holds for the full 254-character string (no `…` inserted by JS for a single-line payload) and the span has the `truncate` class.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('shows a stored payload on the card as a truncated mono line with the full text in title')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*truncated mono line"`
- [ ] Pass

---

### UAT-EDGE-003: A multi-line payload shows its first line plus " …", whole text in title
- **Scenario**: Stored text `card first line\nsecond line\nthird`.
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: the sidebar contains text `card first line …`, that element's `title` is the whole three-line text, and no element in the sidebar matches `/second line/`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('shows only the first line plus an ellipsis for a multi-line payload, whole text in title')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*only the first line plus an ellipsis"`
- [ ] Pass

---

### UAT-EDGE-004: With no stored payload the card renders nothing, even when agent.activeTask is set
- **Scenario**: Agent has `activeTask: 'npm run build'` and no stored payload. The field is no longer displayed in the card and no placeholder line appears.
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: neither `queryByText('npm run build')` nor `queryByTitle('npm run build')` finds anything in the sidebar.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('renders no payload line without a stored payload, even when agent.activeTask is set')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*renders no payload line without a stored payload"`
- [ ] Pass

---

### UAT-EDGE-005: A whitespace-only stored payload also renders nothing
- **Scenario**: The raw key `conductor:lastPayload:91` holds `{"text":"  \n \t ","ts":...,"source":"hook"}` (seeded around `saveLastPayload`, which itself rejects blank text) and the agent has `activeTask` set. The card must render no last-payload span and no `activeTask` text (task Approach, "Empty state": empty/whitespace renders nothing).
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: the agent's card contains no `span.font-mono.truncate` and no `npm run build` text.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList sidebar card last payload (TASK-0227) UAT edge cases')`, added by /uat-generate)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*whitespace-only stored payload"`
- [ ] Pass

---

### UAT-EDGE-006: A stored payload wins over activeTask
- **Scenario**: Agent has both `activeTask: 'transient task'` and a stored payload `stored payload` (source `add-task`).
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: the sidebar shows `stored payload` (title and text) and `queryByText('transient task')` is null.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('does not show activeTask on the card when a payload is stored; the payload wins')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*the payload wins"`
- [ ] Pass

---

### UAT-EDGE-007: Two agents keep separate payloads and a live store update changes only the affected card
- **Scenario**: Agents 85 and 86 have different payloads. `saveLastPayload(85, …newer…)` runs after mount.
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: each card shows only its own payload before the update; after it, card 85 shows `newer for one` (old text gone) and card 86 still shows `payload for two`.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('keeps separate payloads per agent and updates a single card when the store changes')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*keeps separate payloads per agent"`
- [ ] Pass

---

### UAT-EDGE-008: A store update for one agent does not re-read storage for, or replace the line of, an unaffected card (snapshot stability)
- **Scenario**: With two cards mounted, spy on `Storage.prototype.getItem`, then save a newer payload for agent 92. `useSyncExternalStore` snapshots must be cached per agent, so agent 93's key is never re-read and its existing DOM line node is the same element afterwards. This is the per-card hook-cost concern from the task's Approach ("Hook cost with many agents").
- **Steps**: Run both unit test commands below.
- **Expected Result**: Both pass. The card test: `getItem` was called with `conductor:lastPayload:92` (spy is live) but never with `conductor:lastPayload:93`, and `within(cardTwo).getByTitle('stable two')` is the identical element as before. The lib test: `getLastPayloadSnapshot(1)` returns the same object until a save or clear.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`describe('AgentList sidebar card last payload (TASK-0227) UAT edge cases')`, added by /uat-generate); backed by existing `frontend/src/lib/lastPayload.test.ts` (`describe('getLastPayloadSnapshot')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*does not re-read storage" && npx vitest run src/lib/lastPayload.test.ts -t "getLastPayloadSnapshot"`
- [ ] Pass

---

### UAT-EDGE-009: The collapsed 48px rail renders no payload text
- **Scenario**: A payload is stored and shown in the expanded sidebar; the user clicks `Collapse sidebar`. The rail branch mounts `SidebarRailDot`, not `AgentItem`, so payload text must be absent from the DOM (guards a future refactor that mounts `AgentItem` in the rail).
- **Steps**: Run the unit test command below.
- **Expected Result**: 1 test passes: expanded sidebar has `getByTitle('rail hidden payload')`; after collapse `sidebar.style.width` is `48px`, the dot button named `rail-payload-agent` exists, and both `queryByText` and `queryByTitle` for the payload return null.
- **Repeatable Unit Test**: Created: `frontend/src/components/AgentList.test.tsx` (`it('collapsed 48px rail renders dots only, with no payload text or title')`)
- **Unit Test Command**: `cd frontend && npx vitest run src/components/AgentList.test.tsx -t "TASK-0227.*collapsed 48px rail"`
- [ ] Pass

---

### UAT-EDGE-010: activeTask remains in the Agent type and API client
- **Scenario**: Static source check. The task must not remove `activeTask` from the `Agent` interface (`frontend/src/lib/api.ts`) or the host-server status contract; only its display in the card was replaced.
- **Steps**: Run the command below.
- **Command**:
  ```bash
  grep -nE 'activeTask: string \| null' frontend/src/lib/api.ts host-server/index.ts
  ```
- **Expected Result**: At least one match in `frontend/src/lib/api.ts` (the `Agent` interface, currently line 281) and at least one in `host-server/index.ts` (the status snapshot types). No match is a failure.
- **Repeatable Unit Test**: Not applicable: static type-declaration check; the type is also exercised at compile time by the `activeTask: ...` fixtures in `AgentList.test.tsx` (UAT-EDGE-004, UAT-EDGE-006)
- [ ] Pass

---

### UAT-EDGE-011: firstLinePreview has a single definition, imported from lib/lastPayload
- **Scenario**: Task Approach, "Reuse, do not duplicate": the card and the detail strip must call the same `firstLinePreview` from `frontend/src/lib/lastPayload.ts`, with no second copy in `AgentList.tsx` or elsewhere in `frontend/src`.
- **Steps**: Run both commands below.
- **Command**:
  ```bash
  grep -rnE '(function|const) firstLinePreview' frontend/src
  grep -nE "firstLinePreview.*from '\.\./lib/lastPayload'" frontend/src/components/AgentList.tsx
  ```
- **Expected Result**: The first command prints exactly one line, in `frontend/src/lib/lastPayload.ts` (`export function firstLinePreview(text: string): string`). The second prints the import line in `AgentList.tsx` (`import { clearLastPayload, firstLinePreview, … } from '../lib/lastPayload'`).
- **Repeatable Unit Test**: Not applicable: static single-definition check; the helper's behaviour is covered by `frontend/src/lib/lastPayload.test.ts` (`describe('firstLinePreview (TASK-0220 rule c)')`)
- [ ] Pass
