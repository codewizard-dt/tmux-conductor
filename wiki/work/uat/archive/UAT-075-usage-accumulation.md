---
id: UAT-075
aliases: [UAT-075]
title: "UAT: Accumulate rolling token totals per agent in agent_usage — usage-store + pricing table + snapshot exposure"
status: passed
task: TASK-075
created: 2026-07-07
updated: 2026-08-15
---

# UAT-075 — UAT: Accumulate rolling token totals per agent in `agent_usage` — usage-store + pricing table + snapshot exposure

implements::[[TASK-075]]

> **Source task**: [[TASK-075-usage-accumulation]]
> **Generated**: 2026-07-07

---

## Prerequisites

- [ ] Dependencies installed in `host-server/` (`npm install` already run; `tsx` and `better-sqlite3` resolvable).
- [ ] `host-server`'s dev server reachable at `http://localhost:8788` for the two API/SSE cases (`make dev` from the repo root, or an already-running `npm run dev` in `host-server/`).
- [ ] Repo-local `./tmp/` directory writable (scratch DBs go in `./tmp/uat-075/`; never system `/tmp`).
- [ ] The 8 existing `host-server/usage-store.test.ts` cases (accumulation, same-process restart idempotency, multi-model cost, `costUSD` passthrough, unknown model, session-change pruning, empty-deltas no-op, pricing longest-prefix) and `db.migration.test.ts`'s `agent_usage` cases already cover pure-function and single-process DB behavior — this UAT does **not** re-test those; it covers the pricing-table integration against the real schema, genuine cross-process restart safety, and the `index.ts` snapshot/SSE wiring the unit tests can't reach.

---

## Test Cases

### UAT-CLI-001: Pricing-table cost math lands correctly through the real `agent_usage` schema and `getAllAgentUsageTotals`
- **Description**: Verifies the mandatory pricing-table path (no `costUSD` in the delta) end-to-end — `recordUsageDeltas()` → real migrated `agent_usage` table → `getAllAgentUsageTotals()` — which the unit tests exercise only via `listAgentUsage`/single-model assertions, not the aggregate-totals read path `buildSnapshot` actually calls.
- **Steps**:
  1. Remove any stale scratch dir: delete `./tmp/uat-075/` at the repo root if present.
  2. From `host-server/`, run the command below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = '../tmp/uat-075';
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const { openDb, createAgent, getAllAgentUsageTotals } = await import('./db.ts');
  const { recordUsageDeltas, resetUsageStore } = await import('./usage-store.ts');
  resetUsageStore();
  const db = openDb(path.join(root, 'scratch.db'));
  const agent = createAgent(db, { name: 'a1', workdir: root, launchCmd: 'claude' });
  recordUsageDeltas(db, agent, [{ agentName: 'a1', sessionId: 'sess-1', model: 'claude-sonnet-5', inputTokens: 1000000, outputTokens: 500000, cacheCreationTokens: 100000, cacheReadTokens: 200000, costUSD: null, ts: '2026-07-06T12:00:00.000Z' }]);
  console.log('totals:', JSON.stringify(getAllAgentUsageTotals(db)));
  "
  ```
- **Expected Result**: Exit code 0. `totals:` shows one entry with `agentId` matching the created agent, `inputTokens: 1000000, outputTokens: 500000, cacheCreationInputTokens: 100000, cacheReadInputTokens: 200000, sessions: 1`, and `costUsd` ≈ `7.29` (within floating-point tolerance) — `1e6*$2 + 5e5*$10 + 1e5*$2.5 + 2e5*$0.2` all `/1e6` per the `claude-sonnet-5` row in `pricing.ts`, confirming pricing-table math flows correctly through the real schema and the aggregate read path.
- **Repeatable Unit Test**: Not applicable: `usage-store.test.ts`'s "multi-model session" case already unit-tests per-model cost math via `listAgentUsage`; this case specifically closes the gap to the real migrated schema and `getAllAgentUsageTotals` (the function `buildSnapshot` actually calls), which is integration-shaped by design.
- [x] Pass <!-- 2026-08-15 -->

### UAT-CLI-002: Cross-process restart never inflates totals (real OS process boundary, not `resetUsageStore()`)
- **Description**: `usage-store.test.ts`'s "restart idempotency" case simulates a restart by calling `resetUsageStore()` within the same process. This case proves the stronger, real-world claim: a genuinely separate `node` process (fresh module instance, empty in-memory accumulator `Map`) re-feeding the bootstrap's full-file-equivalent delta against the same on-disk DB does not double the persisted totals — the actual host-server-restart scenario TASK-075's acceptance criteria describe.
- **Steps**:
  1. Remove any stale scratch dir: delete `./tmp/uat-075-restart/` at the repo root if present.
  2. Run the command below as-is — it chains two independent `node` process invocations against the same on-disk scratch DB, simulating pre-restart and post-restart.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && rm -rf ../tmp/uat-075-restart && mkdir -p ../tmp/uat-075-restart && node --import tsx/esm --input-type=module -e "
  const path = await import('node:path');
  const { openDb, createAgent, listAgentUsage } = await import('./db.ts');
  const { recordUsageDeltas } = await import('./usage-store.ts');
  const db = openDb(path.join('../tmp/uat-075-restart', 'scratch.db'));
  const agent = createAgent(db, { name: 'a1', workdir: '../tmp/uat-075-restart', launchCmd: 'claude' });
  recordUsageDeltas(db, agent, [{ agentName: 'a1', sessionId: 'sess-1', model: 'claude-fable-5', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: null, ts: '2026-07-06T12:00:00.000Z' }]);
  console.log('agentId:', agent.id);
  console.log('before:', JSON.stringify(listAgentUsage(db, agent.id)));
  " && node --import tsx/esm --input-type=module -e "
  const path = await import('node:path');
  const { openDb, listAgentUsage } = await import('./db.ts');
  const { recordUsageDeltas } = await import('./usage-store.ts');
  const db = openDb(path.join('../tmp/uat-075-restart', 'scratch.db'));
  recordUsageDeltas(db, { id: 1, name: 'a1' }, [{ agentName: 'a1', sessionId: 'sess-1', model: 'claude-fable-5', inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: null, ts: '2026-07-06T12:00:00.000Z' }]);
  console.log('after:', JSON.stringify(listAgentUsage(db, 1)));
  "
  ```
