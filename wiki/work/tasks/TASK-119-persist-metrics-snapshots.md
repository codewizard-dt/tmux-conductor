---
id: TASK-119
aliases: [TASK-119]
title: "Persist periodic liveUpdateMetrics snapshots to observability.jsonl so metrics survive a host-server restart"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: []
blocks: []
parallel_safe_with: [TASK-120, TASK-121, TASK-116, TASK-117, TASK-118]
uat: "[[UAT-119]]"
tags: [observability, host-server, roadmap-017]
---

# TASK-119 — Persist periodic liveUpdateMetrics snapshots to observability.jsonl so metrics survive a host-server restart

## Objective

`liveUpdateMetrics` (`host-server/index.ts:307-327`, exposed at `GET /api/perf/live-updates`) is an in-memory object that resets to zero every time the host-server process restarts — `startedAt` is set once at module load (`:334`). There is currently no way to see what the metrics looked like 10 minutes before a restart. Add a periodic snapshot of the full `liveUpdateMetrics` object (plus event-loop metrics) to `logs/observability.jsonl` via the existing `appendObservabilityLog` helper, so historical metrics survive process restarts and can be reconstructed by replaying the JSONL file.

## Approach

`appendObservabilityLog(event: string, payload: Record<string, unknown>)` (`host-server/index.ts:427-438`) already exists and is used for **event-triggered** log lines (`tmux_timeout`, `terminal_ws_open`/`close`, `status_transition`, `slow_loop`) — one call per discrete occurrence. This task adds a **periodic** call on a fixed interval regardless of whether anything eventful happened, capturing the full current state of `liveUpdateMetrics` (and `readEventLoopMetrics()`'s output, same shape `GET /api/perf/live-updates` already returns under its `eventLoop` key) as one `metrics_snapshot` event per interval.

**Interval and wiring**: follow the existing `startManagedLoop` pattern used for every other periodic loop in this file (`host-server/index.ts:2474-2484` — context refresh, status poll, tail poll, focused tail poll, schedule poll). Add a new conductor.conf-configurable interval, e.g. `METRICS_SNAPSHOT_INTERVAL_MS` (default `60000` — 60s; document it in `conductor.conf` next to `STATUS_POLL_MS`/`TERMINAL_POLL_MS` and resolve it via `host-server/config.ts`, matching how those existing `*_MS` settings are read), and register `startManagedLoop('metrics snapshot', () => readConductorConf().metricsSnapshotIntervalMs, () => { appendObservabilityLog('metrics_snapshot', { liveUpdateMetrics, eventLoop: readEventLoopMetrics() }); }, { warnAfterMs: ... })` alongside the other loop registrations.

**Payload shape**: reuse the exact `liveUpdateMetrics` object (it's already JSON-serializable — every existing consumer, `GET /api/perf/live-updates`, already sends it straight through `reply.send`) rather than hand-picking a subset of fields; `appendObservabilityLog` already prefixes every line with `{ts, event, ...payload}`, so the resulting JSONL line is `{ts, event: "metrics_snapshot", liveUpdateMetrics: {...}, eventLoop: {...}}`. Do not deep-clone defensively — `appendObservabilityLog` calls `JSON.stringify` synchronously inside the same tick, so no mutation race is possible between snapshot and write.

**Growth consideration**: `observability.jsonl` is append-only and currently has no size cap or rotation (same as `logs/dispatch.jsonl`, `logs/hooks.jsonl` per existing repo conventions — this repo doesn't rotate any of its host-side logs today). A `metrics_snapshot` line every 60s is ~1,440 lines/day; each line is on the order of 1-2KB given `liveUpdateMetrics`'s current field count. Do not add rotation/pruning logic in this task (out of scope, matches the existing convention for every other log this repo writes) — just note the growth rate in a code comment so a future task can decide whether to add rotation.

## Steps

### 1. Add the conductor.conf setting  <!-- agent: general-purpose -->

- [x] Add `METRICS_SNAPSHOT_INTERVAL_MS=60000` to `conductor.conf`, in the "Dashboard live updates" section near `STATUS_POLL_MS`, with a comment explaining it's the interval between full `liveUpdateMetrics` snapshots written to `observability.jsonl` (TASK-119 / ROADMAP-017 Phase 2). <!-- Updated: 2026-08-15 — added after TERMINAL_LOG_MAX_ROWS_PER_AGENT, near the other *_MS dashboard settings. -->
- [x] Add the corresponding field to `host-server/config.ts`'s `ConductorConf` interface/parsing (`metricsSnapshotIntervalMs: number`, default `60000` if unset — matching how `statusPollMs`/`terminalPollMs` are already resolved). <!-- Updated: 2026-08-15 — added to the ConductorConf interface, the declare -p var list, parsePositiveIntSetting call, and the cached object. -->

### 2. Add the periodic snapshot loop  <!-- agent: general-purpose -->

- [x] In `host-server/index.ts`, add a new `startManagedLoop('metrics snapshot', () => readConductorConf().metricsSnapshotIntervalMs, () => { appendObservabilityLog('metrics_snapshot', { liveUpdateMetrics, eventLoop: readEventLoopMetrics() }); })` call alongside the existing loop registrations (`~2474-2484`). Choose a `warnAfterMs` consistent with the interval (e.g. the interval itself, or omit `warnAfterMs` — a 60s-interval snapshot write is not latency-sensitive the way the 2s status poll is). <!-- Updated: 2026-08-15 — inserted between the 'focused tail poll' and 'schedule poll' registrations (lines shifted from the task's original ~2474-2484 citation to ~2487 due to concurrent sibling edits; re-read fresh before inserting). warnAfterMs: 1000, backoffMs: 5000. -->
- [x] Add a one-line comment above the new loop citing TASK-119 and explaining the restart-survivability purpose. <!-- Updated: 2026-08-15 — comment also explains the delta/restart-detection reasoning (ts + startedAt), per team-lead's explicit reminder that cumulative-since-start timings need this to be usable for TASK-117/118. -->

### 3. Typecheck and verify  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `host-server/` — zero errors. <!-- Updated: 2026-08-15 — clean. Also ran the full host-server suite: 64/64 passing (57 baseline + 4 from sibling TASK-111 + 3 new METRICS_SNAPSHOT_INTERVAL_MS tests in config.test.ts, added below since index.ts has no injectable app export to unit-test the loop wiring itself against — see step 3's added note). -->
- [DEFERRED-TO-UAT] With `make dev` running and `METRICS_SNAPSHOT_INTERVAL_MS` temporarily lowered (e.g. to `5000` via env override) for a fast local check, confirm `logs/observability.jsonl` accumulates `{"event":"metrics_snapshot", ...}` lines at the configured cadence, and that each line's `liveUpdateMetrics` payload round-trips through `JSON.parse` into the same shape `GET /api/perf/live-updates` currently returns under its top-level object (module the `settings`/`timestamp` wrapper fields that endpoint adds but this snapshot doesn't need). <!-- Updated: 2026-08-15 — runtime verification deferred to UAT per tackle static-gate policy (needs a live host-server process); static verification (tsc, unit tests, code reading) done instead. -->
- [x] Confirm the running host-server does not need to be restarted to pick up a `conductor.conf` interval-value change if the repo's existing conf-caching behavior would prevent that (check `clearConfCache`/hot-reload conventions already used elsewhere in `config.ts`) — if conf changes require a restart to take effect, that's consistent with existing settings and does not block this task, just document it. <!-- Updated: 2026-08-15 — confirmed by reading config.ts: readConductorConf() caches for CACHE_TTL_MS=5000ms (config.ts:49) then re-sources conductor.conf; startManagedLoop's delay-getter (() => readConductorConf().metricsSnapshotIntervalMs) is called fresh every tick, so an edited METRICS_SNAPSHOT_INTERVAL_MS takes effect within 5s without a restart — identical mechanism already used by statusPollMs/terminalPollMs. No runtime observation needed; this is a direct consequence of the shared cache/getter pattern. -->

**Note on unit-test scope**: `host-server/index.ts` has no injectable app export (every prior UAT in this repo notes this — Fastify routes and `startManagedLoop` registrations are inline, and the whole file has import-time side effects: opening the DB, sourcing `conductor.conf`, starting all loops). Importing it from a test file would attempt to boot the real server, so it isn't unit-testable in isolation, and this task's scope (per its own Approach) explicitly excludes restructuring `liveUpdateMetrics`/`appendObservabilityLog` into a separate importable module. The closest genuine, side-effect-free unit test is the config-parsing boundary the new loop depends on (`metricsSnapshotIntervalMs`) — added as 3 tests in `host-server/config.test.ts`, mirroring the existing `TERMINAL_LOG_MAX_ROWS_PER_AGENT` tests exactly (default / explicit value / non-positive fallback). The actual `appendObservabilityLog('metrics_snapshot', ...)` write call and its JSONL shape are covered by the deferred runtime step above, not a repeatable unit test.

## Acceptance Criteria

- [ ] `observability.jsonl` gains a `metrics_snapshot` event, written every `METRICS_SNAPSHOT_INTERVAL_MS` (default 60s), containing the full current `liveUpdateMetrics` object and event-loop metrics.
- [ ] The new interval is configurable via `conductor.conf` (`METRICS_SNAPSHOT_INTERVAL_MS`), following the same resolution path as `STATUS_POLL_MS`/`TERMINAL_POLL_MS`.
- [ ] Snapshot writes use the existing `appendObservabilityLog` helper (no new log file, no new write path) and never throw / never affect the host-server's other loops (matches `appendObservabilityLog`'s existing try/catch-and-swallow contract at `host-server/index.ts:427-438`).
- [ ] After the host-server process restarts, `logs/observability.jsonl`'s prior `metrics_snapshot` lines remain readable (they're plain JSONL on disk) even though in-memory `liveUpdateMetrics` has reset — i.e. historical metrics are recoverable by replaying the file.
- [ ] `npx tsc --noEmit` passes in `host-server/`.

## Dependencies

None — independent of the Phase 1 dispatch-latency tasks and of TASK-117/TASK-118 (this task adds a new, unrelated periodic loop and touches `host-server/index.ts` in a different region — the loop-registration block near the bottom of the file — plus `conductor.conf`/`config.ts`). Note for whoever implements TASK-117 (perf-baseline capture): once this task lands, TASK-117's capture script may optionally harvest `metrics_snapshot` lines from `observability.jsonl` directly instead of standing up a separate poller, if that's simpler — either capture method satisfies TASK-117's representativeness bar.

**Hot file**: `host-server/index.ts` is edited concurrently by TASK-120/121 (dispatch-loop region) and TASK-118 (loop `warnAfterMs` literals, same `startManagedLoop` registration block this task adds to). Re-read the loop-registration block immediately before editing to avoid clobbering a concurrent addition.

### Roadmap

Implements ROADMAP-017 Phase 2, item "Persist periodic `liveUpdateMetrics` snapshots to `observability.jsonl` so the metrics survive a host-server restart" — `wiki/work/roadmaps/ROADMAP-017-competitive-audit-followups.md`.
