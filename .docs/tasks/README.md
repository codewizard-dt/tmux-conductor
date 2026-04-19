# Tasks

## Active Tasks

| # | Task | Description |
|---|------|-------------|
| 008 | [Publish Base Image](active/008-publish-base-image.md) | Build + publish multi-arch `ghcr.io/codewizard-dt/tmux-conductor-base` with Chromium + Claude Code + uv preinstalled; update scaffold.sh to consume it (cuts per-project first-build from ~4min to ~15s) |
| 011 | [Refactor Hooks to Node.js](active/011-hooks-to-js.md) | Port the four per-event hooks from Bash to Node.js (stdlib only, shared `hooks/lib/write-state.js`), move `install-hooks.sh` to repo root, archive old `.sh` hooks under `hooks/.bash-backup/` |

## Completed Tasks

| # | Task | Description |
|---|------|-------------|
| 001 | [Initial Scaffolding](completed/001-initial-scaffolding.md) | Extract all conductor scripts from CONDUCTOR.md, create host-side container exec wrapper, and scaffold.sh for dev container setup |
| 002 | [Scoped Task Queue](completed/002-scoped-task-queue.md) | Add agent-name prefix scoping to task queue so tasks dispatch only to the matching agent |
| 003 | [Container Config Sharing](completed/003-container-config-sharing.md) | Share host Claude config + global MCPs into each conductor container via first-boot init-copy; auto-register Serena MCP |
| 004 | [Idle Detection Fix](completed/004-idle-detection-fix.md) | Replace `capture-pane` idle regex with Claude Code hooks-based state file; keep regex as fallback |
| 005 | [Host Network Access](completed/005-host-network-access.md) | Add `host.docker.internal:host-gateway` to scaffolded compose so dev containers can reach host dev servers; document `0.0.0.0` bind requirement |
| 006 | [Chromium in Dev Container](completed/006-chromium-in-dev-container.md) | Install native arm64/amd64 Chromium in scaffolded Dockerfile via xtradeb PPA + point Puppeteer at `/usr/bin/chromium` — superseded by task 008 base image (UAT skipped) |
| 009 | [Hook Model Alignment](completed/009-hook-model-alignment.md) | Collapse agent-state vocabulary to `idle`/`busy`; add `SessionStart` hook (startup/resume/clear), remove `Notification` hook, rename state values across hooks + `monitor.sh` |
| 010 | [Hooks Global Install](completed/010-hooks-global-install.md) | Refactor install-hooks.sh to copy hooks into ~/.claude/hooks/tmux-conductor/ and merge-register into settings.json with dedup (preserves foreign hook entries); container scaffolding unchanged (UAT skipped) |
| 012 | [Verbose Dispatch State Logging](completed/012-verbose-dispatch-logging.md) | Enrich monitor log lines with detection method + state age + queue context; emit structured `dispatch.jsonl` per dispatch and `hooks.jsonl` per hook transition so agent state at send-time is fully auditable |
