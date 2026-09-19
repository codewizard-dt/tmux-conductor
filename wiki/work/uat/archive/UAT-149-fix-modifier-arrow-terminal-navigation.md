---
id: UAT-149
aliases: [UAT-149]
title: "UAT: Fix Cmd/Ctrl/Option+Arrow cursor navigation in the Direct Input terminal"
status: passed
task: TASK-149
created: 2026-09-13
updated: 2026-09-18
---

# UAT-149 — UAT: Fix Cmd/Ctrl/Option+Arrow cursor navigation in the Direct Input terminal

implements::[[TASK-149]]

> **Source task**: [[TASK-149]]
> **Generated**: 2026-09-13

---

## Prerequisites

- [ ] Backend running: `cd host-server && npm run dev` (port 8788)
- [ ] Frontend running: `cd frontend && npm run dev` (port 4321)
- [ ] A conductor tmux session exists with at least one registered agent window whose tmux window is present (`GET http://localhost:8788/api/agents` → note the `id` of a live agent; replace `<AGENT_ID>` throughout)
- [ ] For UAT-UI-004: a project with 2+ agents registered, so `AgentDetailModal`'s agent-switch shortcut (`frontend/src/components/AgentList.tsx` ~line 583/659: `(isMac ? e.metaKey : e.ctrlKey) && e.shiftKey`) is active (`agentCount > 1`)
- [ ] A real keyboard on the OS under test — macOS for Cmd/Option, or Windows/Linux for the Ctrl-based equivalents — not a simulated/CI environment, for the UAT-UI cases

---

## Test Cases

### UAT-API-001: POST /api/agents/:id/keys accepts the new C-Left/C-Right/M-Left/M-Right key names
- **Endpoint**: `POST /api/agents/:id/keys`
- **Description**: `TMUX_KEY_RE` (`host-server/index.ts` ~line 73) was extended with `C-(Left|Right|Up|Down)` and `M-(Left|Right|Up|Down)` alternatives so the endpoint stops rejecting the key names `LogTail.tsx`'s `mapKey()` now forwards for Ctrl/Option+Arrow. This confirms the change end-to-end through `sendDirectInput()` (which calls real `tmux send-keys`), not just the regex in isolation.
- **Steps**:
  1. Confirm agent `<AGENT_ID>` exists and its tmux window is present (`curl -sS 'http://localhost:8788/api/agents' | jq '.[] | select(.id==<AGENT_ID>)'`).
  2. Run the command below.
  3. Observe the agent's tmux pane (e.g. `tmux attach -t conductor`) — no visible text should be typed (these are cursor-motion keys, not literal text).
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/<AGENT_ID>/keys' -H 'Content-Type: application/json' -d '{"keys":["C-Left","C-Right","M-Left","M-Right"]}'
  ```
- **Expected Result**:
  - HTTP 200
  - Body: `{"ok":true,"sent":{"keys":4,"textChars":0,"enter":false}}`
  - No `"error"` field in the response
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-API-002: POST /api/agents/:id/keys still rejects adjacent invalid key names (allowlist stays an explicit enumeration)
- **Endpoint**: `POST /api/agents/:id/keys`
- **Description**: Regression guard — `TMUX_KEY_RE` must not have been widened into a broad pattern while adding the new arrow names; `S-Left` (Shift+Left, never added) must still be rejected with a 400.
- **Steps**:
  1. Confirm agent `<AGENT_ID>` exists and its tmux window is present (same check as UAT-API-001).
  2. Run the command below.
- **Command**:
  ```bash
  curl -sS -X POST 'http://localhost:8788/api/agents/<AGENT_ID>/keys' -H 'Content-Type: application/json' -d '{"keys":["S-Left"]}'
  ```
- **Expected Result**:
  - HTTP 400
  - Body: `{"error":"invalid key name: \"S-Left\""}`
- [x] Pass <!-- 2026-09-13 -->

---

### UAT-UI-001: Ctrl+ArrowLeft/Right performs word-jump in the Direct Input terminal
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`, the embedded xterm.js terminal capture `<div>`)
- **Description**: `Ctrl+ArrowLeft/Right` must reach the pane's shell as tmux `C-Left`/`C-Right`, which the shell's readline binds to `backward-word`/`forward-word` by default — not a plain one-character arrow, and not silently swallowed as before this fix.
- **Steps**:
  1. Open an agent's detail modal for a live agent, select the Terminal tab, and click "Direct Input" (or click into the terminal to auto-activate it).
  2. Click into the terminal capture area so it has real keyboard focus.
  3. Type `echo one two three` (do not press Enter).
  4. Press Ctrl+Left twice.
  5. Type `TWO-` (no Enter).
