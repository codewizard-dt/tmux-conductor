---
topic: How to guarantee the agent-teams/naming preference reaches every agent tmux-conductor spawns into other projects, not just this repo
slug: subagent-panel-visibility
researched: 2026-09-13
---

# Primary Sources — Wiring the preference through tmux-conductor's own launch-command storage

> See also [sources.md](sources.md), [sources-2.md](sources-2.md), [sources-3.md](sources-3.md) for prior passes; IDs below restart at S1 for this file.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::createAgent` (~581-596), `::createProject`/`::updateProject` (~493-508), `host-server/db.migration.test.ts:128` | 2026-09-13 | `agents.launch_cmd` is a required, frozen-at-creation string; `projects.default_launch_cmd` schema default `'claude --dangerously-skip-permissions'`; no dynamic join from agent back to project default |
| S2 | codebase | `host-server/index.ts` — `POST /projects/:id/agents` launch-cmd resolution (~2116), live single-agent tmux spawn function (~257-273), `detectAgentType` call sites throughout | 2026-09-13 | Confirms copy-on-create semantics (`launchCmdOverride ?? project.defaultLaunchCmd`); confirms a second, independent tmux-spawn code path (dashboard "Add Agent") that also just interpolates `agent.launchCmd` verbatim via `tmux send-keys` |
| S3 | codebase | `host-server/state.ts::detectAgentType` (~251-256), `AgentType` (~5) | 2026-09-13 | TS-side "is this a claude/codex/custom launch command" detection, already used pervasively for status/pattern logic — reusable gate for a safe backfill |
| S4 | codebase | `scripts/monitor.sh::launch_cmd_name` (113-123) | 2026-09-13 | Bash-side equivalent of `detectAgentType`: extracts the first word of a launch command, skipping `VAR=value` prefixes |
| S5 | codebase | `scripts/lib/db.sh::load_agents` (44-57), `scripts/conductor.sh` (55-68, 74-86) | 2026-09-13 | Confirms `AGENT_CMDS` is populated straight from SQLite and dispatched via `tmux send-keys` with zero transformation, mirroring the host-server path (S2) |
| S6 | codebase | `frontend/src/components/AddProjectForm.tsx` (`DEFAULT_LAUNCH_COMMAND`, `defaultLaunchCmd` state, ~25-49) | 2026-09-13 | Confirms the frontend form always submits an explicit `defaultLaunchCmd`, making the backend's own fallback default effectively dead code for UI-created projects — a third place the literal default string must be updated for consistency |
