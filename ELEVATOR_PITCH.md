## tmux-conductor

Orchestrate a fleet of AI coding agents, including Claude Code, Codex, and Aider, from a single tmux session, with automatic task dispatch, usage-limit monitoring, and a live React dashboard.

### Each agent runs natively in a tmux window on the host

Standard multi-agent setups containerize agents or wrap them in cloud infrastructure, both of which cut off local tool access. tmux-conductor runs each agent directly in a tmux window on the host, giving it full filesystem and PATH access. Idle detection uses four stdlib-only Claude Code lifecycle hooks (on-session-start, on-prompt-submit, on-stop, on-stop-failure) that write atomic `idle`/`busy` state files, with `capture-pane` regex as fallback for Aider, Codex, or any CLI without hooks.

### Designed for developers farming work across multiple AI agents

Developers running one agent per service or one per test suite get deterministic dispatch and live visibility without manual babysitting.

### Three concrete features

- **Race-free dispatch.** The monitor writes `busy` to the agent's state file immediately before `send-keys`, closing the window between dispatch and the agent's first hook fire, which means the queue never double-dispatches to a busy agent.
- **Scoped task queue with a live dashboard.** `tasks.txt` uses `agentname: command` prefix syntax so tasks route to specific agents. An Astro+React dashboard on port 4321, backed by Fastify on 8788, shows live state and lets you drag-reorder tasks per agent.
- **Usage limit auto-teardown.** `USAGE_CHECK_CMD` runs before every dispatch. When all agents hit their limits simultaneously, the conductor sends `/exit` to each, `C-c` to background processes, and kills the session cleanly.

### Hook failures are invisible to the running agent

All four Node.js lifecycle scripts are stdlib-only, swallow errors silently, and always exit 0, so a hook failure never surfaces to the agent they're monitoring.
