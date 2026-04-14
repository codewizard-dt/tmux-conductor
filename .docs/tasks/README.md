# Tasks

## Active Tasks

| # | Task | Description |
|---|------|-------------|
| 002 | [Scoped Task Queue](active/002-scoped-task-queue.md) | Add agent-name prefix scoping to task queue so tasks dispatch only to the matching agent |
| 003 | [Container Config Sharing](active/003-container-config-sharing.md) | Share host Claude config + global MCPs into each conductor container via first-boot init-copy; auto-register Serena MCP |

## Completed Tasks

| # | Task | Description |
|---|------|-------------|
| 001 | [Initial Scaffolding](completed/001-initial-scaffolding.md) | Extract all conductor scripts from CONDUCTOR.md, create host-side container exec wrapper, and scaffold.sh for dev container setup |
| 004 | [Idle Detection Fix](completed/004-idle-detection-fix.md) | Replace `capture-pane` idle regex with Claude Code hooks-based state file; keep regex as fallback |
