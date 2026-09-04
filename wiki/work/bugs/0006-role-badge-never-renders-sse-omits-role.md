---
id: BUG-0006
aliases: [BUG-0006]
title: "Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race"
status: closed
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-09-03
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-114]]"
---

# BUG-0006 — Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify, SSE) + frontend (Vite dev server)
- Config: default `conductor.conf`, no overrides

## Steps to Reproduce

1. Create an agent with a non-generic `role` (e.g. `role: "security"`) via `POST /api/agents`.
2. Confirm `GET /api/status` correctly returns `"role":"security"` for that agent (it does).
3. Open the dashboard and observe the agent's card and its detail modal header.

## Expected Behavior

A colour-coded role badge (`RoleBadge`) renders on both the compact agent card and the detail modal header for any agent with a non-`generic` role, matching what `GET /api/status` reports.

## Actual Behavior

The role badge never appears anywhere on the live dashboard, on either the card or the modal, for any agent — even though the REST `GET /api/status` payload correctly carries the role. Confirmed via a full-page scan of every `span.rounded-pill` on the page: no role text, no role-specific colour classes, no `title="Role: ..."` anywhere.

Root cause (found via source read during live verification, not yet fixed): two compounding issues in `host-server/index.ts` and `frontend/src/components/AgentList.tsx`.

1. **SSE payload omits `role`.** The internal `buildSnapshot()` object (`host-server/index.ts` ~line 2305) correctly includes `role`, and it's correctly served by the REST `GET /api/status` route. But both SSE `agent-update` payload builders — the initial-connect resend (~lines 2168-2184) and the periodic diff-tick broadcast (~lines 2398-2422) — omit the `role` field entirely when constructing the per-agent SSE wire shape.
2. **SSE always wins the initial-load race.** `AgentList.tsx` (~lines 1300-1332) has a `hasReceivedSSEStateRef` guard that discards the initial `/api/status` GET fetch's result entirely once any SSE `agent-update` event arrives first. Because the SSE connect-resend is a synchronous send of already-cached server state, it essentially always wins the race against the `/status` GET's live per-agent `capture-pane` calls. The dashboard's live state therefore ends up built purely from the role-less SSE payload, permanently — the REST fetch's correct `role` value is fetched, then thrown away.

Since every other live-updating agent field presumably goes through the same SSE path, this pattern (missing field on SSE payload + SSE always winning the race) is worth checking for other silently-dropped fields beyond just `role`.

Found during live Playwright-driven verification of UAT-114 (role badge UI) on 2026-08-24.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-24
- **Last seen**: 2026-08-24

## Root Cause Analysis

Confirmed issue 1 exactly as filed, plus its underlying cause: `buildSnapshot()` (`host-server/index.ts:2251-2313`) sets `role: agent.role` in its per-agent object literal, and the `Snapshot` interface's inline agent type (`host-server/index.ts:621`, previously) never declared a `role` field at all — the object satisfied the type only because `agentStatuses` is built via `.map()` (not an inline literal assigned to `Snapshot`, so TypeScript's excess-property check never ran). That type gap is almost certainly *why* `role` was missed when the two SSE payload builders were written by hand: there was no compiler signal that a field existed on the runtime object but not on the type.

Did a field-by-field diff of `buildSnapshot()`'s 24-field object literal (`id, name, projectId, projectName, state, status, mode, agentType, windowPresent, queuedTasks, launchCmd, workdir, worktreePath, branch, role, activeTask, label, linkedBg, usage` plus the 5 spread `AgentContext` fields `model, modelId, contextTokens, contextPct, contextLimit`) against both SSE builders:
- Initial-connect resend (`host-server/index.ts:2168-2184` before fix): had all 24 fields except `role`.
- Periodic diff-tick broadcast (`host-server/index.ts:2398-2422` before fix): had all 24 fields except `role`.

`role` was the only field dropped at either site — no other silent omissions found.

