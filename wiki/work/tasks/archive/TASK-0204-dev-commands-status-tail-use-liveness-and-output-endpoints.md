---
id: TASK-0204
aliases: [TASK-0204]
title: "Point `dev-commands status`/`tail` at the new liveness and output endpoints and fix the `SKILL.md` state vocabulary"
status: done
created: 2026-09-20
updated: 2026-10-17
depends_on: [TASK-0191, TASK-0192, TASK-0193, TASK-0196, TASK-0202, TASK-0203]
blocks: [TASK-0208]
parallel_safe_with: []
uat: "[[UAT-0204]]"
tags: [bg-processes, skills, dev-commands, liveness, output, roadmap-0024]
---

# TASK-0204 — Point `dev-commands status`/`tail` at the new liveness and output endpoints and fix the `SKILL.md` state vocabulary

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[shared-dev-commands]]
depends_on::[[TASK-0191]]
depends_on::[[TASK-0192]]
depends_on::[[TASK-0193]]
depends_on::[[TASK-0196]]
depends_on::[[TASK-0202]]
depends_on::[[TASK-0203]]
blocks::[[TASK-0208]]

> ROADMAP-0024 Phase 3 (Agent Access). `TASK-0191` (liveness, `pending-uat`) and `TASK-0192` (output endpoint, `pending-uat`) are already implemented; this task is their consumer. It is the last of the three Phase 3 tasks that edit `skills/dev-commands/scripts/dev-commands.sh` and `SKILL.md` (order: `TASK-0202` -> `TASK-0203` -> this), so it uses the `api_call`/`resolve_slug` helpers those introduce.

## Objective

`dev-commands.sh status` still reports only the state file plus `windowPresent`, and `tail` still runs a raw `tail -n` on `bg-<name>.log`: the agent sees ANSI escapes and `\r` progress redraws, and a crashed dev server that dropped back to a shell prompt still reads as healthy. `SKILL.md` also documents a state vocabulary (`idle/busy/running`) that `monitor.sh` never wrote; since `TASK-0191` it writes `running`/`exited`/`dead`. Repoint `status` at `BgStatus.liveness` (`running`/`exited`/`stopped`) and `lastRestart`, `tail` at `GET /api/bg-processes/:slug/tail?format=text`, keep an offline fallback for both, and correct `SKILL.md` so an agent can trust what the skill tells it.

## Approach

