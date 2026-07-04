---
title: Wiki Index
updated: 2026-07-04
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

### Concepts
- [ANSI Terminal Emulation in the Browser](knowledge/concepts/ansi-terminal-emulation-browser.md) — why `<pre>` falls short; stateful terminal emulator model; xterm-256color + truecolor support
- [tmux capture-pane and Escape Sequences](knowledge/concepts/tmux-capture-pane-escape-sequences.md) — `-e` flag for display path only; detection path must stay plain-text
- [Dashboard Live-Update Performance Budgets](knowledge/concepts/dashboard-live-update-performance-budgets.md) — budget targets for dashboard loops, capture calls, SSE connections, and future event-loop/WebSocket metrics
- [Dashboard Performance Benchmarking](knowledge/concepts/dashboard-performance-benchmarking.md) — repeatable commands and comparison criteria for dashboard live-update, SSE, WebSocket, and terminal latency
- [Focused Terminal Transport](knowledge/concepts/focused-terminal-transport.md) — WebSocket should exclusively own focused terminal input/output while SSE remains global state and fallback
- [Agent State Determination](knowledge/concepts/agent-state-determination.md) — backend status contract proposal with status reason, age, evidence, and transition observability
- [Local Observability](knowledge/concepts/local-observability.md) — local-first metrics/logging plan for event-loop delay, tmux operations, WebSocket latency, and diagnostic bundles

### Entities
- People — [knowledge/entities/people/](knowledge/entities/people/)
- Organisations — [knowledge/entities/organisations/](knowledge/entities/organisations/)
- Tools:
  - [xterm.js](knowledge/entities/tools/xterm-js.md) — `@xterm/xterm` v6; VS Code's terminal engine; full VT100/xterm-256color; `convertEol`/`disableStdin` for tmux read-only display
  - [hterm](knowledge/entities/tools/hterm.md) — Google's HTML Terminal; stale (2020); not on npm; not recommended
  - [Fastify](knowledge/entities/tools/fastify.md) — host-server HTTP framework; structured request logging and WebSocket route context
  - [React](knowledge/entities/tools/react.md) — dashboard UI framework; Strict Mode effect cleanup matters for terminal focus and transport stability
  - [Vite](knowledge/entities/tools/vite.md) — frontend dev server/proxy; focused terminal WebSocket needs explicit proxy support
  - [Node.js](knowledge/entities/tools/node-js.md) — host-server runtime; event-loop delay/utilization should expose synchronous tmux blocking
- Components:
  - [LogTail](knowledge/entities/components/log-tail.md) — `frontend/src/components/LogTail.tsx`; xterm.js terminal renderer with focused WebSocket input/output and SSE fallback considerations
  - [Host Server](knowledge/entities/components/host-server.md) — Fastify backend owning API, SSE, focused terminal WebSocket, SQLite, tmux operations, and live-update loops

---

## Work

Each family's `index.md` lists its **active items only** (completed/terminal items drop off the list; files never move — status lives in frontmatter).

- **Requirements** — REQ-NNN. [Active index](work/requirements/index.md) · [lifecycle](work/requirements/lifecycle.md)
- **Decisions** — DEC-NNNN (per-decision `#DM`). [Active index](work/decisions/index.md) · [lifecycle](work/decisions/lifecycle.md)
- **Roadmaps** — ROADMAP-NNN. [Active index](work/roadmaps/index.md) · [lifecycle](work/roadmaps/lifecycle.md)
- **Tasks** — TASK-NNN. [Active index](work/tasks/index.md) · [lifecycle](work/tasks/lifecycle.md)
- **UAT** — UAT-NNN, one per task. [Active index](work/uat/index.md) · [lifecycle](work/uat/lifecycle.md)
- **Bugs** — BUG-NNNN. [Active index](work/bugs/index.md) · [lifecycle](work/bugs/lifecycle.md)
