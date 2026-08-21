---
id: UAT-074
aliases: [UAT-074]
title: "UAT: Token/cost badge — compact usage badge on agent card header in dashboard"
status: pending
task: TASK-074
created: 2026-08-15
updated: 2026-08-15
---

# UAT-074 — UAT: Token/cost badge — compact usage badge on agent card header in dashboard

implements::[[TASK-074]]

> **Source task**: [[TASK-074]]
> **Generated**: 2026-08-15
> **Note**: This is a frontend-only task (`frontend/src/components/AgentList.tsx`: `formatTokens`, `formatCost`, `UsageBadge`, rendered in `AgentItem`'s Row 1 immediately before `AgentTypeBadge`). All four symbols were read directly from source before writing any assertion below — see each case's description for the exact line-for-line logic under test. The frontend has no configured test runner (no vitest/jest, no existing `*.test.tsx` anywhere in `frontend/`), so no promoted test files were created; per instruction, `formatTokens`/`formatCost`/`UsageBadge`'s pure logic is instead pinned as machine-verifiable, browser-free reference computations inside UAT-EDGE-001/002 (verified by running them before writing this file), maximizing the auto-judgeable slice without inventing new frontend test infrastructure. The live host-server (`http://localhost:8788`) already carries real usage rows for two agents (id 10 `bootstrap-1`, id 11 `general`) and two agents with `usage: null` (id 12, 13) — confirmed live at generation time, so UAT-API-001 asserts on the actual running payload rather than a fixture.

---

## Prerequisites

- [ ] Host-server running on `http://localhost:8788` (`make dev` or `npm start` in `host-server/`)
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev`)
- [ ] `jq` and `node` installed
- [ ] At least one agent with non-null `usage` (nonzero tokens and/or `costUsd`) for the badge-present UI tests. Find one with:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.usage != null) | {id, name, usage}'
  ```
- [ ] At least one agent with `usage: null` (fresh session, Codex/Aider, or pre-migration DB) for the no-badge UI test. Find one with:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents[] | select(.usage == null) | {id, name}'
  ```
- [ ] Leave any existing agents untouched — this UAT reads the live `/api/status` payload and the dashboard only; it creates no agents and deletes none. (In particular, agent id `12` is a live fixture left over from a separate UAT run — do not modify or delete it.)

---

## Test Cases

### UAT-API-001: GET /api/status exposes a well-shaped `usage` field on every agent
- **Endpoint**: `GET /api/status`
- **Description**: `AgentList` reads `agent.usage` off the `/status` snapshot/SSE payload (per the task's "Data source" note — `GET /status` seeds the list, `agent-update` SSE events keep it live). Every agent object must carry a `usage` key that is either `null` or an object with all six `AgentUsageTotals` fields the frontend `Agent.usage` type declares (`inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `costUsd`, `sessions`).
- **Steps**:
  1. Ensure at least one agent exists (`GET /api/status` returns a non-empty `agents` array).
  2. Run the command below as-is.
- **Command**:
  ```bash
  curl -sS 'http://localhost:8788/api/status' | jq '.agents | length > 0 and all(has("usage")) and all(.usage == null or (.usage | (type=="object") and has("inputTokens") and has("outputTokens") and has("cacheCreationInputTokens") and has("cacheReadInputTokens") and has("costUsd") and has("sessions")))'
  ```