Issue 2 (`AgentList.tsx`'s `hasReceivedSSEStateRef` guard permanently discarding the correct initial REST fetch once SSE wins the race) is real but, on closer read, not actually load-bearing for this symptom: the initial-connect SSE resend (`GET /api/events`) sources its per-agent payload from `prevSnapshot`, which is itself built by `buildSnapshot()` — the exact same function that serves REST `GET /api/status`. Once the SSE builder carries every field `buildSnapshot()` sets (fixed below), "SSE wins the race" means the client gets the *same* correct data `buildSnapshot()` would have served over REST, not stale or different data. The race is only harmful when a field exists in `buildSnapshot()`'s per-agent shape but was forgotten in one of the two hand-maintained SSE builders — exactly what happened to `role` here.

## Resolution

1. Added `role: agent.role,` to the initial-connect SSE builder (`host-server/index.ts`, in the `for (const agent of prevSnapshot.agents)` loop inside `GET /api/events`) and to the periodic `broadcastSSE('agent-update', ...)` builder in `pollAndDiff`'s diff loop — both now source `role` the same way `buildSnapshot()` does, directly off the `Agent`-derived snapshot entry.
2. Added the missing `role: string` field to the `Snapshot` interface's inline agent type (`host-server/index.ts:621`) so the type now matches what `buildSnapshot()` actually returns — this was required for `npm run typecheck` to pass once the SSE builders started reading `agent.role`, and closes the type gap that let the original omission go uncaught.
3. Added a comment directly above the `Snapshot` interface (`host-server/index.ts`) flagging that every field in the per-agent shape must be mirrored in both SSE builders, since that field-parity gap — not the race itself — is the actual root cause class. This is a lightweight guardrail, not a race-guard refactor: `AgentList.tsx`'s `hasReceivedSSEStateRef` logic was deliberately left untouched (see analysis above — it's not a functional defect for this bug, and reworking a "discard vs. merge" state-sync pattern on the strength of one field-parity bug would be over-scoped for this fix).
4. Confirmed `RoleBadge` (`frontend/src/components/AgentList.tsx:196-199`, rendered at lines 696 and 943) reads `agent.role` straight from component state with no additional gating — so once `role` is present on whichever payload (REST or SSE) wins the initial-load race, the badge renders. No frontend code change was needed for the reported symptom itself.

Verification: `cd host-server && npm run typecheck` (clean) and `npm test` (89/89 pass, no regressions). Not verified live in a browser/Playwright (would require spinning up a real tmux session with a non-generic-role agent) — verification here is by code-path tracing: `buildSnapshot()` → `prevSnapshot` → SSE connect-resend → `AgentList.tsx` state → `RoleBadge`, confirmed field-complete at every hop.

Root cause (field-parity gap, not the race) confirmed and fixed at the source, with a guardrail added against recurrence.

### Regression tests

Two sites needed covering, and each fires under different conditions, so each got a differently-shaped test:

- **Initial-connect resend** (`GET /api/events`) — deterministically triggerable (fires synchronously on connect), so covered live: `scripts/verify-sse-role-payload.sh` boots a real host-server on a scratch `BACKEND_PORT` (never touches the live dev server's 8788) against a scratch DB, seeds a `role: 'security'` agent, connects to `/api/events` with `curl -sN`, and asserts the captured `agent-update` payload carries `"role":"security"`.
- **Periodic diff-tick broadcast** (`pollAndDiff`) — fires on an internal polling interval this repo has no harness to trigger deterministically, so pinned statically instead: `host-server/sseRolePayloadParity.test.ts` regex-matches both hand-maintained `agent-update` object literals in `index.ts` and asserts each still contains `role: agent.role,` — the same "read the source, pin a specific call site" pattern already used by `perfBudgets.test.ts` (TASK-118) for an analogous field-parity guardrail.

Confirmed both are meaningful, not tautological: reverted `role: agent.role,` from each site in turn and re-ran its corresponding test — the live SSE script failed with the payload missing `"role":"security"` (reproducing this bug's exact symptom), and the static test's regex match failed cleanly. Restored both, re-ran — all green. Full `npx tsc --noEmit`, `npx eslint .`, and `npm test` (111/111, up from 109 — the two new static test cases) clean throughout; live dev server on 8788 confirmed unaffected after each temporary edit.

Closing per the lifecycle gate (root cause + fix + regression test) now that genuine regression tests exist for both sites, matching BUG-0004/0009/0010's precedent of building self-contained tests rather than waiting on an in-process Fastify harness.

## Related

> [[BUG-0003]], [[BUG-0004]], [[BUG-0005]] — found by the same UAT verification pass on adjacent UI, unrelated code paths
