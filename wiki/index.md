---
title: Wiki Index
updated: 2026-08-15
---

# Wiki Index — Home Map

The page catalog and home Map of Content for this wiki. **Read this first on every query**, then drill into the linked pages. Updated on every ingest and every filed answer.

Conventions that govern every page (atomic pages, stable IDs, typed links, frontmatter namespace): see [conventions](conventions.md). Operation history: see [log](log.md).

Entry format: `- [Title](path) — one-line summary`.

The wiki is split into two domains with opposite organizing laws:
- **Knowledge** — timeless, link-navigated synthesis (sources, concepts, entities). Pages are listed individually below.
- **Work** — stateful, status-navigated lifecycle artifacts (requirements, decisions, roadmaps, tasks, uat, bugs). Items are **not** listed here — each family keeps its own `index.md` of active items; this page links to those.

---

## Knowledge

### Sources
- [Web Terminal Emulators — Full ANSI Color + Cursor Support](knowledge/sources/web-terminal-emulators.md) — xterm.js is the answer; two-change integration (backend `-e` flag + frontend xterm.js); critical split between display and detection capture paths
- [Application Latency Structure](knowledge/sources/application-latency-structure.md) — whole-stack latency assessment: synchronous tmux work, focused terminal WebSocket exclusivity, SSE vs WebSocket split, runtime knobs, and state simplification
- [Application Latency Observability Addendum](knowledge/sources/application-latency-observability-addendum.md) — observability plan for event-loop delay, tmux operation metrics, WebSocket latency, structured logs, and terminal debug traces
- [Claude Usage/Quota Signal Research](knowledge/sources/claude-usage-quota-signal.md) — no scriptable Claude Max/Pro subscription usage-limit signal exists today; `/usage` is interactive-only; root-caused the `USAGE_CHECK_CMD` bug
- [Terminal Text Wraps Early Instead of Filling the Component](knowledge/sources/terminal-width-early-wrap.md) — root-caused to the headless tmux session being stuck at `default-size 80x24`; capture-pane bakes the hard wrap in before xterm.js ever sees the text; fix is `window-size manual` + wide `default-size`, not frontend
- [Terminal Keyboard & Clipboard in Interact Mode](knowledge/sources/terminal-keyboard-clipboard.md) — `Cmd+V` is swallowed by xterm's own paste listener (`stopPropagation()` + `disableStdin` no-op); `mapKey()` discards Alt/Shift and drops all Meta; fixable frontend-only with `M-b`/`M-f`/`C-w`/`C-u`, all already allowlisted and verified against a live Claude Code input
- [AgentDetail Modal Redesign Research](knowledge/sources/agent-detail-modal-redesign.md) — terminal-first modal redesign: collapse the always-expanded Details+Queued-Tasks grid into the same `<details>` pattern used elsewhere, default Direct Input on open, double-click terminal to reuse the existing ⌥F fullscreen toggle
- [Ensuring the Dashboard's Context-Window Percentage Is Always Correct](knowledge/sources/context-window-accuracy.md) — Sonnet 5 is 1M tokens unconditionally, not 200k; root-caused to `context.ts`'s family-substring `modelContextLimit()`; no live API exists to query context-window size
- [Stop Hook Payload, Sub-Agent Detection, and a Sentinel-File Design for BUG-0001](knowledge/sources/stop-hook-subagent-detection.md) — Stop's payload has no outstanding-work signal; Claude Code's v2.1.198 background agents legitimately end the turn while work continues, resumed via new `Notification` subtypes `agent_needs_input`/`agent_completed`
- [Agent Status Notification Banners Research](knowledge/sources/agent-status-notifications.md) — `awaiting`/`empty` statuses already labeled "waiting"/"no tasks"; reuses the existing `prevStatusRef` SSE transition tracking and `armInteract`/`interactSignal` modal-focus mechanism; no toast library needed

### Concepts
- [ANSI Terminal Emulation in the Browser](knowledge/concepts/ansi-terminal-emulation-browser.md) — why `<pre>` falls short; stateful terminal emulator model; xterm-256color + truecolor support
- [tmux capture-pane and Escape Sequences](knowledge/concepts/tmux-capture-pane-escape-sequences.md) — `-e` flag for display path only; detection path must stay plain-text
- [Dashboard Live-Update Performance Budgets](knowledge/concepts/dashboard-live-update-performance-budgets.md) — budget targets for dashboard loops, capture calls, SSE connections, and future event-loop/WebSocket metrics
- [Dashboard Performance Benchmarking](knowledge/concepts/dashboard-performance-benchmarking.md) — repeatable commands and comparison criteria for dashboard live-update, SSE, WebSocket, and terminal latency
- [Focused Terminal Transport](knowledge/concepts/focused-terminal-transport.md) — WebSocket should exclusively own focused terminal input/output while SSE remains global state and fallback
- [Agent State Determination](knowledge/concepts/agent-state-determination.md) — backend status contract proposal with status reason, age, evidence, and transition observability
- [Local Observability](knowledge/concepts/local-observability.md) — local-first metrics/logging plan for event-loop delay, tmux operations, WebSocket latency, and diagnostic bundles
- [Claude Subscription Usage-Signal Gap](knowledge/concepts/claude-subscription-usage-signal-gap.md) — no scriptable signal for Max/Pro subscription usage exists; API rate-limit headers ≠ subscription quota; `/usage` is interactive/local-estimate only
- [tmux Headless Window Sizing](knowledge/concepts/tmux-headless-window-sizing.md) — unattached tmux windows are governed by `window-size`/`default-size`, not by any browser-side viewer; tmux-conductor never sets either, so windows sit at the 80×24 factory default
- [Browser Terminal Input Capture](knowledge/concepts/browser-terminal-input-capture.md) — read-only xterm mirror + external key capture: bind clipboard events in the capture phase, and keep focus off `.xterm-helper-textarea` or xterm swallows keydown too
- [tmux send-keys Key Names](knowledge/concepts/tmux-send-keys-key-names.md) — measured byte sequences per key name on tmux 3.6a, and the hazard that unknown names are typed into the pane literally rather than rejected — so the allowlist must stay an explicit enumeration
- [Claude Model Context-Window Sizing Is Unqueryable and Drifts Fast](knowledge/concepts/claude-model-context-window-sizing.md) — no API exposes context-window size; a hand-maintained exact-model-ID table is the only source, and staleness should fail visibly (unconfirmed-limit state) not silently (clamped 100%)
- [Pane-Idle Detection Cannot See Async Background Agent Work](knowledge/concepts/idle-detection-vs-async-background-work.md) — Claude Code's background agents can legitimately end a turn while work continues; a fixed grace period doesn't close the false-idle window for long-running work, only an event-driven sentinel does

### Entities
- People — [knowledge/entities/people/](knowledge/entities/people/)
- Organisations — [knowledge/entities/organisations/](knowledge/entities/organisations/)
- Tools:
  - [xterm.js](knowledge/entities/tools/xterm-js.md) — `@xterm/xterm` v6; VS Code's terminal engine; full VT100/xterm-256color; `convertEol`/`disableStdin` for tmux read-only display; intercepts paste/copy/keydown even when read-only
  - [hterm](knowledge/entities/tools/hterm.md) — Google's HTML Terminal; stale (2020); not on npm; not recommended
  - [Fastify](knowledge/entities/tools/fastify.md) — host-server HTTP framework; structured request logging and WebSocket route context
  - [React](knowledge/entities/tools/react.md) — dashboard UI framework; Strict Mode effect cleanup matters for terminal focus and transport stability
  - [Vite](knowledge/entities/tools/vite.md) — frontend dev server/proxy; focused terminal WebSocket needs explicit proxy support
  - [Node.js](knowledge/entities/tools/node-js.md) — host-server runtime; event-loop delay/utilization should expose synchronous tmux blocking
  - [Claude Code CLI](knowledge/entities/tools/claude-code-cli.md) — agent CLI; no `usage` subcommand exists; `/usage` slash command is interactive-only and self-described as a local estimate
- Components:
  - [LogTail](knowledge/entities/components/log-tail.md) — `frontend/src/components/LogTail.tsx`; xterm.js terminal renderer with focused WebSocket input/output and SSE fallback considerations
  - [Host Server](knowledge/entities/components/host-server.md) — Fastify backend owning API, SSE, focused terminal WebSocket, SQLite, tmux operations, and live-update loops
  - [AgentDetailModal](knowledge/entities/components/agent-detail-modal.md) — full-viewport agent detail overlay in `AgentList.tsx`; owns `logExpanded`/Direct-Input-arming state; only render call site for `LogTail`
  - [Claude Code Hooks](knowledge/entities/components/claude-code-hooks.md) — per-event Node.js hooks writing idle/busy state; `write-state.js` ignores `agent_id`/`agent_type`; a `Notification` hook existed briefly in April 2026 and was removed before background-agent notification support existed

---

## Work

Each family's `index.md` lists its **active items only** (completed/terminal items drop off the list; files never move — status lives in frontmatter).

- **Requirements** — REQ-NNN. [Active index](work/requirements/index.md) · [lifecycle](work/requirements/lifecycle.md)
- **Decisions** — DEC-NNNN (per-decision `#DM`). [Active index](work/decisions/index.md) · [lifecycle](work/decisions/lifecycle.md)
- **Roadmaps** — ROADMAP-NNN. [Active index](work/roadmaps/index.md) · [lifecycle](work/roadmaps/lifecycle.md)
- **Tasks** — TASK-NNN. [Active index](work/tasks/index.md) · [lifecycle](work/tasks/lifecycle.md)
- **UAT** — UAT-NNN, one per task. [Active index](work/uat/index.md) · [lifecycle](work/uat/lifecycle.md)
- **Bugs** — BUG-NNNN. [Active index](work/bugs/index.md) · [lifecycle](work/bugs/lifecycle.md)