- **Expected Result**: Prints `true` — the `agents` array is non-empty, every agent object has a `usage` key, and every non-null `usage` value carries all six typed fields. (Verified live at generation time: agents 10/`bootstrap-1` and 11/`general` carry non-null `usage`; agents 12/13 carry `usage: null`.)
- **Repeatable Unit Test**: Not applicable: `/status` composes live tmux/runtime state into the snapshot response; the `usage` field's DB-side shape (`AgentUsageTotals`) already has repeatable coverage from TASK-072/TASK-075 (`host-server/db.migration.test.ts`, `host-server/usage-store.test.ts`). This case verifies only that the shape survives onto the `/status` payload the frontend actually consumes, which needs the live route.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-001: `formatTokens`/`formatCost` — tier thresholds, rounding, and trailing-zero stripping
- **Scenario**: `formatTokens` (`frontend/src/components/AgentList.tsx:203-207`) has a strict `>= 1_000_000` → `M`-tier boundary (so `999999` stays `1000k`, not `1M`, and `1000000` becomes `1M`), rounds the `k`-tier with `Math.round`, and strips a trailing `.0` from the `M`-tier (so `9964532` → `9.964532` → `"10.0"` after `toFixed(1)` → `"10M"` once stripped — a real value from the live `general` agent's usage, whose four token fields currently sum past 9.9M). `formatCost` (`:209-213`) has a `>= 0.01` → `$X.XX`, `0 < x < 0.01` → `<$0.01`, `<= 0` → `''` (empty) three-way split. These are pure functions (no DOM, no fetch); the source above is reproduced verbatim below.
- **Steps**:
  1. Write the reference script (this is a byte-for-byte copy of the two functions read from `frontend/src/components/AgentList.tsx:203-213`, plus a boundary/rounding matrix):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat074-formatters.mjs <<'EOF'
     function formatTokens(n) {
       if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
       if (n >= 1000) return String(Math.round(n / 1000)) + 'k'
       return String(n)
     }
     function formatCost(usd) {
       if (usd >= 0.01) return '$' + usd.toFixed(2)
       if (usd > 0) return '<$0.01'
       return ''
     }
     const cases = [
       [formatTokens(0), '0'],
       [formatTokens(999), '999'],
       [formatTokens(1000), '1k'],
       [formatTokens(56201), '56k'],
       [formatTokens(999999), '1000k'],
       [formatTokens(1000000), '1M'],
       [formatTokens(9964532), '10M'],
       [formatCost(0), ''],
       [formatCost(0.005), '<$0.01'],
       [formatCost(0.01), '$0.01'],
       [formatCost(0.140629), '$0.14'],
       [formatCost(5.5), '$5.50'],
     ]
     let ok = true
     for (const [actual, expected] of cases) {
       if (actual !== expected) { ok = false; console.log('MISMATCH', JSON.stringify(actual), '!==', JSON.stringify(expected)) }
     }
     console.log(ok ? 'ALL PASS' : 'FAIL')
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat074-formatters.mjs
  ```
- **Expected Result**: Prints `ALL PASS` with no `MISMATCH` lines (verified by running this exact script before writing this file).
- **Repeatable Unit Test**: Blocked: `formatTokens`/`formatCost` are promotable in principle (pure, deterministic, no I/O) but `frontend/` has no configured test runner (no vitest/jest in `frontend/package.json`, no existing test files anywhere under `frontend/`) — adding one would be new test infrastructure, which is out of scope per this run's instructions. The reference script above pins the exact formula read from source as a browser-free, re-runnable check in lieu of a promoted file.
- [x] Pass <!-- 2026-08-15 -->

### UAT-EDGE-002: `UsageBadge` — null/all-zero guard and label/title composition
- **Scenario**: `UsageBadge` (`frontend/src/components/AgentList.tsx:281-298`) returns `null` (no badge) when `agent.usage` is null/undefined, and also returns `null` when `usage` is present but all four token fields *and* `costUsd` are zero (no placeholder `$0.00` badge). When usage has data, the label joins `formatCost`/`formatTokens` with ` · ` when a cost segment exists, or renders the token segment alone when `costUsd` is `0`/absent (acceptance criterion: "Zero/absent `costUsd` with nonzero tokens renders the token segment only") — this is real, current behavior for the live `general` agent (id 11), whose `costUsd` is `0` today with ~9.96M cumulative tokens. The `title`/`aria-label` itemizes all four token fields plus session count, with `cost n/a` substituted when the cost segment is empty.
- **Steps**:
  1. Write the reference script (byte-for-byte reproduction of `UsageBadge`'s label/title logic from lines 281-298, run against a null case, an all-zero case, a cost+tokens case, and a zero-cost/nonzero-tokens case):
     ```bash
     mkdir -p /Users/davidtaylor/Repositories/tmux-conductor/tmp
     cat > /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat074-badge-logic.mjs <<'EOF'
     function formatTokens(n) {
       if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
       if (n >= 1000) return String(Math.round(n / 1000)) + 'k'
       return String(n)
     }
     function formatCost(usd) {
       if (usd >= 0.01) return '$' + usd.toFixed(2)
       if (usd > 0) return '<$0.01'
       return ''
     }
     function usageBadge(u) {
       if (!u) return null
       const totalTokens = u.inputTokens + u.outputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens
       if (totalTokens === 0 && u.costUsd === 0) return null
       const cost = formatCost(u.costUsd)
       const label = cost ? `${cost} · ${formatTokens(totalTokens)}` : formatTokens(totalTokens)
       const title = `Session usage: ${cost || 'cost n/a'} · in ${u.inputTokens} / out ${u.outputTokens} / cache-w ${u.cacheCreationInputTokens} / cache-r ${u.cacheReadInputTokens} · ${u.sessions} session(s)`
       return { label, title }
     }
     const cases = [
       [null, null],
       [{ inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0, sessions: 0 }, null],
       [{ inputTokens: 2, outputTokens: 17, cacheCreationInputTokens: 56182, cacheReadInputTokens: 0, costUsd: 0.140629, sessions: 1 }, { label: '$0.14 · 56k', title: 'Session usage: $0.14 · in 2 / out 17 / cache-w 56182 / cache-r 0 · 1 session(s)' }],
       [{ inputTokens: 160, outputTokens: 50087, cacheCreationInputTokens: 307941, cacheReadInputTokens: 9606344, costUsd: 0, sessions: 1 }, { label: '10M', title: 'Session usage: cost n/a · in 160 / out 50087 / cache-w 307941 / cache-r 9606344 · 1 session(s)' }],
     ]
     let ok = true
     for (const [u, expected] of cases) {
       const actual = usageBadge(u)
       if (JSON.stringify(actual) !== JSON.stringify(expected)) {
         ok = false
         console.log('MISMATCH', JSON.stringify(u), '=>', JSON.stringify(actual), 'expected', JSON.stringify(expected))
       }
     }
     console.log(ok ? 'ALL PASS' : 'FAIL')
     EOF
     ```
  2. Run the command below as-is.
- **Command**:
  ```bash
  node /Users/davidtaylor/Repositories/tmux-conductor/tmp/uat074-badge-logic.mjs
  ```
- **Expected Result**: Prints `ALL PASS` with no `MISMATCH` lines (verified by running this exact script before writing this file; the third and fourth cases use the live `bootstrap-1`/`general` agents' real usage numbers as of generation time).
- **Repeatable Unit Test**: Blocked: same constraint as UAT-EDGE-001 — `UsageBadge`'s decision logic is pure and promotable in principle, but `frontend/` has no test runner to host it, and this task is explicitly scoped frontend-only with no new build infrastructure. The reference script pins the exact composition logic read from source as a browser-free check.
- [x] Pass <!-- 2026-08-15 -->

### UAT-UI-001: Usage badge renders with the correct `$X.XX · NNk`/`NN.NM` format on an agent card
- **Page**: `http://localhost:4321/`
- **Description**: An agent whose `usage` has data must show a compact chip in Row 1 of its card, positioned between the agent name and the `AgentTypeBadge` — reusing the muted `ContextMeter`-style pill (`rounded-pill bg-[#f1f2f4] px-1.5 py-0.5 text-[10px] font-semibold text-[#4f5a78]`).
- **Auth-Required**: false
- **Steps**:
  1. Pick an agent with non-null `usage` from the Prerequisites query above; note its `id`/`name` and its `usage.costUsd`/token totals.
  2. Open the dashboard at `http://localhost:4321/`.
  3. Locate that agent's card and look at Row 1 (project badge → name → **usage badge** → agent-type badge → status badge).
  4. Compute the expected label by hand from the chosen agent's live `usage` values using UAT-EDGE-001/002's formulas (cost segment `$X.XX`/`<$0.01`/absent, joined with ` · ` to the humanized token total, `k`/`M` tier).
- **Expected Result**: The chip appears in Row 1 immediately before the agent-type badge, showing exactly the hand-computed label (e.g. `$0.14 · 56k`, or `10M` if `costUsd` is `0`). Styling is a small muted pill, visually subordinate to the status badge on the far right.
- **Repeatable Unit Test**: Not applicable: verifies browser rendering / DOM placement of a React conditional; `frontend/` has no component test harness (no vitest/jsdom, no existing `*.test.tsx`). The underlying label computation is pinned browser-free in UAT-EDGE-001/002.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-002: No usage badge on an agent with no usage data
- **Page**: `http://localhost:4321/`
- **Description**: An agent whose `usage` is `null` (fresh session, Codex/Aider, or pre-migration DB row) must render no badge at all — no placeholder, no `$0.00`, no empty pill (`UsageBadge` returns `null` per the null-guard verified in UAT-EDGE-002).
- **Auth-Required**: false
- **Steps**:
  1. Pick an agent with `usage: null` from the Prerequisites query above; note its `id`/`name`.
  2. Open the dashboard at `http://localhost:4321/`.
  3. Locate that agent's card and inspect Row 1 between the name and the agent-type badge.
- **Expected Result**: No usage chip appears anywhere on the card — the name span sits directly against the agent-type badge with no gap left by a hidden/empty element. The card otherwise renders normally.
- **Repeatable Unit Test**: Not applicable: verifies absence of a rendered DOM element in the browser; no frontend component test harness exists. The `!u → null` guard itself is pinned browser-free in UAT-EDGE-002's first case.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

### UAT-UI-003: Tooltip itemizes the full usage breakdown and Row 1 layout stays intact
- **Page**: `http://localhost:4321/`
- **Description**: Hovering the usage badge on an agent with data must show a tooltip (`title`, also set as `aria-label`) itemizing input/output/cache-write/cache-read tokens and session count, matching UAT-EDGE-002's `title` template exactly. Adding the badge must not break Row 1's layout — the name span keeps `min-w-0 flex-1 truncate`, so a long agent name still truncates with an ellipsis rather than pushing the badge/status off-card.
- **Auth-Required**: false
- **Steps**:
  1. Reuse the same agent as UAT-UI-001 (non-null `usage`).
  2. Open the dashboard at `http://localhost:4321/` and hover the usage badge on that agent's card; read the tooltip text (or inspect the element's `title`/`aria-label` attribute via devtools).
  3. Compare the tooltip text against UAT-EDGE-002's `title` template computed for the same agent's live `usage` values.
  4. Separately, find (or temporarily note) an agent with a long `name` and confirm its name row still truncates with an ellipsis rather than wrapping or overflowing the card when the usage badge is present.
