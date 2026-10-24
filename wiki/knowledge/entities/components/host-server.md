---
id: host-server
title: Host Server
aliases: [host-server, host-server/index.ts]
updated: 2026-09-20
sources:
  - ../../../raw/research/project-file-tree/index.md
  - ../../../raw/research/worktree-on-any-agent/index.md
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
  - ../../../raw/research/context-window-accuracy/index.md
  - ../../../raw/research/transition-observability/index.md
  - ../../../raw/research/shared-dev-commands/index.md
  - ../../../raw/research/shared-dev-commands/index-2.md
  - ../../../raw/research/remote-tunnel-access/index.md
  - ../../../raw/research/orchestrator-agent-routing/index.md
  - ../../../raw/research/dispatch-clear-first-enter-race/index.md
  - ../../../raw/research/inactive-agent-shows-other-agents-window/index.md
  - ../../../raw/research/bg-process-agent-access/index.md
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
  - ../../../raw/research/orchestrator-role-fleet-control/index.md
tags: [backend, component, fastify, tmux]
---

# Host Server

`host-server/` is the local Fastify backend for tmux-conductor. It owns the dashboard API, SSE live-update stream, focused terminal WebSocket route, SQLite data access, tmux capture/input calls, and periodic status/tail/schedule/context loops.

The latency research identifies this component as the main optimization boundary because synchronous tmux subprocesses share the Node event loop with HTTP, SSE, and WebSocket traffic. The host server already exposes `/api/perf/live-updates`, but should add event-loop delay/utilization, tmux operation-level metrics, WebSocket lifecycle metrics, and structured request logs to make terminal stalls diagnosable.

For agent status, the host-server owns the detection contract. `/api/status` and `agent-update` SSE payloads include the legacy `state` plus a structured `status` object with display state, reason, needs-attention flag, active task, and evidence from tmux liveness and state files. Frontend components should render from that object instead of recreating detection semantics.

`context.ts`'s `modelContextLimit()` is a known-stale, family-substring model→context-window map (only special-cases `"opus"` → 1M) — it currently misclassifies Sonnet 5 as 200k when it is actually 1M. See `relates_to::[[context-window-accuracy]]` for the root cause and recommended exact-model-ID fix.

`detectAgentStatus()` (`state.ts`) internally branches on state-file value/age vs. busy/idle/awaiting pattern matches using an already-captured pane tail, but returns only the final state string to its callers — the reason and matched pattern are computed and discarded, not logged anywhere. `pollAndDiff`'s `status_transition` observability event is correspondingly thin. See [[Observability for Agent Status Transitions]] for the proposed fix (widen the return type, add a dedicated `transitions.jsonl` reusing the tail already captured in `buildSnapshot`).

`index.ts`'s `TMUX_KEY_RE` allowlist gates every key name the dashboard's Direct Input mode may forward via `/agents/:agent/keys` (`send-keys` positional args). It permits bare arrows and `C-[a-z]`/`M-[A-Za-z]`, but has no alternative for a modifier combined with an arrow/Home/End key (`C-Left`, `M-Left`, etc.) — which, together with `LogTail.tsx`'s `mapKey()` never constructing those names, is why Cmd+Arrow/Ctrl+Arrow do nothing in the terminal today. See [[terminal-modifier-arrow-navigation]] and [[tmux-send-keys-key-names]].

The host-server's `POST/DELETE /api/bg-processes` routes (`index.ts`) read/write background-process definitions in `conductor.conf`'s `BG_PROCESSES` bash array — but `scripts/lib/db.sh`'s `load_bg()`, used by `conductor.sh`/`spawn.sh`/`monitor.sh` to actually spawn and liveness-check bg processes, reads the SQLite `bg_processes` table instead. The two stores are unsynced (a split-brain bug), and `db.ts`'s `createBgProcess`/`listBgProcesses`/`deleteBgProcess` are fully implemented but have zero callers as a result. The same split covers the bg↔agent link too: `scripts/lib/db.sh`'s `load_agents()` already resolves it from SQLite (`bg_processes.linked_agent_id`) to drive `CONDUCTOR_BG_NAME`/`LOG`/`STATE` env injection, while `index.ts` still writes/removes the link in `conductor.conf`'s `AGENT_BG_LINKS` array via `config.ts`'s `addBgLink`/`removeBgLink` — a dashboard-created link is therefore silently inert today. See [[Background Process Registry (bg_processes) — Mechanism and Gaps]] for the full mechanism and the recommended fix (SQLite as sole source of truth + `project_id` scoping); a task implementing just the split-brain fix is scoped in `raw/research/shared-dev-commands/index-2.md`.

