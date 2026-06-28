## tmux-conductor

Run a fleet of AI coding agents in parallel from a single tmux session, with a live React dashboard to watch them work and a SQLite-backed task queue to keep them busy.

### The coordination mechanism is a file on disk

When a Claude Code agent finishes a task, its Stop hook writes `idle` to a per-agent state file. The monitor loop reads that file on its next poll and dispatches the next task with `tmux send-keys`. No message broker, no sidecar daemon, no network hop, no containers. Agents without hooks, like Aider or Codex, fall back to a `capture-pane` regex against their live pane output, so the same queue drives every vendor.

### Who it's for

Developers running several AI coding sessions concurrently, batch refactors across a codebase, or a mix of agent vendors, who want one place to watch and feed all of them.

### The best features

- **One SQLite queue, any agent.** Tasks live in a `tasks` table with optional per-agent scoping. `pop_task_sql()` takes scoped rows first, then global ones, using a SQL DELETE so there are no race conditions and no leftover files. Claude Code, Codex, and Aider all pull from the same queue.
- **Four agent states with stall detection.** Agents move through idle, busy, awaiting, and stalled. The Fastify server on port 8788 re-checks the live pane every 2 seconds, so an agent blocked on a `[Y/n]?` prompt or a plan-approval dialog gets a "waiting" badge and an Interact button you can click from the browser without touching tmux.
- **A dispatch race the monitor closes intentionally.** It writes `busy` to the state file right before sending keys, so a fast agent cannot grab a second task before its own `UserPromptSubmit` hook fires.

### The best part

Drop a screenshot onto an agent card in the dashboard and the server saves the bytes to disk, then types the file path into that agent's pane — the same thing that happens when you drop a file onto a real terminal.
