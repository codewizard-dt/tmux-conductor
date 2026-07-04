---
topic: "$research perform a full assessment of the overall structure of this application from the lens of performance optimization. Look for any and all ways to reduce latency across the entire stack. Consider subtle changes as well as drastic changes. Particular things of note: the UI is a little unstable and the UX is inconsistent. The 'terminal' sometimes stops accepting input entirely, or appears to, but if you close and reopen the modal the input is there. Consider websocket vs sse vs polling. Consider changes/simplifications to 'agent state' determination. Also consider runtime variables/effects/setup"
slug: application-latency-structure
researched: 2026-07-04
sources: [./sources.md]
---

# Research: Application Latency Structure

> The primary latency risk is still structural: synchronous tmux capture and synchronous tmux input commands share the host-server event loop with HTTP, SSE, and WebSocket handling. The current code has improved over prior reports by adding shared EventSource plumbing, metrics, xterm.js, and a focused terminal WebSocket, but the WebSocket path currently runs beside the focused SSE path and can double the expensive 500-line raw capture loop. Recommended direction: keep SSE for global dashboard state, make WebSocket the single owner of focused terminal input/output when connected, remove duplicate focused SSE registration, make runtime polling/capture values configurable, and simplify agent state determination into a single cached status engine with explicit evidence and age fields.

## Research Questions

- Where does latency accumulate across the current stack: React UI, live transport, host-server loops, tmux capture/input, SQLite, and runtime configuration?
- Why can the terminal appear to stop accepting input until the modal is reopened?
- Which live-update transport should own each data flow: SSE, WebSocket, or polling?
- How can agent state determination be simplified without losing Claude/Codex/custom compatibility?
- Which runtime variables, React effects, and setup defaults make latency or instability worse?

## Current State (Codebase)

The app is a local single-user system: Fastify host-server on port 8788, Vite React SPA on port 4321, SQLite via `better-sqlite3`, and tmux as the process/runtime substrate [S1].

The backend has performance instrumentation around status ticks, terminal ticks, focused terminal ticks, tmux capture calls, SSE broadcasts, and tail requests. Static performance checks passed during this research via `npm --prefix host-server run perf:test` [S2, S24].

The backend still performs tmux reads and writes with synchronous child processes. `capturePaneTail`, `capturePaneTailRaw`, `readTmuxWindowInventory`, `sendDirectInput`, mode switching, session start, and other hot/control paths use `spawnSync` or `execSync`; Node documents that these synchronous child-process methods block the event loop [S3, S18].

Terminal display now uses xterm.js and raw ANSI tmux capture. `capturePaneTailRaw` calls `tmux capture-pane -p -e -S -N` and then `tmux display-message` to mirror cursor position, so each focused raw snapshot can involve two synchronous tmux calls [S4].

Global dashboard state uses SSE via `/api/events`. The frontend has a shared module-level EventSource hook, and the static guard confirms direct `new EventSource` construction is only allowed in that hook [S5, S24].

Focused terminal behavior currently uses both a focused WebSocket and a focused SSE subscription. `LogTail` opens `/agents/:id/terminal/ws` when focused, sends direct input over that socket when open, and also subscribes to `terminal-output-focus` while focused [S6]. On the server, WebSocket connect adds the agent to `focusedAgents`, starts its own 200 ms `setInterval(sendSnapshot)`, and `tailPollLoopFocus` also captures all `focusedAgents` every 200 ms and broadcasts focused SSE [S7]. This means an open focused modal can cause two independent 500-line raw capture loops for the same pane: one WebSocket timer and one global focused SSE loop [S6, S7].

The Vite dev proxy still uses string shorthand for `/api`, while Vite documents WebSocket proxying with an object target and `ws: true` [S8, S16]. If the browser opens the dashboard through Vite and `API_BASE` is `/api`, the WebSocket URL resolves through the dev server, so proxy setup is part of runtime reliability [S6, S8].

React runs under `React.StrictMode` in `frontend/src/main.tsx`. React documents an extra development-only setup-cleanup-setup cycle for effects to verify cleanup correctness [S9, S17]. `LogTail` has effects that fetch initial tail state, create/dispose an xterm instance, POST/DELETE focus state, open/close a WebSocket, subscribe to SSE, and manage DOM focus [S6]. These effects must be idempotent; otherwise development can show duplicate setup/cleanup churn that looks like flaky terminal focus or dropped transport.

Runtime configuration is partly hardcoded and partly env-driven. Host and frontend ports come from env, but live-update intervals and depths are hardcoded in `host-server/index.ts`: status 2000 ms, tail 2000 ms, focused tail 200 ms, context refresh 10000 ms, 100 unfocused lines, and 500 focused lines [S7, S10]. `conductor.conf` owns `POLL_INTERVAL=15`, `STALL_TIMEOUT=300`, detection regexes, and context window, but those values do not drive dashboard live-update cadence [S10].

