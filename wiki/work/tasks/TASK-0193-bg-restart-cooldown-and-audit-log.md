---
id: TASK-0193
aliases: [TASK-0193]
title: "Add a restart cooldown and an audit log recording which agent triggered each restart"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: [TASK-0190]
blocks: [TASK-0194]
parallel_safe_with: [TASK-0191, TASK-0192]
uat: "[[UAT-0193]]"
tags: [bg-processes, host-server, restart, audit, roadmap-0024]
---

# TASK-0193 — Add a restart cooldown and an audit log recording which agent triggered each restart

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0190]]
blocks::[[TASK-0194]]

> ROADMAP-0024 Phase 2 (Backend). Wraps the restart operation from `TASK-0190`; do not start until `POST /bg-processes/:name/restart` exists. This task also defines the **caller-identification convention** that `TASK-0194` then resolves to a project.

## Objective

Once agents can restart a shared dev server, one confused agent can restart-loop it and take it down for every other agent in the project, and nobody can tell who did it. Add (1) a per-process restart cooldown enforced by the server, and (2) an append-only audit log recording every restart attempt with the triggering caller, outcome, and timing. Surface the last successful restart (time and caller) on the bg status payload so Phase 4's dashboard can show it.

## Approach

- **Caller identification.** The `dev-commands` script (Phase 3) will send its `CONDUCTOR_AGENT_NAME` (the tmux window name, `<project>-<name>` for project agents) in an `X-Conductor-Agent` request header. Define that convention here: header name, value = the raw window/agent name string, trimmed, length-capped (for example 128 chars), recorded verbatim in the audit log. Absent header means a human/dashboard caller. This is a runaway-loop guardrail, not an authentication boundary: the host-server is single-user, localhost, no auth by design (CLAUDE.md), so an agent that omits the header bypasses the agent cooldown; document that limitation explicitly in the route comment and the audit record (`callerKind`).
- **Cooldown.** Config in `conductor.conf`: `BG_RESTART_COOLDOWN_S` (default 30), read by `host-server/config.ts` alongside the other tuning settings (tuning only, per the config/data split; if `config.ts` lacks a place for this add it next to `pendingAgentStaleMs`). Rule: an identified agent caller is rejected with `429` `{ error: 'restart cooldown', retryAfterS, lastRestartAt, lastRestartBy }` plus a `Retry-After` header when the process was successfully restarted less than the cooldown ago **by anyone**. Dashboard/no-header callers are exempt (a human double-click is not a loop; still logged). A failed restart does not start the cooldown.
- **Audit log.** Append JSONL to `$LOG_DIR/bg-restarts.jsonl`, one record per attempt: `ts`, `bg` (name), `callerKind` (`agent` or `dashboard`), `caller` (raw header value or null), `outcome` (`restarted` | `cooldown` | `failed` | `denied`), `cooldownRemainingS` (when applicable), `mechanism` and `step` (on failure). `denied` is reserved for `TASK-0194`. Follow the shape and append helper style of the other JSONL logs (`logs/hooks.jsonl`, `transitions.jsonl`); check `host-server/transitionsLog.ts` for the existing append utility and reuse it rather than writing a new one.
- **State for the cooldown.** Derive last-successful-restart per bg from an in-memory map seeded lazily from the tail of `bg-restarts.jsonl` on first use, so a host-server restart does not reset the cooldown. Keep pure logic in `host-server/bgRestartPolicy.ts` (`evaluateCooldown({ now, lastRestartAt, cooldownMs, callerKind })`, `buildAuditRecord(...)`) and inject the clock and file appender for tests.
- **Status payload.** Add `lastRestart: { at: string, caller: string | null } | null` to `BgStatus` in `host-server/index.ts` (and the frontend `BgStatus` type in `frontend/src/lib/api.ts`, type only). Phase 4's "Show last restart time and the triggering agent" item renders it.
- **Log growth.** Bounded by nature (one line per restart attempt); note that no rotation is added, consistent with the other JSONL logs, and record it as a known limit.

## Steps

### 1. Read the restart operation and existing JSONL helpers  <!-- agent: Explore -->

- [x] Read the finished `TASK-0190` implementation (`host-server/bgRestart.ts` and the `POST /bg-processes/:name/restart` route) and `host-server/transitionsLog.ts` + `config.ts` (find where `pendingAgentStaleMs`/`PENDING_AGENT_STALE_S` is parsed); confirm the append helper and config-key pattern to reuse
  - Findings: there is no `transitionsLog.ts` (appenders are private in `index.ts`; `transitionsLog.test.ts` regex-pins `appendTransitionLog`, so leave it alone) — the policy module carries its own injectable appender (mkdir + appendFile + silent catch). Route has no header read today (`req.headers['x-conductor-agent']` is new). Config key needs: `ConductorConf` field, the `declare -p` list (config.ts ~157), `parsePositiveIntSetting`, cache object. Frontend has no `BgStatus`; the dashboard type is `BgProcess` in `frontend/src/components/AgentList.tsx`. Tests: `node --import tsx/esm --test <file>`, node:test style.
<!-- Updated: 2026-09-20 -->


### 2. Policy module  <!-- agent: general-purpose -->