- **Expected Result**: Tooltip text reads `Session usage: <cost or "cost n/a"> · in <inputTokens> / out <outputTokens> / cache-w <cacheCreationInputTokens> / cache-r <cacheReadInputTokens> · <sessions> session(s)`, matching the chosen agent's real numbers exactly. The name column still truncates; the usage badge, agent-type badge, and status badge all remain visible on one row without wrapping.
- **Repeatable Unit Test**: Not applicable: verifies rendered tooltip text and CSS truncation behavior in the browser; no frontend component/visual test harness exists. The `title` string's construction is pinned browser-free in UAT-EDGE-002.
- [FAIL: auto-judge: UI test requires human verification — use /uat-walk] <!-- 2026-08-15 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| Agent cards for agents with usage totals show a compact badge in Row 1 with cost and humanized total tokens (`$0.42 · 128k`; `M` tier above 1M) | UAT-UI-001, formula pinned by UAT-EDGE-001/002 |
| Agents with no usage data (or all-zero totals) show no badge — no placeholder, no `$0.00` | UAT-UI-002, guard pinned by UAT-EDGE-002 |
| Zero/absent `costUsd` with nonzero tokens renders the token segment only | UAT-EDGE-002 (live `general` agent case), UAT-UI-001 |
| Tooltip/`aria-label` itemizes input / output / cache-creation / cache-read tokens and session count | UAT-UI-003, template pinned by UAT-EDGE-002 |
| Badge is visually subordinate to `StatusBadge` and never breaks Row 1's layout (name still truncates) | UAT-UI-003 |
| No changes to `host-server/`; `frontend/src/lib/api.ts` untouched unless the accumulation task typed the payload there | Verified by source inspection during generation (not a runtime UAT case) — `usage` is typed only in `AgentList.tsx`'s `Agent` interface; `api.ts` untouched |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | Static gate — verified during `/tackle` (not re-tested here) |

**Note on `uatGenerate.promoteTests`**: the stored preference (`true`) uses the legacy true/false grammar and maps to `dedicated` for this run. No test files were created under it — `frontend/` has no configured test runner at all (no vitest/jest, no existing test files), so promoting `formatTokens`/`formatCost`/`UsageBadge` into a real test file would mean introducing new frontend test infrastructure, out of scope for this generation. Their logic is instead pinned as machine-verifiable, browser-free reference scripts inside UAT-EDGE-001/002.
