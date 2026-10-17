---
id: UAT-132
aliases: [UAT-132]
title: "UAT: Fix context-window limit lookup in host-server/context.ts"
status: passed
task: TASK-132
created: 2026-09-17
updated: 2026-09-19
---

# UAT-132 — UAT: Fix context-window limit lookup in host-server/context.ts

implements::[[TASK-132]]

> **Source task**: [[TASK-132]]
> **Generated**: 2026-09-17

---

## Prerequisites

- [ ] Backend running: `cd host-server && npm run dev` (port 8788) — this run used the already-live dev host-server, which hot-reloads on file changes (`tsx watch`), so the fix took effect without a manual restart.
- [ ] At least one live agent running Claude Sonnet 5 (the model this bug originally mis-classified), for the live API evidence below.

---

## Test Cases

### UAT-API-001: Live agents running Sonnet 5 now report the correct 1M context limit and high confidence, not the false 200k/100%-overflow reading
- **Endpoint**: `GET /api/status`
- **Description**: This is the exact bug the task fixes, verified against real running data: before this fix, any non-Opus model (including Sonnet 5, which has a 1,000,000-token window) fell through to the generic `conductor.conf` 200k default, so a Sonnet 5 agent with genuine 300k+ usage would show a false 100%-overflow reading. This queries the live, already-running host-server (which picked up the fix via its own `tsx watch` hot-reload — no restart needed) and inspects real Sonnet 5 agents' context fields.
- **Steps**:
  1. Run the command below against the live dev host-server.
  2. Filter for agents whose `model` is `"Sonnet 5"`.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status'
  ```
- **Expected Result**: Every agent with `model: "Sonnet 5"` reports `contextLimit: 1000000` (not `200000`) and `contextLimitConfident: true`, with `contextPct` computed against the 1M denominator (so genuine sub-100% usage no longer clamps to a false 100%).
- **Actual Result** (captured live, 2026-09-17): 5 live Sonnet 5 agents (`cryptwiz-1`, `tmux-conductor-2`, `tmux-conductor-2-copy`, `tmux-conductor-3`, `tmux-conductor-3-copy`) all report `contextLimit: 1000000`, `contextLimitConfident: true`, with `contextPct` values of 55/28/47/23/26 — all correctly sub-100% against genuine token usage between 233k and 551k. A Haiku 4.5 agent (`bootstrap-1-copy-2`) correctly reports `contextLimit: 200000, contextLimitConfident: true` (Haiku 4.5 is genuinely 200k — the table entry, not a fallback, since it's an explicit table hit).
- [x] Pass <!-- 2026-09-17: verified live against the already-running, hot-reloaded dev host-server -->

---

### UAT-EDGE-001: modelContextLimit() resolves the current model lineup by prefix, including dated-suffix IDs, and returns null for unrecognized models
- **Scenario**: The core lookup table must match real model IDs by prefix (not exact equality, since dated IDs like `claude-sonnet-4-5-20250929` exist), and must never guess a limit for a model it doesn't recognize — returning `null` rather than a possibly-wrong number.
- **Steps**: Covered directly by the new `host-server/context.test.ts` (see Repeatable Unit Test below) — no live server required, since `modelContextLimit` is a pure function.
- **Expected Result**: `claude-sonnet-5` → `1_000_000`; `claude-sonnet-4-5` → `200_000`; `claude-opus-5` → `1_000_000`; `claude-sonnet-4-5-20250929` (dated suffix) → `200_000`; an unrecognized model ID → `null`.
- **Repeatable Unit Test**: Created: `host-server/context.test.ts` (7 tests total, covering `modelContextLimit()`'s 5 table/prefix/null cases)
- **Unit Test Command**: `node --import tsx/esm --test context.test.ts` (run from `host-server/`) — verified: 7/7 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-EDGE-002: getAgentContext() sets contextLimitConfident correctly for both a table-matched model and an unrecognized one
- **Scenario**: A model resolved via the table (or an explicit pane-header `(N context)` annotation) must report `contextLimitConfident: true`; a model that falls through to the generic `conductor.conf` default must report `contextLimitConfident: false`, so the frontend can distinguish a real limit from a guessed one.
- **Steps**: Covered directly by `host-server/context.test.ts`'s two `getAgentContext()` fixture tests (a table-matched-model fixture and an unrecognized-model fixture) — no live server required.
- **Expected Result**: Table-matched fixture → `contextLimitConfident: true`, `contextLimit: 1_000_000`. Unrecognized-model fixture → `contextLimitConfident: false`, `contextLimit` equal to the generic fallback parameter passed in.
- **Repeatable Unit Test**: Created: `host-server/context.test.ts` (same file as UAT-EDGE-001, the `getAgentContext` confidence-branching tests)
- **Unit Test Command**: `node --import tsx/esm --test context.test.ts` (run from `host-server/`) — verified: 7/7 pass
- [x] Pass <!-- 2026-09-17 -->

---

### UAT-UI-001: The dashboard renders a visually distinct "unconfirmed" state for a low-confidence context limit, instead of a normal-colored percentage bar
- **Page**: Dashboard SPA (`http://localhost:4321`) — the agent list, `ContextMeter`
- **Component**: `frontend/src/components/AgentList.tsx` (`ContextMeter()`)
- **Description**: When `agent.contextLimitConfident === false` (a model not in the table and no explicit pane-header annotation), the context-usage bar must render in a neutral grey rather than the normal green/amber/red `contextColor(pct)` scale, with tooltip text making the uncertainty explicit rather than presenting a possibly-wrong percentage as fact.
- **Steps**:
  1. Open the dashboard with an agent whose model is not in `CLAUDE_MODEL_CONTEXT_WINDOWS` and has no pane-header context annotation (or simulate via the unit test fixture, since no such live agent currently exists in this environment — every live agent observed in UAT-API-001 was `contextLimitConfident: true`).
  2. Hover the context bar for that agent.
- **Expected Result**: The bar renders in `#9a9da5` (neutral grey), and the tooltip reads `"~Nk tokens used, context window size unconfirmed for this model"` instead of `"N% of context window used"`.
- **Repeatable Unit Test**: Not applicable: this is a pure CSS-color/tooltip-string rendering check with no unrecognized-model live agent currently available in this environment to drive it through a real browser render — the underlying `agent.contextLimitConfident === false` branch condition itself is exercised by `context.test.ts`'s unrecognized-model fixture (UAT-EDGE-002), and the exact color/string values were confirmed present in `ContextMeter()`'s source by direct inspection during tackle, but the actual rendered pixel/tooltip has not been visually confirmed in a live browser.
- [SKIP: user-directed — closing out] <!-- 2026-09-19 -->

---

## Gaps

- UAT-UI-001 could not be driven end-to-end because no currently-live agent in this environment has an unrecognized model (every live agent observed is either Sonnet 5 or Haiku 4.5, both table hits) — a human `/uat-walk` with a deliberately-unrecognized model (or a dashboard screenshot against the unit test's mocked fixture data) would close this gap.
