---
id: TASK-0192
aliases: [TASK-0192]
title: "Add an ANSI-stripped bg process output endpoint"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-0190, TASK-0191]
uat: "[[UAT-0192]]"
tags: [bg-processes, host-server, output, roadmap-0024]
---

# TASK-0192 — Add an ANSI-stripped bg process output endpoint

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]

> ROADMAP-0024 Phase 2 (Backend). Independent of the restart operation. Phase 3's `dev-commands tail` change and Phase 4's live output tail in the Background tab both consume this endpoint.

## Objective

An agent (or the dashboard) can currently read a bg process's output only as the raw `$LOG_DIR/bg-<name>.log`: `dev-commands.sh tail` is a plain `tail -n` on that file. The file is written by `tmux pipe-pane -o "cat >> ..."`, so it holds raw bytes: ANSI colour/cursor escapes, carriage-return progress redraws (`\r` overwriting the same line), and it grows without bound. Unlike agents (`GET /agents/:id/tail`, rendered pane capture), there is no bg equivalent. Add `GET /bg-processes/:name/tail?lines=N` returning the last N lines as clean text, so a project agent can actually read what its dev server printed.

## Approach

- **Source: the log file, not `capture-pane`.** The log survives window close and process exit (exactly when an agent most needs to read why the server died), whereas `capture-pane` of a missing or freshly respawned pane returns nothing. It also contains `--- restart <ts> ---` markers written by `TASK-0190` once that lands, so restart boundaries show up with no extra work here.
- **Bounded read.** Never read the whole file. Read at most the trailing `TAIL_MAX_BYTES` (default 256 KiB, named constant) using `fs.open` + `read` from `size - N`, drop the first partial line, then take the last `lines`. Report `truncated: true` when the file was larger than the window read.
- **Pure cleaner.** Add `host-server/bgOutput.ts` exporting `cleanTerminalOutput(raw: string): string`, unit-tested: strip CSI sequences (`ESC [ ... final byte`, including SGR colour and cursor moves), OSC sequences (`ESC ] ... BEL|ST`), other two-byte escapes; collapse carriage-return redraws by keeping only the text after the last `\r` on each line (so progress bars show their final state, and `\r\n` line endings stay intact); drop remaining control bytes except `\n` and `\t`. Decide and document how to treat a stray backspace. No new dependency unless `strip-ansi` is already in `host-server/package.json` (check with Serena `search_for_pattern`; a small regex is preferred).
- **Query handling.** Mirror `GET /agents/:id/tail`: `?lines=` parsed with `parseInt`, clamped to 1..1000, default 50 (`dev-commands.sh tail` default).
- **Response.** `200 { name, lines: string[], truncated: boolean, sizeBytes: number, logPath: string, updatedAt: string|null }`; `404` for an unknown name; an existing bg process whose log does not exist yet returns `200` with empty `lines` (not an error). Also support `?format=text` returning `text/plain` for the skill script so it needs no `jq`.
- **Route identity** follows `TASK-0188`'s decision (bare name today). If that task decides a different identity, adopt it; this task's steps use `:name` and the existing `bg-<name>.log` path builder.
- **Secrets.** Dev-server output can contain tokens. The route is on the same unauthenticated single-user localhost server as every other route, so this adds no new exposure beyond the file agents can already `tail`; note it in the route comment.
- No auth or project scoping here; read access policy for unscoped rows and same-project checks belong to `TASK-0186`/`TASK-0194` (restart only; reads stay open as they are today via `GET /status`).

## Steps

### 1. Cleaner module  <!-- agent: general-purpose -->

- [x] Create `host-server/bgOutput.ts` with `cleanTerminalOutput(raw)` and `readLogTail(path, { lines, maxBytes })` (returns `{ lines, truncated, sizeBytes, updatedAt }`, tolerates ENOENT by returning empty)
- [x] Create `host-server/bgOutput.test.ts` (node:test, same style as `state.test.ts`) covering: SGR colours removed; cursor-move CSI removed; OSC title sequence removed; `\r`-redrawn progress line collapses to its last frame; `\r\n` preserved; UTF-8 multibyte text unharmed; `--- restart ... ---` marker lines pass through unchanged; a log larger than `maxBytes` reports `truncated: true` and drops the leading partial line; missing file yields empty lines; `lines` clamp behaviour

### 2. Route  <!-- agent: general-purpose -->

- [x] Add `GET /bg-processes/:name/tail` in `host-server/index.ts` beside the other `/bg-processes/:name/*` routes, using `listBgProcesses(db)` for the 404 and the same `path.join(logDir, \`bg-${name}.log\`)` builder as `buildBgStatuses`; parse and clamp `lines` exactly like `/agents/:id/tail`; support `?format=text`
- [x] Add `bgTail(name, lines)` to `frontend/src/lib/api.ts` (typed response only; UI use is Phase 4) and add the route to the routes table in `CLAUDE.md` Core Scripts row for `host-server/index.ts`

### 3. Verify  <!-- agent: general-purpose -->

- [x] Run `cd host-server && npx tsc --noEmit && npm test`, lint the new files, and `cd ../frontend && npx tsc --noEmit` <!-- tsc clean (host-server + frontend); npm test 209/209 pass; eslint clean on bgOutput.ts, index.ts, api.ts; bgOutput.test.ts only has the repo-wide no-floating-promises on top-level test() calls (same as pendingAgents.test.ts / transitionsLog.test.ts) -->
- [DEFERRED-TO-UAT] Add a smoke recipe to this task (mark `[DEFERRED-TO-UAT]`): write a fixture `bg-<name>.log` containing colour escapes and a `\r` progress line under a throwaway registered bg process, call `curl -s "localhost:8788/api/bg-processes/<name>/tail?lines=20&format=text"`, and confirm clean text; never edit a real bg log
  - Recipe: register a throwaway bg process `t0192-smoke`; `printf 'plain\n\033[31mred\033[0m\nprogress 10%%\rprogress 100%%\n--- restart 2026-09-19T00:00:00Z ---\n' > "$LOG_DIR/bg-t0192-smoke.log"`; then `curl -s "localhost:8788/api/bg-processes/t0192-smoke/tail?lines=20&format=text"` should print `plain`, `red`, `progress 100%`, the restart marker with no escape bytes; the JSON form (no `format`) returns `lines`, `truncated:false`, `sizeBytes`, `logPath`, `updatedAt`; an unknown name returns 404; a registered process with no log returns 200 with empty `lines`. Delete the throwaway process and fixture log afterwards.

<!-- Updated: 2026-09-19 -->


## Dependencies

- Depends on: none.
- Blocks: nothing hard; Phase 3 (`dev-commands tail`) and Phase 4 (dashboard live tail) items consume it.
- Parallel-safe with `TASK-0190` and `TASK-0191`; small overlap in `host-server/index.ts` bg routes, in disjoint regions. Benefits from `TASK-0190` (restart marker in the log) but does not require it.