`host-server` binds to `127.0.0.1` by default (`HOST` env, `index.ts:2580`) and has **no authentication anywhere in the codebase** — an exhaustive search for auth/token/API-key checks across `host-server/*.ts` returns nothing. This is deliberate (`CLAUDE.md`: "fully local and single-user... no auth"), not a gap, but it means the raw `GET /agents/:id/terminal/ws` WebSocket (`index.ts:1565`) and `POST /agents/:agent/keys` together are equivalent to an unauthenticated web shell for anyone who can reach the port — the trust boundary for any remote-access design has to live in the network layer (a private mesh VPN, or a tunnel plus a mandatory identity gate in front), never by assuming `host-server` will grow its own auth. See [[remote-tunnel-access]] and [[Remote Access Security Model]].

Task routing is purely rule-based today: `db.ts::popTask` (and its bash mirror `pop_task_sql` in `scripts/lib/db.sh`) selects the next queued row by fixed SQL precedence — scoped-to-this-agent rows first, then global rows — with no content or capability matching, and `index.ts::dispatchTaskToAgent` is pure mechanics (checkpoint, state write, dispatch log, `send-keys`) once a row is popped. Which agent a task targets is decided entirely by a human/script at insert time (`scripts/add-task.sh`'s CWD-derived scoping, or the dashboard's `AddTaskForm.tsx`), never by an agent at dispatch time. See `relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]` for the recommended path to a capability-aware router (a declared `tags` column plus a precedence tier, escalating to an LLM-driven host-server job — never a new tmux pane — only for tasks a tag match can't place) and `derived_from::[[An Orchestrator Agent That Routes Commands/Tasks to Other Agents|../../sources/orchestrator-agent-routing.md]]` for the full analysis.

**Orchestrator-readiness gaps (2026-09-19, [[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]):** the queue claim is sound under concurrency (single atomic `UPDATE … RETURNING`, WAL, `busy_timeout=5000` here and `.timeout 5000` in `scripts/lib/db.sh`), and `startManagedLoop` (e.g. the `schedule poll` loop) is the existing pattern an orchestrator job would follow. But `popTask` flips `status='done'` at dispatch, `dispatchTaskToAgent` takes command text only (so `dispatch.jsonl` has no task id), `tasks` has no attempt/lease/result/role/dependency columns, `git.ts` has no merge function, and `package.json` has no Anthropic/Agent SDK dependency. `pollAndDiff` and the bash `monitor.sh` (which `healMonitorWindow` re-launches) are two dispatchers, and the BUG-0001 sentinel is checked only on the host-server's two call sites. See [[Task Lifecycle and Completion Semantics for an Agent Queue]], [[Dispatch-Path Parity (Two Dispatchers, One Gate)]] and [[LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)]].

The `agents.worktreePath` field and `dispatchTaskToAgent`'s pre-dispatch `stashCheckpoint` call are already the two primitives a fuller **ephemeral worker-per-task** orchestration model would need — see `relates_to::[[Ephemeral Worker-Per-Task Coding Agent Orchestration]]` (2026-09-13). Today they're used to isolate a persistent, long-lived agent; that research recommends sequencing them into a provision→run→merge→teardown flow for tasks with no suitable existing agent, rather than building new isolation machinery.

An agent's `launch_cmd` is a required string **frozen at creation time** in `db.ts::createAgent` — it is never re-derived from its project afterward. `projects.default_launch_cmd` is only a copy-on-create template: `POST /projects/:id/agents` resolves `launchCmdOverride ?? project.defaultLaunchCmd` once at that moment (`index.ts:2116`), so editing a project's default later never reaches agents already created under it. There are **two independent code paths** that turn a stored launch command into a live tmux pane — `scripts/conductor.sh`/`spawn.sh`'s `AGENT_CMDS` (bash, batch startup) and `index.ts`'s live single-agent spawn function for the dashboard's "Add Agent" flow (~257-273) — and both just interpolate the stored string verbatim via `tmux send-keys`, with no transformation. Both also already gate on `detectAgentType(launchCmd): 'claude' | 'codex' | 'custom'` (`state.ts:251-256`, mirrored in bash by `scripts/monitor.sh`'s `launch_cmd_name()`) for idle/busy pattern selection — the same detector that would need to gate any future flag injection (e.g. `--append-system-prompt-file`) so it never corrupts a Codex/custom agent's command. See `relates_to::[[claude-code-instruction-placement]]` and `derived_from::[[reaching other-project agents via launch_cmd storage|../../../raw/research/subagent-panel-visibility/index-4.md]]`.

`state.ts::sendTextToPane` (the sole function dispatching a queued task's command into a tmux pane) sends literal text then `Enter` via two synchronous `spawnSync` calls with **zero delay** between them — unlike `scripts/dispatch.sh`'s equivalent, which has an explicit `sleep 0.3` to "let the UI render before submitting." `index.ts::dispatchTaskToAgent`'s `opts.clearFirst` (set only for project-scoped tasks, `task.kind === 'project'`) chains two such sends back-to-back with no gap either, confirmed live via `logs/dispatch.jsonl` to produce an unsubmitted, concatenated `/clear` + command line at the prompt. `sendDirectInput` independently added the same delay, but only for its multiline paste-buffer path. See [[tmux-send-keys-render-delay-race]] for the full mechanism and fix recommendation.

**Fixed by TASK-0185:** `sendTextToPane` is now async with a 300ms gap (env `DISPATCH_SUBMIT_DELAY_MS`) between the literal-text send and `Enter`; the new exported `sendDispatchToPane` chains `/clear` → Enter → 1000ms settle (env `DISPATCH_POST_CLEAR_DELAY_MS`) → task text → 300ms → Enter; and `dispatchTaskToAgent` is async (the `pollAndDiff` caller fires it and forgets with a `.catch` logger, while the `POST /tasks` immediate-enqueue path awaits it and returns 500 `{error:'dispatch failed'}` on failure). The "zero delay" description above is the pre-fix state.

Every tmux call in `state.ts` and `index.ts` (capture-pane, display-message, send-keys, kill-window, rename-window, pipe-pane, and the `isTmuxWindowPresent` guard's `has-session`) targets `${sessionName}:${windowName}`, which tmux **prefix-matches** — so an agent whose window is gone but whose window name is a prefix of a live one (e.g. `…-3` vs a running clone `…-3-copy`) reads and writes the clone's pane. Only the inventory-based status path (`readTmuxWindowInventory` → exact `Map` lookup) is immune, which is why the dashboard shows NO WINDOW next to a live terminal. Fix: one `windowTarget()` helper emitting `session:=window`. See `derived_from::[[inactive-agent-shows-other-agents-window]]` and [[tmux-window-target-prefix-matching]].

The bg-process routes as of 2026-09-19 (after ROADMAP-020) are `POST /bg-processes`, `PATCH`/`DELETE /bg-processes/:slug`, `POST`/`DELETE /bg-processes/:slug/window` (open/close a tmux window; since 2026-09-20 the `:slug` param is the derived `<projectName>-<name>` identity, see [[background-process-registry]] "Name uniqueness") and `GET /projects/:id/bg-processes`, all DB-backed. There is **no restart route**: `POST …/window` returns 409 when the window already exists, and it sends `launchCmd` via `send-keys "${launchCmd}"` inside literal double quotes, so `"`/`$` in a launch command are mangled or expanded. `BgStatus.windowPresent` and the monitor's `alive`/`dead` state both mean only "the window exists", not "the process is running". See `derived_from::[[bg-process-agent-access]]`.

**Worktree routes (2026-09-20, [[worktree-on-any-agent]]):** `POST /agents/:id/worktree` (`addWorktreeToAgent` in `db.ts`) retroactively adds an opt-in worktree — 404 unknown agent, **409 if the agent already has one**, 400 for a non-git workdir, 201 `{ok, agent}` — and deliberately broadcasts no SSE (a partial `{worktreePath, branch}` `agent-update` would be misread as a status change), so other clients see it on the next status poll. `POST /agents/:id/clone` forwards `useWorktree: Boolean(source.worktreePath)`, so cloning a worktree-less agent yields two agents on one working tree, and its `agent-update` payload omits `worktreePath`/`branch`. Path and branch are pure functions of the agent id (`<repo>-worktrees/<id>`, `conductor/<id>`), so an agent cannot hold a second worktree. See [[agent-worktree-lifecycle]].

**File-listing and CORS notes (2026-09-20, [[project-file-tree]]):** there is no route that lists an agent's *files*. `GET /browse?path=` returns one level of directories only (dot-names skipped) for any absolute or `~` path with no root restriction, and `GET /agents/:id/diff` (root = `worktreePath || workdir`, `isGitRepo` short-circuit, `spawnSync git -C`, 500 KB cap with `truncated`) is the pattern a `GET /agents/:id/files` route should copy, sourcing paths from `git ls-files -co --exclude-standard` — see [[git-index-file-listing]]. CORS is `process.env.CORS_ORIGIN || '*'` alongside the loopback bind, so any web page open in the user's browser can read the server's responses; that is why file *contents* must not be served until CORS is restricted — see [[local-server-cors-wildcard-exposure]]. (The `HOST` default noted above now sits near `index.ts:2846`, not `:2580` — line numbers in this page drift.)

**Agent roles and the orchestrator-role gap (2026-09-20, [[An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes]]):** `agents.role` is a CHECK-constrained 7-value enum (schema v7; currently v10), mirrored by `rolePresets.ts::ROLE_VALUES`, `role-presets.json`, and the migration test fixtures — all four must change together, and widening the CHECK means an `agents` table rebuild on the v8 `tasks_v8` pattern. A role only changes behaviour for agents with a **worktree**: `applyRoleFragmentToWorktree` is called solely from the two worktree-creation paths in `db.ts`, so a non-worktree agent's role is a label. The spawn command exports only `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` (`index.ts:299`) — no agent id, no role. Nearly every control verb an orchestrator needs (`POST /agents`, `POST`/`DELETE /agents/:id/window`, `POST /tasks`, bg window open/close and tail) is already a route; the only missing one is bg restart (ROADMAP-0024). See [[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]] for why a role here is a grant plus guardrails plus audit, not a permission wall.

> **Contradiction:** the ADR-0006 primitive table records role→behaviour injection as existing; per the code it exists only for worktree agents (see the note above).

uses::[[Fastify]]
relates_to::[[An `orchestrator` Agent Role That Manages tmux-Window Agents and Background Processes]]
relates_to::[[Agent Role as Capability Grant, Not Permission Wall (No-Auth Trust Model)]]
relates_to::[[git-index-file-listing]]
relates_to::[[local-server-cors-wildcard-exposure]]
relates_to::[[project-file-tree]]
relates_to::[[agent-worktree-lifecycle]]
relates_to::[[Focused Terminal Transport]]
relates_to::[[Local Observability]]
relates_to::[[Agent State Determination]]
relates_to::[[context-window-accuracy]]
relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[Background Process Registry (bg_processes) — Mechanism and Gaps]]
relates_to::[[terminal-modifier-arrow-navigation]]
relates_to::[[tmux-send-keys-key-names]]
relates_to::[[remote-tunnel-access]]
relates_to::[[Remote Access Security Model]]
relates_to::[[claude-code-instruction-placement]]
relates_to::[[Multi-Agent Orchestration Patterns (Orchestrator-Worker, Supervisor, Handoff)]]
relates_to::[[tmux-send-keys-render-delay-race]]
relates_to::[[tmux-window-target-prefix-matching]]
