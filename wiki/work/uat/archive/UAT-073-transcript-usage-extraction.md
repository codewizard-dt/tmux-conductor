---
id: UAT-073
aliases: [UAT-073]
title: "UAT: Per-agent usage extraction — parse Claude Code transcript JSONL each poll"
status: passed
task: TASK-073
created: 2026-07-06
updated: 2026-07-06
---

# UAT-073 — UAT: Per-agent usage extraction — parse Claude Code transcript JSONL each poll

implements::[[TASK-073]]

> **Source task**: [[TASK-073-transcript-usage-extraction]]
> **Generated**: 2026-07-06

---

## Prerequisites

- [ ] Dependencies installed in `host-server/` (`npm install` already run; `tsx` and `better-sqlite3` resolvable).
- [ ] `sqlite3` CLI available on PATH.
- [ ] Repo-local `./tmp/` directory writable (scratch DBs/transcripts go in `./tmp/uat-073/`; never system `/tmp`).
- [ ] The 7 existing `host-server/usage.test.ts` cases already cover pure-function behavior (streaming dedup, incremental reads, session-change reset, filters/malformed lines, no-sidecar, truncation, per-field diff) — this UAT does **not** re-test those; it covers the integration path and process-restart behavior the unit tests don't reach.

---

## Test Cases

### UAT-CLI-001: Full pipeline — extraction deltas actually land in the `agent_usage` table
- **Description**: Verifies the acceptance criterion that was deferred from `/tackle` ("live smoke... deltas appear... verify via `sqlite3` ... `agent_usage`"). Exercises the real production path end-to-end — `extractUsageDeltas()` (host-server/usage.ts) feeding `recordUsageDeltas()` (host-server/usage-store.ts) — writing into a scratch SQLite DB built from the real `agent_usage` migration, without needing a live conductor session.
- **Steps**:
  1. Remove any stale scratch dir: delete `./tmp/uat-073/` at the repo root if present.
  2. From `host-server/`, run the command below as-is. It: (a) creates a scratch `stateDir` with a sidecar `agent1.meta.json` pointing at a fixture transcript, (b) writes one realistic assistant JSONL line with `message.usage` fields, (c) opens a scratch DB via the real `openDb()` (runs the `agent_usage` migration), inserts one `agents` row, (d) calls `extractUsageDeltas('agent1', workdir, stateDir)`, (e) feeds the returned deltas into `recordUsageDeltas(db, agent, deltas)`, (f) queries `agent_usage` back out.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = '../tmp/uat-073';
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workdir'), { recursive: true });
  const transcriptPath = path.join(root, 'workdir', 'session.jsonl');
  const sessionId = 'sess-uat-073';
  const line = JSON.stringify({ type: 'assistant', isSidechain: false, requestId: 'req-1', uuid: 'u-1', sessionId, timestamp: '2026-07-06T12:00:00.000Z', message: { id: 'msg-1', model: 'claude-sonnet-4-5', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 } } });
  fs.writeFileSync(transcriptPath, line + '\n');
  fs.writeFileSync(path.join(root, 'state', 'agent1.meta.json'), JSON.stringify({ transcript_path: transcriptPath, session_id: sessionId }));
  const { openDb } = await import('./db.ts');
  const db = openDb(path.join(root, 'scratch.db'));
  db.prepare('INSERT INTO agents (id, name, workdir, launch_cmd) VALUES (1, ?, ?, ?)').run('agent1', path.join(root, 'workdir'), 'claude');
  const { extractUsageDeltas } = await import('./usage.ts');
  const { recordUsageDeltas } = await import('./usage-store.ts');
  const deltas = extractUsageDeltas('agent1', path.join(root, 'workdir'), path.join(root, 'state'));
  console.log('deltas:', JSON.stringify(deltas));
  recordUsageDeltas(db, { id: 1, name: 'agent1' }, deltas);
  const rows = db.prepare('SELECT agent_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens FROM agent_usage WHERE agent_id = 1').all();
  console.log('agent_usage rows:', JSON.stringify(rows));
  "
  ```
- **Expected Result**: Exit code 0. `deltas:` shows one `UsageDelta` with `inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, cacheReadTokens: 5`. `agent_usage rows:` shows exactly one row with `agent_id: 1, input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5` — confirming the extraction-to-storage path is wired correctly end-to-end.
- **Repeatable Unit Test**: Not applicable: this specifically verifies cross-module integration (`usage.ts` → `usage-store.ts` → real `agent_usage` schema), which is out of scope for either module's isolated unit tests by design.
- [x] Pass <!-- 2026-07-06 -->

### UAT-CLI-002: `getUsageSessionStart` recovers the same timestamp after a process restart
- **Description**: The task's implementation notes claim `getUsageSessionStart` is "restart-stable because bootstrap re-parses from offset 0" — i.e. a fresh process (new module instance, empty in-memory memo) re-derives the same session-start timestamp from an existing transcript rather than losing it. This is not exercised by any of the 7 existing unit tests (all run within one module instance). Verifies it by running extraction in two separate `node` invocations against the same fixture.
- **Steps**:
  1. Reuse the fixture from UAT-CLI-001 (run it first, or recreate `./tmp/uat-073/workdir/session.jsonl` + `./tmp/uat-073/state/agent1.meta.json` per its script).
  2. Run the command below as-is — it is a **separate process invocation** simulating a host-server restart.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && node --import tsx/esm --input-type=module -e "
  const { extractUsageDeltas, getUsageSessionStart } = await import('./usage.ts');
  extractUsageDeltas('agent1', '../tmp/uat-073/workdir', '../tmp/uat-073/state');
  console.log('sessionStart:', getUsageSessionStart('agent1'));
  "
  ```
