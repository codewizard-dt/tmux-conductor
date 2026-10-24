---
id: TASK-0203
aliases: [TASK-0203]
title: "Add a `restart` subcommand to the `dev-commands` skill"
status: done
created: 2026-09-20
updated: 2026-10-17
depends_on: [TASK-0190, TASK-0193, TASK-0194, TASK-0196, TASK-0202]
blocks: [TASK-0204, TASK-0208]
parallel_safe_with: [TASK-0191, TASK-0192]
uat: "[[UAT-0203]]"
tags: [bg-processes, skills, dev-commands, restart, roadmap-0024]
---

# TASK-0203 — Add a `restart` subcommand to the `dev-commands` skill

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[shared-dev-commands]]
depends_on::[[TASK-0190]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0194]]
depends_on::[[TASK-0196]]
depends_on::[[TASK-0202]]
blocks::[[TASK-0204]]
blocks::[[TASK-0208]]

> ROADMAP-0024 Phase 3 (Agent Access). Do not start until the server-side restart route (`TASK-0190`), cooldown + audit header convention (`TASK-0193`) and same-project guard (`TASK-0194`) are merged; the script is a thin client over them. It also builds on `TASK-0202`'s `api_get`/`resolve_caller_project` helpers in the same script, so it runs after that task, never in parallel.

## Objective

Agents can now read a project's bg processes but still cannot act on them: the server exposes `POST /api/bg-processes/:slug/restart` (`TASK-0190`), rate-limited and audited by caller (`TASK-0193`) and restricted to same-project callers (`TASK-0194`), but nothing in the agent-facing skill calls it. Add `dev-commands.sh restart <name>` so an agent that sees a crashed dev server (`TASK-0204` makes `exited` visible) can bring it back in one safe, audited command, without knowing tmux, ports or file paths.

## Approach

- **Thin client, all policy on the server.** The script never runs tmux and never decides authorization or cooldown; it sends the request with the caller header and translates the server's answer into a clear message and exit code. This keeps the guard, the cooldown and the audit in one place (research Option A) and means the script cannot be used to bypass them.
- **Request.** `POST $BASE_URL/api/bg-processes/<slug>/restart` with `X-Conductor-Agent: $CONDUCTOR_AGENT_NAME` (header defined by `TASK-0193`; sent whenever the env var is non-empty, via the `api_get`-style helper from `TASK-0202`, generalised to `api_call <method> <path>`). Empty body, `curl -sS -i --max-time 60` (headers and body captured in one variable, no temp files) (restart involves a tmux respawn plus the startup grace, so allow more than the read timeout; a named constant `RESTART_TIMEOUT_S`).
- **Argument resolution.** `restart <name>` where `<name>` is a slug (as printed by `list`) or a bare process name. Resolve like this: fetch `/api/status`; an exact slug match wins; otherwise, when the caller's project is known (`resolve_caller_project` from `TASK-0202`), match `.name` within that project only (so `restart dev` in project A never restarts project B's `dev`); otherwise, when exactly one process machine-wide matches the bare name, use it; when several match, exit 1 and list the candidates. `TASK-0196`'s "bare name only when exactly one slug matches" rule already exists for `status`/`tail`; factor one shared `resolve_slug` helper used by all three subcommands so they agree (the `tail`/`status` migration itself is `TASK-0204`; this task introduces the helper and uses it for `restart`, `TASK-0204` switches the others over).
- **Response mapping and exit codes** (stdout for the success line, stderr for everything else):
  - `200` -> print `Restarted <slug> at <restartedAt>. Use 'dev-commands.sh tail <slug>' to watch it come back up.`; exit 0.
  - `403` (`TASK-0194`: project mismatch, unknown or ambiguous caller) -> `Refused: <slug> belongs to project <bgProjectId>, you are in project <callerProjectId> (or your agent identity could not be resolved).` plus the server's `error` text; exit 3. Do not retry.
  - `404` -> `No such background process: <slug>` plus candidates from `list`; exit 1.
  - `409` (tmux session not running, from `TASK-0190`) -> `The conductor tmux session is not running; nothing to restart.`; exit 4.
  - `429` (`TASK-0193` cooldown) -> `Restart skipped: <slug> was restarted <n>s ago by <lastRestartBy>. Retry in <retryAfterS>s (or check its output with 'tail' first).`; parse `retryAfterS` from the JSON body, falling back to the `Retry-After` header; exit 5. **The script must never sleep-and-retry**: a confused agent looping on restart is exactly what the cooldown exists to stop; the message explicitly says not to retry in a loop.
  - `500` -> print the server's `error` and `step`; exit 6.
  - Host-server unreachable / `curl` failure -> `Cannot reach the conductor host-server on port <BACKEND_PORT>; restart needs it (there is no offline fallback).`; exit 2.
  - Any other status -> print the status and raw body; exit 6.