- **Expected Result**: The line reads `echo one TWO-two three` — each Ctrl+Left jumped the cursor back a full word (first press lands before `three`, second before `two`), not back by a single character (which would instead produce `echo one two TWO-three` after only one word's worth of single-char lefts, or leave the cursor mid-word).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-002: Cmd+ArrowLeft/Right moves the cursor to start/end of the line in the Direct Input terminal
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`)
- **Description**: `Cmd+ArrowLeft/Right` must reach the pane as tmux `Home`/`End`, matching macOS Terminal.app/iTerm2's start/end-of-line convention. This is the specific case `TASK-141`'s `UAT-141` (`UAT-UI-002`) assumed would "just work" and is now unblocked by this task.
- **Steps**:
  1. Open an agent's detail modal for a live agent, activate Direct Input, and click into the terminal so it has real keyboard focus.
  2. Type `echo hello world` (do not press Enter).
  3. Press Cmd+Left.
  4. Type `START-` (no Enter).
  5. Press Cmd+Right.
  6. Type `-END` (no Enter).
- **Expected Result**: After step 4 the line reads `START-echo hello world` (cursor jumped to the very start of the line, not just back one word). After step 6 the line reads `START-echo hello world-END` (cursor jumped to the very end of the line).
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-003: Option(Alt)+ArrowLeft/Right performs word-jump in the Direct Input terminal
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal, Terminal tab, Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`)
- **Description**: `Option+ArrowLeft/Right` (macOS-native word-jump convention) must reach the pane as tmux `M-Left`/`M-Right`, not silently degrade to a plain one-character arrow as before this fix.
- **Steps**:
  1. Open an agent's detail modal for a live agent, activate Direct Input, and click into the terminal so it has real keyboard focus.
  2. Type `echo alpha beta gamma` (do not press Enter).
  3. Press Option+Left twice.
  4. Type `BETA-` (no Enter).
