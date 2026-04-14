# Tasks

## Active Tasks

| # | Task | Description |
|---|------|-------------|
| 006 | [Chromium in Dev Container](active/006-chromium-in-dev-container.md) | Install native arm64/amd64 Chromium in scaffolded Dockerfile via xtradeb PPA + point Puppeteer at `/usr/bin/chromium` so puppeteer-mcp-claude works on Apple Silicon |
| 007 | [Hook Efficiency + Dispatch Race Fix](active/007-hook-efficiency-dispatch-race.md) | Stop duplicate `/tackle` dispatches by having monitor stamp a `dispatching` state the moment it sends keys; drop the redundant `PreToolUse` hook |
| 008 | [Publish Base Image](active/008-publish-base-image.md) | Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` with Chromium + Claude Code + uv preinstalled; update scaffold.sh to consume it (cuts per-project first-build from ~4min to ~15s) |

## Completed Tasks

| # | Task | Description |
|---|------|-------------|
| 001 | [Initial Scaffolding](completed/001-initial-scaffolding.md) | Extract all conductor scripts from CONDUCTOR.md, create host-side container exec wrapper, and scaffold.sh for dev container setup |
| 002 | [Scoped Task Queue](completed/002-scoped-task-queue.md) | Add agent-name prefix scoping to task queue so tasks dispatch only to the matching agent |
| 003 | [Container Config Sharing](completed/003-container-config-sharing.md) | Share host Claude config + global MCPs into each conductor container via first-boot init-copy; auto-register Serena MCP |
| 004 | [Idle Detection Fix](completed/004-idle-detection-fix.md) | Replace `capture-pane` idle regex with Claude Code hooks-based state file; keep regex as fallback |
| 005 | [Host Network Access](completed/005-host-network-access.md) | Add `host.docker.internal:host-gateway` to scaffolded compose so dev containers can reach host dev servers; document `0.0.0.0` bind requirement |