- **Parsing without `jq`.** `jq` is optional in this skill. For `restart`, `jq` is used when present; when absent, fall back to a small `sed` extraction of the flat JSON keys the messages need (`error`, `restartedAt`, `retryAfterS`, `lastRestartBy`, `callerProjectId`, `bgProjectId`, `step`), and degrade to printing the raw body if a key is missing. Resolution (`resolve_slug`) needs `jq`; without it, require the exact slug and skip project-scoped matching, saying so.
- **No confirmation prompt** (agents are non-interactive; the human confirmation lives in the dashboard, `TASK-0206`). Cooldown, guard and audit are the safety net.
- **Guidance in `SKILL.md`**, written for the agent reader: when to restart (its own diagnosis via `status`/`tail` says the process is `exited` or wedged, not just slow), the etiquette (check `tail` first, one restart then observe, never loop, another agent may already have restarted it, only your own project's processes can be restarted), and what each exit code means.

## Steps

### 1. Confirm the server contract  <!-- agent: Explore -->

- [x] Read the merged `TASK-0190`/`0193`/`0194` code (`host-server/bgRestart.ts`, `bgRestartPolicy.ts`, `bgAccess.ts`, the `POST /bg-processes/:name/restart` route in `host-server/index.ts`) with Serena `find_symbol` and record the exact status codes, response bodies, header names and the slug route param in this task's Approach; adjust the mapping table above if any differ
  - Confirmed contract (host-server/index.ts:2166-2252, prefix `/api`): param `:slug` only (exact match, no bare-name resolution; unresolved -> 404); header `X-Conductor-Agent` (empty/absent = dashboard); check order 404, 403, 409, 429, restart. Bodies: 200 `{ok,name(slug),restartedAt,mechanism}`; 403 `{error:"restart denied: <reason>",reason(project-mismatch|unknown-caller|ambiguous-caller|unscoped),callerProjectId,bgProjectId}` (ids may be null); 404 `{error}`; 409 `{error:'session not running',sessionAlive:false}`; 429 `{error:'restart cooldown',retryAfterS,lastRestartAt,lastRestartBy(null = dashboard)}` + `Retry-After` header; 500 `{error:'restart failed',step,status(number|null)}`. No 400. Mapping table above holds; only extra keys differ (`sessionAlive`, null ids/status).
- [x] Read the merged `TASK-0202` version of `skills/dev-commands/scripts/dev-commands.sh` and confirm the names of `api_get`, `resolve_caller_project`
  - Confirmed: `api_get` (GET-only, `curl -sf`, conditional header), `resolve_caller_project` (returns 0; sets globals `CALLER_PROJECT_ID`/`CALLER_PROJECT_NAME`/`CALLER_UNRESOLVED_REASON`), `fetch_api_status`, `list_slugs`, `suggest_candidates`, and an already-existing `resolve_slug` (TASK-0196: exact slug, else unique `-<name>` suffix, ambiguous returns 2; not project-aware). `restart` adds `api_call`, and a project-scoped step in front of `resolve_slug` without changing status/tail behaviour (TASK-0204 owns that).
<!-- Updated: 2026-09-20 -->


### 2. Script  <!-- agent: general-purpose -->

- [x] In `skills/dev-commands/scripts/dev-commands.sh` generalise `api_get` into `api_call <method> <path>` (keep `api_get` as a wrapper so `list` is untouched), add `resolve_slug <arg>` and `cmd_restart <name>` implementing the resolution and the response mapping above, with `RESTART_TIMEOUT_S` as a named constant
- [x] Add `restart` to the main dispatch `case` and to the usage text and header comment block; `restart` with no argument prints `Usage: dev-commands.sh restart <name>` and exits 1
- [x] Do not use temp files: capture the whole response into a shell variable with `curl -sS -i` (headers + body), split the status line, the `Retry-After` header and the body in bash, so there is nothing to clean up on any exit path
- [x] `bash -n` the script
  - Implemented: `api_call <method> <path> [raw]` (`api_get` now a wrapper), `RESTART_TIMEOUT_S=60`, `urlencode`, `json_field`, `iso_to_epoch`, `resolve_restart_slug` (exact slug, then caller's project, then machine-wide; `resolve_slug` untouched for status/tail because TASK-0204 owns that switch), `cmd_restart`. Ambiguous bare name in restart exits 1 (task spec), whereas status/tail keep exit 2 until TASK-0204.
<!-- Updated: 2026-09-20 -->

### 3. SKILL.md  <!-- agent: general-purpose -->

- [x] Update `skills/dev-commands/SKILL.md`: front matter `description` and `argument-hint` (`{list|status|tail|restart} [options]`), a new "Restart a process" section (usage, example output for success/cooldown/refused, exit-code table, etiquette), an entry in "When to use this tool" ("The dev server crashed. Can I bring it back?"), and a note under "Offline resilience" that `restart` needs the host-server
- [x] Run `scripts/verify-dev-commands-skill-frontmatter.sh` and update it if it hard-codes the old `argument-hint`/`description`

### 4. Tests  <!-- agent: general-purpose -->

- [x] Create `scripts/verify-dev-commands-restart.sh` (new file, own section; `TASK-0208` wires it into the aggregate verify run): start a tiny Node stub HTTP server on an ephemeral port from `./tmp/verify-dev-commands-restart/` that answers `GET /api/status`, `GET /api/agents/whoami` and `POST /api/bg-processes/:slug/restart` with a status/body selected by the slug (`ok-proc` -> 200, `other-proj` -> 403, `missing` -> 404, `nosession` -> 409, `cool` -> 429 with `Retry-After`, `boom` -> 500), record the received `X-Conductor-Agent` header, run the script against it with `BACKEND_PORT` set, and assert: exit code and message per status; the header is forwarded verbatim; **no retry on 429** (stub counts requests: exactly one); bare name resolves within the caller's project (two projects with a `dev` process: the request path uses the caller's slug); ambiguous bare name with no caller project exits 1 listing candidates; unreachable port exits 2
- [x] Add offline/argument checks to that script: `restart` with no argument exits 1 with usage
- [x] Run `bash scripts/verify-dev-commands-restart.sh`, `bash scripts/verify-dev-commands.sh`, `bash scripts/verify-dev-commands-skill-frontmatter.sh`, `bash -n` on every touched script
- [x] Record a live smoke recipe marked `[DEFERRED-TO-UAT]` (owned by `TASK-0208`'s UAT): with a throwaway bg process in the caller's project, `dev-commands.sh restart <name>` succeeds and the log shows a `--- restart <ts> ---` marker; a second call within the cooldown exits 5; a process in another project exits 3; `logs/bg-restarts.jsonl` gets one line per attempt
  - Result: `scripts/verify-dev-commands-restart.sh` passes 71 checks (stub server, no-jq path included); live recipe recorded as a `[DEFERRED-TO-UAT]` comment block at the bottom of that script.
<!-- Updated: 2026-09-20 -->


### 5. Docs  <!-- agent: general-purpose -->

- [x] Update `scripts/README.md` (dev-commands section, if present) and `wiki/knowledge/concepts/background-process-registry.md` (agent-facing restart path and the exit-code contract) and `wiki/knowledge/sources/shared-dev-commands.md` if it lists the subcommand set
  - Done: `scripts/README.md` had no dev-commands section, so a "restart client" paragraph plus test line was added after the bg restart audit-log section; `background-process-registry.md` got an "Agent-facing restart path" section with the exit-code table; `shared-dev-commands.md` got a `> **Contradiction:**` callout (its recommendation listed only `list`/`status`/`tail`).
<!-- Updated: 2026-09-20 -->

## Files touched

- `skills/dev-commands/scripts/dev-commands.sh`, `skills/dev-commands/SKILL.md`
- `scripts/verify-dev-commands-restart.sh` (new), possibly `scripts/verify-dev-commands-skill-frontmatter.sh`
- `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md`, `wiki/knowledge/sources/shared-dev-commands.md`
- No `host-server/` or `frontend/` source edits. Collision notes: the script and `SKILL.md` are shared with `TASK-0196`, `TASK-0202`, `TASK-0204`, strictly sequential in that order.

## Dependencies

- Depends on: `TASK-0190` (restart route), `TASK-0193` (caller header, cooldown 429), `TASK-0194` (same-project guard, 403), `TASK-0196` (slug identity), `TASK-0202` (shared helpers in the same script).
- Blocks: `TASK-0204` (same script/SKILL.md), `TASK-0208` (verify script and UAT exercise this subcommand).
- Parallel-safe with `TASK-0191`, `TASK-0192` (they touch `host-server/` and `monitor.sh`, not the skill).