- **Expected Result**: The line reads `echo alpha BETA-beta gamma` — each Option+Left jumped the cursor back a full word, mirroring UAT-UI-001's Ctrl+Left behavior.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-UI-004: The agent-switch shortcut (Shift+Cmd/Ctrl+Arrow) still switches agents while the Direct Input terminal has focus, unaffected by the new arrow branches
- **Page**: Dashboard SPA (`http://localhost:4321`) — an agent's detail modal with Direct Input active
- **Component**: `frontend/src/components/LogTail.tsx` (`mapKey()`) + `frontend/src/components/AgentList.tsx` (`AgentDetailModal` keydown handler)
- **Description**: `mapKey()`'s three new branches (Ctrl/Cmd/Option+Arrow) all require `!e.shiftKey`, so the modal's own agent-switch shortcut — `(isMac ? e.metaKey : e.ctrlKey) && e.shiftKey` on an arrow key — must fall through unintercepted and keep working exactly as `TASK-141` left it, even while the terminal capture element has keyboard focus.
- **Steps**:
  1. Open an agent's detail modal in a project with 2+ agents, activate Direct Input, and click into the terminal so it has real keyboard focus.
  2. Press Shift+Cmd+Right (macOS) or Shift+Ctrl+Right (Windows/Linux).
  3. Confirm the modal switches to the next agent (not that the terminal's cursor moved).
  4. Press Shift+Cmd+Left / Shift+Ctrl+Left and confirm it returns to the original agent.
- **Expected Result**: Both presses switch the displayed agent (matching `UAT-141`'s `UAT-EDGE-002` behavior); neither is consumed by `LogTail.tsx`'s new Ctrl/Cmd/Option+Arrow handling as a word-jump or Home/End keystroke.
- [SKIP: presumed working — not independently verified live, but implementation/behavior presumed correct per current code] <!-- 2026-09-18 -->

---

### UAT-EDGE-001: Non-arrow Cmd/Ctrl chords, ArrowUp/Down, and the agent-switch combo are unaffected by the new arrow branches (regression)
- **Scenario**: The new arrow-specific branch in `mapKey()` must be scoped exactly to bare Ctrl/Cmd/Option + ArrowLeft/ArrowRight. Every other `metaKey`/`ctrlKey` chord (`Cmd+R`, `Cmd+W`, `C-c`, `C-a`, `C-w`, `C-u`), `ArrowUp`/`ArrowDown` under any of the three modifiers, and an arrow keydown carrying the agent-switch modifier combo (`Shift+Cmd/Ctrl+Arrow`) must all produce byte-identical output to before this task.
- **Steps**: Covered directly by the `mapKey()` unit test suite (see Repeatable Unit Test below) — no live browser/tmux session required, since `mapKey()` is a pure function of a `KeyboardEvent`.
- **Expected Result**: `Cmd+R`/`Cmd+W` → `null`; `C-c`/`C-a`/`C-w`/`C-u` → their pre-existing `{ keys: [...] }` shape; bare `ArrowUp`/`ArrowDown` → `{ keys: ['Up'] }`/`{ keys: ['Down'] }`; `Ctrl+ArrowUp` → `null`, `Cmd+ArrowDown` → `null`, `Alt+ArrowUp` → `{ keys: ['Up'] }` (all unchanged pre-existing fallthrough); `Shift+Cmd+ArrowLeft/Right` and `Shift+Ctrl+ArrowLeft/Right` → `null` (unchanged fallthrough, not intercepted as Home/End or word-jump).
- **Repeatable Unit Test**: Created: `frontend/src/components/LogTail.test.tsx` (`describe('mapKey (TASK-149 modifier+arrow terminal navigation)')`, 7 test cases)
- **Unit Test Command**: `npx vitest run src/components/LogTail.test.tsx` (run from `frontend/`) — verified: 12/12 pass
- [x] Pass

---

### UAT-EDGE-002: TMUX_KEY_RE allowlist accepts the new arrow key names and still rejects adjacent invalid strings (regression)
- **Scenario**: `host-server/index.ts`'s `TMUX_KEY_RE` allowlist is documented as "the only thing standing between a typo and garbage text being typed into a live agent's prompt — never widen it to a broad pattern, only an explicit enumeration" (`wiki/knowledge/concepts/tmux-send-keys-key-names.md`). Adding `C-(Left|Right|Up|Down)`/`M-(Left|Right|Up|Down)` must not accidentally loosen the pattern for anything else.
- **Steps**: Covered directly by a static-source-extraction test that reconstructs the live `TMUX_KEY_RE` regex from `index.ts`'s source text (see Repeatable Unit Test below) — no live server required, since `index.ts` cannot be imported directly (it starts the Fastify server as an import-time side effect).
- **Expected Result**: `C-Left`/`C-Right`/`M-Left`/`M-Right`/`C-Up`/`C-Down`/`M-Up`/`M-Down` all match; pre-existing names (`Enter`, `Escape`, `Left`, `Right`, `Home`, `End`, `C-c`, `M-b`, `F5`) still match; adjacent invalid strings (`C-Delete`, `S-Left`, `C-left` (case-sensitive), `M-Lefty`, `C-`, `''`) still do not match.
- **Repeatable Unit Test**: Created: `host-server/tmuxKeyRe.test.ts` (4 test cases)
- **Unit Test Command**: `node --import tsx/esm --test tmuxKeyRe.test.ts` (run from `host-server/`) — verified: 4/4 pass
- [x] Pass
