---
id: TASK-0190
aliases: [TASK-0190]
title: "Add one atomic restart operation for a bg process that reattaches log capture and writes a restart marker"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: [TASK-0189, TASK-0188]
blocks: [TASK-0193, TASK-0194]
parallel_safe_with: [TASK-0191, TASK-0192]
uat: "[[UAT-0190]]"
tags: [bg-processes, host-server, restart, roadmap-0024]
---

# TASK-0190 — Add one atomic restart operation for a bg process that reattaches log capture and writes a restart marker

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
depends_on::[[TASK-0189]]
depends_on::[[TASK-0188]]
blocks::[[TASK-0193]]
blocks::[[TASK-0194]]

> ROADMAP-0024 Phase 2 (Backend). Read the `## Finding` in `TASK-0189` (mechanism and exact ordered tmux sequence) and the `## Decision` in `TASK-0188` (addressable identity) **before starting**; this task adopts them rather than re-deciding. If either is still empty, stop and finish it first.

## Objective

There is no restart primitive. Today a restart is two non-atomic client calls: `DELETE /bg-processes/:name/window` then `POST /bg-processes/:name/window`, and the latter returns 409 if the window still exists. The spawn path in `POST /bg-processes/:name/window` (`host-server/index.ts` ~2015-2037) also interpolates `entry.workdir` unquoted and wraps `entry.launchCmd` in literal double quotes inside a shell string (`send-keys -t ... "${entry.launchCmd}" Enter`), so a command containing `"`, `$`, or a backtick is mangled or expanded. Add one server-side operation, `POST /bg-processes/:name/restart`, used by both the dashboard and agents, that stops the running process, starts a fresh one, re-attaches `pipe-pane` log capture, and writes a restart marker to `$LOG_DIR/bg-<name>.log` so readers can see where the restart happened. Fix the quoting once, in a shared helper used by both the restart route and the existing open-window route.

## Approach