- [x] Create `host-server/bgRestartPolicy.ts` exporting `evaluateCooldown`, `buildAuditRecord`, `parseCallerHeader` (trim, cap length, strip control chars) and a small `RestartHistory` class (in-memory map seeded from the JSONL tail)
- [x] Add `BG_RESTART_COOLDOWN_S` to `conductor.conf` (commented default 30) and parse it in `host-server/config.ts`; document it in the config section of `scripts/README.md` and `conductor.conf` comments
  - Done: `bgRestartCooldownMs` in `ConductorConf` (config.ts) + 3 config tests; live assignment `BG_RESTART_COOLDOWN_S=30` with a comment block in `conductor.conf`; `scripts/README.md` had no config section, so a small "Host-server tuning keys" table was added.
<!-- Updated: 2026-09-20 -->


### 3. Wire into the restart route  <!-- agent: general-purpose -->

- [x] In `POST /bg-processes/:name/restart` (`host-server/index.ts`): read `X-Conductor-Agent`, evaluate the cooldown before calling `restartBgProcess`, return `429` with `Retry-After` on rejection, append an audit record for every attempt (restarted, cooldown, failed)
- [x] Add `lastRestart` to `BgStatus` and populate it in `buildBgStatuses` from `RestartHistory`; mirror the type in `frontend/src/lib/api.ts`
  - Done: shared lazily-seeded history via `getRestartHistory(logDir)` in `bgRestartPolicy.ts`; route leaves a `// TASK-0194: same-project guard goes here, before the cooldown check` marker; 409 session-not-running is audited as `failed`/`session-check`, 404 is not audited. Frontend: `BgLastRestart` in `api.ts`, `lastRestart?` on `BgProcess` (AgentList.tsx; the frontend has no `BgStatus` type). The bg-update SSE diff was deliberately left for TASK-0207.
<!-- Updated: 2026-09-20 -->


### 4. Tests  <!-- agent: general-purpose -->

- [x] Add `host-server/bgRestartPolicy.test.ts` covering: agent inside cooldown rejected with correct `retryAfterS`; agent after cooldown allowed; dashboard caller exempt inside cooldown; failed restart does not arm the cooldown; cooldown applies across different agent callers; history reseeded from a fixture JSONL after a "restart" of the module; malformed JSONL lines skipped; header parsing (empty, oversized, control characters); audit record fields and JSON validity
- [x] Run `cd host-server && npx tsc --noEmit && npm test`, lint the new files, `cd ../frontend && npx tsc --noEmit`
  - Results: 36 new tests pass; file-scoped run of bgRestartPolicy/config/bgRestart/transitionsLog = 100/100 pass. Full `npm test` deliberately NOT run (some suites can touch real tmux). host-server `tsc --noEmit` clean (a transient error from another agent's mid-edit cleared), eslint clean on new files, frontend `tsc --noEmit` clean.
<!-- Updated: 2026-09-20 -->


### 5. Docs  <!-- agent: general-purpose -->

- [x] Document the `bg-restarts.jsonl` fields, the `X-Conductor-Agent` header convention, and the guardrail-not-security caveat in the `CLAUDE.md` observability table row list, `scripts/README.md`, and `wiki/knowledge/concepts/background-process-registry.md`
  - Done: new `$LOG_DIR/bg-restarts.jsonl` row in the `CLAUDE.md` table; "Bg restart audit log and caller header" block after the tuning-keys table in `scripts/README.md`; "Restart cooldown and audit (TASK-0193)" section in the registry concept page.
- [x] Add a live smoke recipe to this task marked `[DEFERRED-TO-UAT]`: two rapid `curl -X POST -H 'X-Conductor-Agent: demo-agent' .../bg-processes/<throwaway>/restart` calls (second returns 429 with `Retry-After`), then confirm two lines in `logs/bg-restarts.jsonl`
  - **[DEFERRED-TO-UAT]** Live smoke recipe (needs the conductor tmux session running and the host-server on :8788; never use a real dev/dev-stack bg process):
    1. Register a throwaway bg process on a scratch project via the dashboard or `POST /bg-processes` (e.g. name `smoke`, cmd `sleep 600`); its slug is `<throwaway>` = `<scratchProject>-smoke`.
    2. Two rapid agent-identified restarts: `curl -i -X POST -H 'X-Conductor-Agent: demo-agent' http://localhost:8788/bg-processes/<throwaway>/restart`, twice back to back. Expect the first 200 and the second 429 with a `Retry-After` header and JSON body `{ error: 'restart cooldown', retryAfterS, lastRestartAt, lastRestartBy }`.
    3. A third, header-less call: `curl -i -X POST http://localhost:8788/bg-processes/<throwaway>/restart`. Expect 200 (dashboard callers are cooldown-exempt).
    4. `tail -n 3 logs/bg-restarts.jsonl`. Expect three lines in order: `restarted` (`callerKind: agent`, `caller: demo-agent`, `mechanism` set), `cooldown` (`callerKind: agent`, `cooldownRemainingS` set), `restarted` (`callerKind: dashboard`, `caller: null`).
    5. Clean up: `DELETE /bg-processes/<throwaway>` and delete the scratch project if it was created only for this test.
<!-- Updated: 2026-09-20 -->

## Dependencies

- Depends on: `TASK-0190` (the restart route and module this wraps).
- Blocks: `TASK-0194` (same-project guard reuses the caller header and adds the `denied` outcome).
- Parallel-safe with `TASK-0191` and `TASK-0192`.