Agent state determination is spread across hook state files, tmux window inventory, pane-current-command liveness, plain capture regexes, POSIX grep subprocesses, context extraction, label extraction, active-task extraction, and derived UI statuses [S11, S12]. This gives robust fallback coverage but also creates latency and inconsistency risks because status classification can spawn capture and grep subprocesses during the 2s status loop [S11].

Prior research already concluded that SSE is right for one-way dashboard state, WebSocket is useful for focused terminal interaction, and representative live SSE-vs-WebSocket latency numbers were not captured [S13, S14].

## Key Findings

### F1 - WebSocket currently risks duplicating the focused terminal hot path

The intended architecture was "SSE for dashboard state, WebSocket for focused terminal." The current implementation does not fully enforce that split. Focused `LogTail` consumes WebSocket output and focused SSE output, while the server WebSocket and `tailPollLoopFocus` each perform raw 500-line captures on 200 ms intervals [S6, S7]. This can increase latency rather than reduce it.

### F2 - The apparent input freeze is plausibly event-loop blocking plus UI transport ambiguity

Input dispatch over WebSocket still calls `sendDirectInput`, which uses synchronous `tmux send-keys` calls [S3, S6]. At the same time, focused output can trigger duplicate synchronous raw captures [S4, S7]. Because Node synchronous child processes block the event loop [S18], HTTP/WebSocket input acks and output updates can be delayed enough that the UI appears to stop accepting input. Closing and reopening the modal forces a fresh `/tail` fetch, xterm instance, WebSocket connection, focus registration, and snapshot, which explains why already-sent input may suddenly appear [S6].

### F3 - SSE remains the right transport for global dashboard state

MDN describes EventSource/SSE as unidirectional server-to-client delivery, and web.dev notes SSE includes automatic reconnection/event features and a single unidirectional channel [S19, S20]. That matches session, agent, task, schedule, and background-process updates. Replacing all `/events` traffic with WebSocket would add reconnect/resync protocol work without addressing the tmux capture bottleneck.

### F4 - WebSocket is still right for the focused terminal, but only as an exclusive focused channel

MDN describes WebSocket as a two-way interactive browser/server session without polling [S21]. That matches terminal keystrokes plus terminal output better than REST input plus SSE output. However, MDN also notes the classic WebSocket API has no backpressure [S22], so the app should avoid flooding full snapshots and should check `bufferedAmount` or drop/coalesce stale output frames before sending.

### F5 - Polling is still necessary at the tmux boundary, but the current polling model is too broad

Tmux does not currently provide an event stream into this app. Some polling remains necessary unless the architecture changes to a real PTY/log tap. But a single focused terminal owner should poll, and global state should poll coarse status only. The current hardcoded 200 ms focused interval and 500-line snapshot depth should be runtime-tunable and adaptive [S7, S10].

### F6 - React Strict Mode makes effect idempotency a runtime requirement, not a nicety

React Strict Mode runs an extra setup-cleanup-setup cycle for effects in development [S17]. `LogTail` currently has multiple transport and focus effects. The `pendingDeletes` workaround reduces POST/DELETE focus thrash, but WebSocket creation, xterm focus/blur, and SSE fallback subscription can still produce visible instability if setup/cleanup order races with live updates [S6, S9].

### F7 - Agent state determination should move from scattered derivation to a single status snapshot contract

The backend already centralizes the status loop in `buildSnapshot`, but status evidence is still implicit. The UI receives `state`, `mode`, `activeTask`, `label`, and context fields, then derives badges locally [S11, S12]. A simpler contract would return `{status, statusReason, statusEvidence, statusAgeMs, needsAttention}` from one backend status engine. This would reduce duplicated UI interpretation and make "awaiting", "stalled", "idle-waiting", and "empty" consistent.

### F8 - Runtime setup has avoidable latency traps

`host-server/config.ts` logs `confPath` at module load, parses config by shelling out to `bash -c "source ..."`, caches for 5s, and uses env timeouts for config/tmux operations [S10]. This is acceptable off the hot path, but any repeated config read inside fast loops is still extra work. More importantly, live-update constants are not controlled by `.env` or `conductor.conf`, so tuning requires code edits instead of environment-specific runtime adjustment [S7, S10].

## Constraints

- The system is local-first and single-user; simplicity matters more than a distributed realtime protocol [S1].
- Tmux is the true terminal substrate. Without a PTY/log-stream redesign, the backend must still poll or capture tmux state.
- Plain capture for state regexes and raw ANSI capture for xterm display must remain separate [S4, S11, S15].
- `better-sqlite3` is synchronous, but current evidence points more strongly to tmux capture/input than DB query cost. DB optimization should follow profiling, not precede tmux fixes.
- Prior raw research is immutable; this report builds on it rather than replacing it [S13, S14, S15].
- This session did not capture a representative live focused-agent latency benchmark. The available static guardrails passed [S24].

## Solution Comparison