- **Expected Result**: Exit code 0. Output is `sessionStart: 2026-07-06T12:00:00.000Z` (the fixture line's `timestamp` field) — identical across repeated fresh-process runs, confirming the value is deterministically re-derived from the transcript rather than depending on carried-over process state.
- **Repeatable Unit Test**: Not applicable: process-restart behavior requires a genuinely separate Node process; a same-process unit test cannot exercise memo-loss the way a real restart does.
- [x] Pass <!-- 2026-07-06 -->

### UAT-EDGE-001: Manual live-session smoke test (optional — requires a running conductor session)
- **Scenario**: The originally-planned runtime smoke check from the task ("if a conductor session is running... confirm... deltas appear after an agent completes a turn"). Covers real-world sidecar resolution, real transcript shapes, and the actual `host-server/index.ts` poll-cycle wiring (`refreshAgentContextCache` → `extractUsageDeltas` → `recordUsageDeltas`) that UAT-CLI-001 above only simulates with fixtures.
- **Steps**:
  1. Start (or use an already-running) conductor session with at least one live Claude Code agent (`make dev` from the repo root, or an existing `tmux-conductor` tmux session).
  2. Send a prompt to that agent and wait for it to complete a turn (Stop hook fires).
  3. Wait one poll cycle (a few seconds) for the host-server's `refreshAgentContextCache` loop to run.
  4. Run the command below as-is against the **real, running** database.
- **Command**:
  ```bash
  sqlite3 /Users/davidtaylor/Repositories/tmux-conductor/data/conductor.db "SELECT agent_id, session_start, input_tokens, output_tokens, cost_usd, updated_at FROM agent_usage ORDER BY updated_at DESC LIMIT 5;"
  ```
- **Expected Result**: At least one row for the agent that just completed a turn, with `input_tokens`/`output_tokens` > 0 and `updated_at` within the last poll interval. If the row is absent, check that the agent is a Claude Code agent with an active hook sidecar (`logs/state/<agent>.meta.json`) — non-Claude agents (Codex, Aider) and agents with no sidecar are expected to yield no rows by design.
- **Repeatable Unit Test**: Not applicable: requires a live tmux/Claude Code session and the real host-server poll loop; this is the manual acceptance check for the behavior UAT-CLI-001 verifies mechanically.
- [SKIP: headless orchestration has no interactive tmux session available; extraction/dedup/session-start-stability logic already verified by UAT-CLI-001, UAT-CLI-002, and UAT-EDGE-002 with real command evidence] <!-- 2026-07-06 -->

### UAT-EDGE-002: Typecheck and unit-test gate (closing check)
- **Description**: Confirms the acceptance criteria's static gates still hold at UAT time (defends against drift introduced by other concurrently-landing tasks touching `host-server/index.ts`/`db.ts`).
- **Steps**:
  1. Run the command below as-is from `host-server/`.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit && npm test 2>&1 | tail -30
  ```
- **Expected Result**: `tsc --noEmit` exits 0 with no output. Test run shows the `usage.ts`/`usage.test.ts` suite passing (7 cases) among the rest of the suite, with 0 failures.
- **Repeatable Unit Test**: Not applicable: this case *is* the repeatable unit/type gate, already covered by `host-server/usage.test.ts` and the project's `typecheck` script.
- [x] Pass <!-- 2026-07-06 -->

---

## Cleanup

- Delete `./tmp/uat-073/` after the run (scratch DBs/transcripts only).
- UAT-EDGE-001 makes no destructive changes to `./data/conductor.db` — it only reads; no cleanup needed there.
