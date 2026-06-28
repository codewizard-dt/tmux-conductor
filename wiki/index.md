---
title: Wiki Index
updated: 2026-06-11
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

### Concepts
- [ANSI Terminal Emulation in the Browser](knowledge/concepts/ansi-terminal-emulation-browser.md) — why `<pre>` falls short; stateful terminal emulator model; xterm-256color + truecolor support
- [tmux capture-pane and Escape Sequences](knowledge/concepts/tmux-capture-pane-escape-sequences.md) — `-e` flag for display path only; detection path must stay plain-text

### Entities
- People — [knowledge/entities/people/](knowledge/entities/people/)
- Organisations — [knowledge/entities/organisations/](knowledge/entities/organisations/)
- Tools:
  - [xterm.js](knowledge/entities/tools/xterm-js.md) — `@xterm/xterm` v6; VS Code's terminal engine; full VT100/xterm-256color; `convertEol`/`disableStdin` for tmux read-only display
  - [hterm](knowledge/entities/tools/hterm.md) — Google's HTML Terminal; stale (2020); not on npm; not recommended
- Components:
  - [LogTail](knowledge/entities/components/log-tail.md) — `frontend/src/components/LogTail.tsx`; currently plain-text `<pre>`; planned upgrade to xterm.js

---

## Work

Each family's `index.md` lists its **active items only** (completed/terminal items drop off the list; files never move — status lives in frontmatter).

- **Requirements** — REQ-NNN. [Active index](work/requirements/index.md) · [lifecycle](work/requirements/lifecycle.md)
- **Decisions** — DEC-NNNN (per-decision `#DM`). [Active index](work/decisions/index.md) · [lifecycle](work/decisions/lifecycle.md)
- **Roadmaps** — ROADMAP-NNN. [Active index](work/roadmaps/index.md) · [lifecycle](work/roadmaps/lifecycle.md)
- **Tasks** — TASK-NNN. [Active index](work/tasks/index.md) · [lifecycle](work/tasks/lifecycle.md)
- **UAT** — UAT-NNN, one per task. [Active index](work/uat/index.md) · [lifecycle](work/uat/lifecycle.md)
- **Bugs** — BUG-NNNN. [Active index](work/bugs/index.md) · [lifecycle](work/bugs/lifecycle.md)