- **Identity (decided in `TASK-0188`, 2026-09-20):** bg process names are unique per project and the addressable identity is the slug `<projectName>-<name>`. The restart route is therefore `POST /bg-processes/:slug/restart`, resolved through `getBgBySlug` from `TASK-0196` (which may land in either order: until it does, the slug equals the bare name), and the log/state paths, tmux window name and restart marker all use the slug.
- **One code path.** New module `host-server/bgRestart.ts` exports a pure command builder (`buildBgSpawnArgs`) that returns tmux **argv arrays** (never shell strings), a `restartBgProcess(deps, entry)` orchestrator, and a `formatRestartMarker(date)` helper. Route handlers stay thin. Injecting a `deps` object (`runTmux`, `windowPresent`, `appendFile`, `now`) makes the orchestrator testable without a live tmux; the repo has no Fastify route-test harness, so test the module, not the route.
- **Mechanism and ordering (decided by `TASK-0189`'s `## Finding`, measured 2026-09-20 on tmux 3.7c):** use `respawn-window -k -t <session>:=<slug> -c <workdir>` with **no command**, then type the launch command. The pipe survives the respawn, so log capture needs no re-attach in the normal case. Ordered sequence (`T = windowTarget(session, slug)`, `LOG = $LOG_DIR/bg-<slug>.log`):
  1. Presence via `tmux has-session -t T` (never a failing `display-message -t`, which falls back to the current window and exits 0). Absent -> start path: `new-window -d -t <session>: -n <slug> -c <workdir>`, `pipe-pane -t T "cat >> '<LOG>'"` **before typing**, marker, type the command.
  2. Present: capture `#{pane_pid}` and its descendant pids by walking `ps -axo pid=,ppid=` (macOS `pgrep` has no `-s`); keep the root in the list.
  3. `respawn-window -k -t T -c <workdir>` (`-k` is required on a live pane).
  4. For each captured pid still alive, `kill -KILL` it: `-k` only hangs up the pty, and a HUP/TERM-ignoring process otherwise survives as an orphan holding its port (measured in both mechanisms). Never kill the pane root before step 3 (it closes the window).
  5. Idempotent reattach guard: if `display-message -p -t T '#{pane_pipe}'` is `0`, run `pipe-pane -t T "cat >> '<LOG>'"` **without `-o`**. Never a bare `pipe-pane -o` on a possibly piped pane: `-o` toggles an existing pipe off.
  6. Server-side `appendFileSync` of the marker **after step 3 (and 5) and before step 7** (ordered 20/20 in both shells, no old-process output after it; a marker before the respawn lets the old process write after it).
  7. `send-keys -t T -l -- <launchCmd>`, then a separate `send-keys -t T Enter`.

  Rejected: direct `respawn-window -k "<cmd>"` (a crash closes the window so `exited` becomes `stopped`; a `; exec $SHELL` wrapper keeps the wrapper shell as the foreground process so `bgLiveness` reads `exited` while running) and `kill-window` + `new-window` (loses the pipe, new pane id, a ~4 ms gap in which `display-message` answers for another window). Steps 2 and 4 below implement this sequence verbatim.
- **Safe quoting.** Use `spawnSync('tmux', [...args])` (the pattern `host-server/state.ts::runTmux` already uses) with the launch command passed as a single argv element and `-c <workdir>` as its own element. Typing the command into a shell with `send-keys -l <cmd>` then a separate `Enter` follows the repo's dispatch convention (literal mode, `Enter` as a separate arg). For the `pipe-pane` shell-command argument, single-quote-escape the log path.
- **Window target** always via `windowTarget(sessionName, name)` (exact-match `=`), per `TASK-0182`.
- **Restart marker.** After the new process starts and capture is (re)attached, append `\n--- restart <ISO-8601 UTC> ---\n` to the log with `appendFileSync` from the server (not typed into the pane, so it cannot be executed by a shell). Ordering relative to the new process's first output is set by `TASK-0189`'s finding.
- **Behavior on missing window.** If the registered process has no window (never started or closed), restart behaves like "start" (creates the window), so an agent can bring a dead dev server back with one call. Return `409 { error: 'session not running' }` when the tmux session is absent, `404` when the name is unknown.
- **Response.** `200 { ok: true, name, restartedAt, mechanism }`.
- Out of scope here (separate tasks): cooldown and caller audit (`TASK-0193`), project guard (`TASK-0194`), liveness (`TASK-0191`), output endpoint (`TASK-0192`).

## Steps

### 1. Read the spike and decision inputs  <!-- agent: Explore -->

- [x] (the `TASK-0189` finding is now folded into Approach above; re-read it to confirm) Read `wiki/work/tasks/TASK-0189-spike-pipe-pane-survives-respawn-window.md` `## Finding` and `wiki/work/tasks/TASK-0188-decide-bg-process-name-uniqueness.md` `## Decision`; summarise the chosen mechanism, the exact ordered tmux sequence, and the addressable identity in a short note at the top of this task's Approach
- [x] Read `host-server/index.ts` bg routes (`POST /bg-processes`, `DELETE /bg-processes/:name`, `POST|DELETE /bg-processes/:name/window`) and `host-server/state.ts` (`runTmux`, `windowTarget`, `isTmuxWindowPresent`, `TMUX_SYNC_TIMEOUT_MS`) with Serena `find_symbol`

### 2. Build the shared spawn/restart module  <!-- agent: general-purpose -->

- [x] Create `host-server/bgRestart.ts` exporting `buildBgSpawnArgs(entry, sessionName, logDir)`, `formatRestartMarker(now: Date)`, and `restartBgProcess(deps, entry, opts)`
  - `deps`: `{ runTmux(args: string[]): { status: number|null }; windowPresent(session, name): boolean; appendFile(path, text): void; now(): Date }`; defaults wired from `state.ts` and `node:fs`
  - Implement the ordered sequence recorded from `TASK-0189` verbatim; make the `pipe-pane` reattach idempotent per that finding
  - If any tmux step fails, return a typed error (`{ ok: false, step, status }`) rather than throwing, and do not write the marker on failure
- [x] Ensure no user-controlled string (`name`, `workdir`, `launchCmd`) is ever concatenated into a shell string; the only shell command string allowed is the `pipe-pane` pipe target with a single-quote-escaped log path

<!-- Updated: 2026-09-20 -->
<!-- Step 2 note: the marker is written after respawn/reattach and BEFORE typing (per TASK-0189), so a send-keys failure returns { ok:false, step:'send-keys'|'send-enter' } after the marker is already in the log. A failed marker write returns step 'write-marker' and types nothing. Session-absent (409) is the route's job. Default runTmux uses its own 5000ms timeout (BG_RESTART_TMUX_TIMEOUT_MS), not TMUX_SYNC_TIMEOUT_MS (100ms default). -->

### 3. Wire the routes  <!-- agent: general-purpose -->

- [x] Add `POST /bg-processes/:name/restart` in `host-server/index.ts` next to the `/window` routes: resolve entry via `listBgProcesses(db)`, 404 if unknown, 409 if the tmux session is not running, call `restartBgProcess`, map failures to 500 with `{ error, step }`, return the success body above
- [x] Refactor `POST /bg-processes/:name/window` to use `buildBgSpawnArgs` so the open-window path also stops mangling `launchCmd`/`workdir`; behavior otherwise unchanged (still 409 if the window exists)
- [x] Broadcast the existing bg/agents SSE update after a successful restart so the dashboard refreshes (follow how `POST /bg-processes/:name/window` triggers it, if it does; otherwise leave to the next poll and note it)
- [x] Update the `host-server/index.ts` route table in `CLAUDE.md`'s Core Scripts table and `scripts/README.md` if bg routes are listed there (one line for the new route)

<!-- Updated: 2026-09-20 -->
<!-- Step 3 note: no bg window route broadcasts SSE (bg-update is emitted only from the status poll-diff), so the restart route adds none; the dashboard refreshes on the next poll. Added startBgWindow (no marker) in bgRestart.ts shared by POST /bg-processes/:slug/window and POST /bg-processes; route is slug-keyed (:slug). Step 4 tests must also cover startBgWindow. -->

### 4. Tests  <!-- agent: general-purpose -->

- [x] Add `host-server/bgRestart.test.ts` (node:test, same style as `state.test.ts`) covering: argv for a `launchCmd` containing `"`, `$HOME`, backticks, and spaces in `workdir` is passed intact as single elements; ordered sequence with a stub `runTmux` recording calls; missing window takes the "start" path; marker written once on success and never on failure; the reattach never issues a bare toggling `pipe-pane -o` while a pipe may exist (per the spike finding); marker format matches `--- restart <ts> ---`
- [x] Run `cd host-server && npx tsc --noEmit && npm test` and fix failures; lint the new files with the repo's eslint config
  - Ran `npx tsc --noEmit` (clean) and only `node --import tsx/esm --test bgRestart.test.ts` (45/45 pass, hermetic stub deps) rather than the full `npm test`, which includes tests that touch real tmux. eslint: `bgRestart.ts` clean; `bgRestart.test.ts` shows only `no-floating-promises` on `describe`/`it`, identical to the existing `state.test.ts`/`bgOutput.test.ts` house style.

### 5. Live smoke  <!-- agent: general-purpose -->

- [x] [DEFERRED-TO-UAT] Record (do not run against the user's real processes without asking) a smoke recipe in this task: register a throwaway bg process via `POST /api/bg-processes` with a `launchCmd` that prints a counter, call `POST /api/bg-processes/<name>/restart`, `tail` the log to see the `--- restart ... ---` marker followed by fresh output, then delete the throwaway. Mark this step `[DEFERRED-TO-UAT]` so UAT owns the live check

  **Smoke recipe (for UAT; run only against an isolated stack — private tmux socket/conf/DB/host-server — never the live `dev` session or the real `dev`/`dev-stack` bg processes):**
  1. Create a throwaway project, then register a bg process in it: `POST /api/bg-processes` `{ "name": "smoke", "projectId": <id>, "workdir": "<dir with spaces>", "launchCmd": "i=0; while true; do i=$((i+1)); echo \"tick $i $HOME\"; sleep 1; done" }`. The slug is `<projectName>-smoke`.
  2. Wait ~3s, `GET /api/bg-processes/<slug>/tail?lines=20&format=text` shows `tick N`.
  3. `POST /api/bg-processes/<slug>/restart` returns `200 { ok: true, name: "<slug>", restartedAt, mechanism: "respawn-window" }`.
  4. `tail` again: the log contains a `--- restart <ISO-8601 UTC> ---` line followed by `tick 1 ...` (counter reset), with no `tick` lines from the old process after the marker; `$HOME` was echoed expanded by the shell at run time, not mangled by the server.
  5. Old process is gone (`ps` shows a single counter loop for the pane); `#{pane_pipe}` still reads `1`.
  6. Kill the window, `POST .../restart` again: `mechanism` is `new-window` and the marker precedes fresh output. With the tmux session absent it returns `409 { error: "session not running" }`; an unknown slug returns `404`.
  7. Delete the throwaway bg process and project.

## Dependencies

- Depends on: `TASK-0189` (mechanism and reattach sequence), `TASK-0188` (route/log/state identity).
- Blocks: `TASK-0193` (cooldown and audit wrap this operation), `TASK-0194` (same-project guard wraps this route).
- Parallel-safe with `TASK-0191` (liveness) and `TASK-0192` (output endpoint); expect a small merge overlap in `host-server/index.ts` bg routes, in disjoint regions.