| Criteria | Optimize Current Split | Exclusive Focused WebSocket | Event-Driven PTY/Log Tap | Full WebSocket App Protocol |
|---|---|---|---|---|
| Approach | Keep SSE for state, remove duplicate focused capture, tune polling, simplify effects. | Make focused WS the only focused terminal output/input path; SSE only fallback when WS unavailable. | Replace tmux snapshot polling for terminal output with an append-only PTY/log stream or tmux pipe-pane feed. | Replace all SSE/state events with a custom WebSocket protocol. |
| Pros | Low risk; targets known duplication; no major architecture rewrite. | Best near-term UX for input/output ordering; reduces REST+SSE mismatch. | Biggest latency win; avoids repeated full snapshots; closer to a real terminal. | One connection and one protocol. |
| Cons | Still polls tmux; still full-snapshot oriented. | Still polls unless paired with capture redesign; needs reconnect/backfill logic. | Drastic; more lifecycle complexity; may need per-pane pipe management and ANSI byte buffering. | High complexity; must rebuild EventSource reconnect/resync behavior; does not by itself fix capture cost. |
| Complexity | Low/Medium | Medium | High | High |
| Dependencies | None beyond current deps | Current `@fastify/websocket` and xterm.js | Possibly none, but significant tmux/PTY plumbing | Current `@fastify/websocket` |
| Codebase fit | Strong | Strong for terminal modal | Medium; bigger than current local dashboard design | Weak for current needs |
| Maintenance | Low | Medium | Medium/High | High |

## Recommendation

Recommended sequence:

1. **Make focused WebSocket exclusive when connected.** In `LogTail`, do not subscribe to `terminal-output-focus` while a WebSocket is active. On the server, distinguish WebSocket-focused agents from SSE-focused agents or remove POST `/focus` when the WebSocket is connected. The focused pane should have one owner and one capture loop.

2. **Fix Vite WebSocket proxy setup.** Change `frontend/vite.config.ts` from string shorthand to an object proxy with `target`, `ws: true`, and `changeOrigin` as appropriate. This makes `/api/.../terminal/ws` reliable in dev when `API_BASE` is `/api`.

3. **Coalesce focused WebSocket output.** Before `socket.send`, check whether the socket is open and whether `bufferedAmount` is already high. Drop intermediate snapshots and send only the latest. Full snapshots are idempotent enough to coalesce.

4. **Convert the highest-frequency tmux operations from sync to async or serialize them through a worker.** The first target is focused raw capture and direct input. Even if tmux itself remains a subprocess, moving from `spawnSync` to `spawn`/`execFile` with per-agent serialization prevents one capture from blocking unrelated HTTP/WebSocket work on the Node event loop.

5. **Make live-update runtime knobs configurable.** Add env/config values for `TAIL_POLL_MS`, `TAIL_POLL_FOCUS_MS`, `TAIL_LINES`, `TAIL_LINES_FOCUS`, and maybe `CONTEXT_REFRESH_MS`. Defaults can stay current, but local machines and large panes need tuning without code changes.

6. **Simplify agent state into a backend-owned status contract.** Return `status`, `statusReason`, `statusAgeMs`, `needsAttention`, and optionally `statusEvidence` from `buildSnapshot`. Move UI-only states such as `idle-waiting` and `empty` into the backend or rename them clearly as display labels. Cache regex/profile results within a tick and avoid extra grep subprocesses when state file and pane command are decisive.

7. **Stabilize `LogTail` effects.** Treat terminal setup as a small state machine: `loading -> ready -> ws-connected/ws-fallback -> disposed`. Keep focus ownership in one ref, avoid xterm focus/blur stealing prior focus unless necessary, and ensure Strict Mode setup-cleanup cycles leave no open socket, timer, pending focus delete, or stale callback.

8. **Run real latency measurements after the first two fixes.** Use the existing metrics endpoint plus a focused-agent scenario. Capture active SSE connections, WebSocket connection state, focused raw capture count, focused tick max duration, WebSocket send/ack latency, and observed input echo latency.

Drastic option if latency remains poor: replace focused terminal polling with a per-agent `tmux pipe-pane` or PTY-backed output stream and use xterm.js as a real terminal renderer fed by appended bytes. That would eliminate repeated 500-line full snapshots and cursor-reconstruction hacks, but it is a larger lifecycle project.

## Next Steps

- To create a task: `/task-add Make focused terminal WebSocket the exclusive focused output/input path and remove duplicate focused SSE capture`
- To create a task: `/task-add Add configurable dashboard live-update runtime knobs for tail intervals, capture depths, and context refresh`
- To create a task: `/task-add Simplify backend agent state into a single status snapshot contract with status reason and age`
- To create a decision: `/decision-create Keep SSE for global dashboard state, make WebSocket exclusive for focused terminal, and defer full WebSocket app protocol`
- After implementation, run `HOST_URL=http://localhost:8788/api DURATION_SECONDS=30 bash scripts/measure-dashboard-performance.sh` with a live focused modal and record the results.