- **`status <name>`** (online-first, reversing today's state-file-first order): resolve the slug with `resolve_slug` (`TASK-0203`), `GET /api/status`, select the process, and print:
  ```
  <slug> (project <projectName>)
    liveness:     running | exited | stopped      <- BgStatus.liveness, the authoritative signal
    window:       present | absent                <- windowPresent
    last restart: <ISO ts> by <caller>            <- BgStatus.lastRestart, or "never" / omitted when the field is absent
    state file:   <content>  (poll-lagged, may be up to one poll interval old)
  ```
  followed by one plain sentence interpreting the liveness: `exited` -> "the process is not running (window is at a shell prompt); check `tail`, then `restart` if appropriate"; `stopped` -> "no tmux window; `restart` will start it". Status works with no state file at all when the server is reachable (the server knows the process). Exit 0 whenever the process is found; exit 1 for an unknown name (with the candidate list from `list`); exit 0 with degraded output for a reachable-but-old server that lacks `liveness` (print `liveness: unknown (host-server predates liveness reporting)`, then fall back to `windowPresent`).
- **Offline status** (host-server unreachable or `jq` missing): print the state file, labelled poll-lagged, with the corrected vocabulary, and the existing "Live cross-check unavailable (...)" line, unchanged, so `scripts/verify-dev-commands.sh` tests 5 and 6 keep their expected strings; interpret the state value inline (`running` / `exited` / `dead` = window not found, plus legacy `alive`/`idle`/`busy` from files written before `TASK-0191`, printed as-is with "(legacy value)").
- **`tail <name> [-n N]`**: validate `N` as a positive integer (non-integer -> usage error exit 1; the server clamps to 1..1000, so document the cap and clamp locally to avoid a misleading result). Online: `GET /api/bg-processes/<slug>/tail?lines=N&format=text` and print the body as-is (the server has already stripped ANSI, collapsed `\r` redraws and includes `--- restart <ts> ---` markers). Status handling: 404 -> `No such background process` + candidates (exit 1); 200 with an empty body -> `(no output yet for <slug>)`, exit 0 (a registered process with no log is not an error, matching the endpoint). Note whether the server truncated the read: text mode has no field for it, so do not claim it; the JSON form is not needed here.
- **Offline tail fallback**: read `$CONDUCTOR_LOG_DIR/bg-<slug>.log` directly as today, but pipe through a best-effort cleaner, printed after a stderr note `Note: host-server unreachable; showing the raw log with a best-effort escape strip.` The cleaner is a small `sed -E` on `$'\033'`-quoted patterns (CSI `ESC[...letter`, OSC `ESC]...BEL`) plus `sed "s/.*$'\r'//"` to keep only the text after the last `\r` per line; use only BSD/GNU-compatible sed syntax (repo convention; macOS ships BSD sed), and keep the missing-file message (`No log file for '<name>'`) intact so `verify-dev-commands.sh` test 7 still matches. Because the offline path keys the file by slug, `resolve_slug` is skipped offline (the argument is used as given; a bare name works only if it equals the slug, and a note says so when the file is missing).
- **`resolve_slug` adoption**: `status` and `tail` now share the helper introduced by `TASK-0203`, so `status dev`, `tail dev` and `restart dev` all agree (caller's project first, then unique machine-wide match, else candidates). This replaces `TASK-0196`'s interim "bare name only when exactly one slug matches" logic in those two subcommands.
- **`SKILL.md` vocabulary fix** (the drift the research flagged): replace every "idle/busy/running" mention (the process description list, the "List all registered processes" and "Check a specific process's status" sections, the worked example that shows `running` next to `windowPresent: true`) with the real vocabulary: liveness `running | exited | stopped` (server) and state-file values `running | exited | dead` (monitor). Explain the distinction once, near the top, in agent-facing words: `stopped`/`dead` = no window; `exited` = window open but the process is gone (crashed or finished); `running` = alive. Update the "Together, these signals let you distinguish..." paragraph, the offline-resilience bullets (`tail` is now also served by the server but still works offline), and the "Tail a process's log" section (clean text, restart markers, `-n` cap). Keep `description`/`argument-hint` in step with `TASK-0203`'s edit.
- Do not change the `list` line format beyond adding the liveness value as an extra field if `TASK-0202` left room for it: `<slug> — liveness: <running|exited|stopped>, state: <...>, window: <bool>`. Adding it here is the right place (this is the task that owns liveness in the skill); keep the older tokens in the same order so parsers of the old line still find them.

## Steps

### 1. Confirm inputs  <!-- agent: Explore -->

- [x] Read the merged `TASK-0191`/`0192`/`0193` code with Serena `find_symbol`: the `BgStatus` type (`liveness`, `lastRestart`, `slug`), `buildBgStatuses`, the `GET /bg-processes/:name/tail` route (query params, text vs JSON, clamp, 404 shape), and `monitor.sh`'s bg state writer (`running`/`exited`/`dead`); record the exact field names in this task's Approach — confirmed: `BgStatus` (`host-server/index.ts`) has `slug, name, windowPresent, liveness: 'running'|'exited'|'stopped', state: string|null, projectId, projectName, lastRestart: {at: ISO, caller: string|null}|null`; `GET /bg-processes/:slug/tail?lines&format=text` (404 JSON `{error}` for unknown slug, 200 + empty body when no log, `lines` clamped 1..1000); `monitor.sh` writes `running`/`exited`/`dead` to `bg-<slug>.state`
- [x] Read the merged `TASK-0202`/`0203` script for the helper names (`api_call`, `resolve_slug`, `resolve_caller_project`) — also `resolve_restart_slug` (project-aware, ambiguity exit 1), renamed here to `resolve_project_slug`; `resolve_target_slug` (new) wraps it for status/tail (online: project-aware, ambiguity exit 2 kept; offline: `resolve_slug` over state-file basenames, so TASK-0196's offline bare-name tests keep passing — deviates from the Approach's "skip resolve offline")

### 2. Script: status  <!-- agent: general-purpose -->

- [x] Rewrite `cmd_status` in `skills/dev-commands/scripts/dev-commands.sh` per Approach (online-first, liveness/lastRestart lines, interpretive sentence, degraded output for old servers, offline path with the unchanged labelled strings)
- [x] Add liveness to the `cmd_list` line format (online: `.liveness // "unknown"`; offline: not available) if `TASK-0202` did not already — format `<slug> — liveness: L, state: S, window: W[, project: P]`; UAT-0202's "no liveness column" assertion is now stale (flagged to team-lead)
- [x] `bash -n` the script

### 3. Script: tail  <!-- agent: general-purpose -->

- [x] Rewrite `cmd_tail`: integer validation of `-n`, `resolve_slug`, online call to `/api/bg-processes/<slug>/tail?lines=N&format=text`, 404/empty handling, offline fallback with the `sed` cleaner and the stderr note; keep both argument orders (`tail <name> -n N` and `tail -n N <name>`)
- [x] Verify the `sed` cleaner on macOS BSD sed and GNU sed semantics with a fixture containing an SGR colour, a cursor-move CSI, an OSC title and a `\r` progress line (no live server needed) — BSD sed verified on macOS (SGR, CSI, OSC, `\r` redraw, CRLF); GNU sed not available locally, the patterns use only POSIX ERE features common to both

### 4. SKILL.md  <!-- agent: general-purpose -->

- [x] Fix the state vocabulary and update the `list`, `status`, `tail`, offline-resilience and notes sections as described in Approach; grep the file with Serena `search_for_pattern` for `idle|busy` afterwards and confirm none remain that refer to bg processes — only the deliberate "legacy `alive`/`idle`/`busy`" mention remains
- [x] Run `bash scripts/verify-dev-commands-skill-frontmatter.sh`; update `scripts/README.md` and `wiki/knowledge/concepts/background-process-registry.md` where they describe the skill's status/tail behavior

### 5. Tests  <!-- agent: general-purpose -->

- [x] Update `scripts/verify-dev-commands.sh` fixtures and assertions that encode the old behavior: test 4 (`idle`/`running` fixture values -> use `running`/`exited`), test 6 (keep the labelled state-file and offline cross-check strings), test 8/9 (offline `tail` now passes the log through the cleaner: plain lines still come back byte-identical, so they should pass unchanged; add escape/`\r` fixtures asserting stripped output)
- [x] Extend `scripts/verify-dev-commands-restart.sh` (created by `TASK-0203`) with stub-server cases for `status` (liveness `exited` prints the interpretive sentence; server without `liveness` prints the degraded line; `lastRestart` rendered) and `tail` (text body passed through unchanged; 404 exits 1 with candidates; empty body prints the "no output yet" line; `-n` non-integer exits 1; `-n` value forwarded as `lines=`); rename the script's header comment accordingly, keep the filename
- [x] Run `bash scripts/verify-dev-commands.sh`, `bash scripts/verify-dev-commands-restart.sh`, `bash scripts/verify-dev-commands-skill-frontmatter.sh`, `bash -n` on touched scripts — all pass (restart script now 149 checks)
- [x] Record a live smoke recipe marked `[DEFERRED-TO-UAT]` (owned by `TASK-0208`): kill the process inside a throwaway bg window so it falls back to a shell, `dev-commands.sh status <name>` reports `liveness: exited`, `tail` prints escape-free text including a restart marker after a restart — recorded as steps 5-7 in `scripts/verify-dev-commands-restart.sh`
<!-- Updated: 2026-09-20 -->
<!-- Implementation note: also refactored cmd_restart's HTTP split into `parse_http_response` (shared with tail); `resolve_restart_slug` renamed `resolve_project_slug`. Files also touched: scripts/README.md, wiki/knowledge/concepts/background-process-registry.md -->


## Files touched

- `skills/dev-commands/scripts/dev-commands.sh`, `skills/dev-commands/SKILL.md`
- `scripts/verify-dev-commands.sh` (edits existing assertions 4, 6, 8, 9 and adds cleaner cases), `scripts/verify-dev-commands-restart.sh` (extended)
- `scripts/README.md`, `wiki/knowledge/concepts/background-process-registry.md`
- No `host-server/` or `frontend/` source edits. Collision notes: strictly after `TASK-0203` (same script and `SKILL.md`); `scripts/verify-dev-commands.sh` is also extended by `TASK-0202` (append-only) and `TASK-0208`, so re-read it before editing.

## Dependencies

- Depends on: `TASK-0191` (`BgStatus.liveness`, state vocabulary), `TASK-0192` (tail endpoint), `TASK-0193` (`lastRestart` on `BgStatus`), `TASK-0196` (slug identity), `TASK-0202` and `TASK-0203` (helpers and the same files, must land first).
- Blocks: `TASK-0208` (the verify script and UAT assert the final `status`/`tail` output).
- Parallel-safe with: nothing in Phase 3 (all three tasks share the same two files); backend tasks are already done or independent of it.