- **Expected Result**: Exit code 0. `agentId: 1` (fresh scratch DB, first row). `before:` and `after:` show the identical single row (`inputTokens: 10, outputTokens: 20, costUsd` unchanged) — the second, genuinely separate process's fresh in-memory accumulator re-derived the same absolute totals and the DB upsert overwrote rather than doubled them.
- **Repeatable Unit Test**: Not applicable: proving safety across a real OS process boundary (fresh module instance, empty accumulator `Map`) cannot be exercised by a same-process unit test — `resetUsageStore()` approximates but doesn't fully substitute for it, which is exactly the gap this case closes.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-001: `GET /api/status` carries `usage: AgentUsageTotals | null` on every agent
- **Endpoint**: `GET /api/status`
- **Description**: Verifies `buildSnapshot()`'s `usageByAgent` wiring (`host-server/index.ts`) actually reaches the live HTTP response — the field TASK-074's badge will read.
- **Steps**:
  1. Ensure the dev host-server is running (see Prerequisites).
  2. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS -m 5 'http://localhost:8788/api/status' | jq '.agents | map({id, name, usage})'
  ```
- **Expected Result**: HTTP 200, JSON array (empty if no agents are currently configured — not a failure). Every element has a `usage` key present: either `null` (no usage recorded yet for that agent) or an object with `agentId`, `inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `costUsd`, `sessions`. No element is missing the `usage` key entirely, and the request never errors regardless of whether any agent has usage rows yet.
- **Repeatable Unit Test**: Not applicable: verifies the live Fastify route + `buildSnapshot()` wiring in `index.ts`; no existing harness spins up the real HTTP server for a unit test.
- [x] Pass <!-- 2026-08-15 -->

### UAT-API-002: SSE `/api/events` carries `usage` on `agent-update` (connect replay and diff-tick)
- **Endpoint**: `GET /api/events` (SSE)
- **Description**: Verifies the on-connect replay loop and the diff-tick broadcast (`host-server/index.ts`) both attach `usage` to `agent-update` events — and that the diff gate's `usage.costUsd`/`usage.outputTokens` comparison means a usage-only change still triggers a broadcast (per the task's implementation notes), not just state/status changes.
- **Steps**:
  1. Ensure the dev host-server is running and at least one agent is configured (`GET /api/status` returns a non-empty `agents` array).
  2. Run the command below as-is. It stays connected for 4 seconds to capture the connect-time replay (and any diff-tick broadcasts that land during that window).
- **Command**:
  ```bash
  curl -sS -N --max-time 4 'http://localhost:8788/api/events'
  ```
- **Expected Result**: Output opens with `: connected`. For each currently configured agent, one `event: agent-update` block appears whose `data:` JSON line includes a `"usage"` key (`null` or an `AgentUsageTotals` object) alongside the other agent fields (`id`, `name`, `state`, ...). If zero agents are configured, only the `: connected` line and `: ping` heartbeats appear before the 4s timeout — acceptable, not a failure.
- **Repeatable Unit Test**: Not applicable: verifies the live SSE stream wiring in `index.ts`; same reasoning as UAT-API-001.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: Typecheck and full unit-test gate (closing check)
- **Description**: Confirms the acceptance criteria's static gates still hold at UAT time (defends against drift from other concurrently-landing tasks touching `host-server/index.ts`/`db.ts`).
- **Steps**:
  1. Run the command below as-is from `host-server/`.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit && npm test 2>&1 | tail -40
  ```
- **Expected Result**: `tsc --noEmit` exits 0 with no output. Test run shows `usage.test.ts`, `usage-store.test.ts`, and `db.migration.test.ts` all passing among the rest of the suite, with 0 failures.
- **Repeatable Unit Test**: Not applicable: this case *is* the repeatable unit/type gate already covered by the project's `typecheck` script and existing test files.
- [x] Pass <!-- 2026-08-15 -->

---

## Cleanup

- Delete `./tmp/uat-075/` and `./tmp/uat-075-restart/` after the run (scratch DBs only).
- UAT-API-001 and UAT-API-002 make no writes — read-only against the live dev server; no cleanup needed there.
