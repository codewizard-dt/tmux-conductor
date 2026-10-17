---
topic: "improve 'background processes' by linking them to a project, and all agents from a project can check its output at any time and can restart it if necessary"
slug: bg-process-agent-access
researched: 2026-09-19
---

# Primary Sources — Project-linked background processes that every project agent can inspect and restart

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::buildBgStatuses`, bg routes (`/bg-processes`, `/bg-processes/:name`, `/bg-processes/:name/window`, `/projects/:id/bg-processes`), agent launch text at line 275 | 2026-09-19 | project fields on BgStatus; existing open/close window routes and 409 on existing window; `send-keys "${launchCmd}"` quoting; `CONDUCTOR_*` env at agent launch |
| S2 | codebase | `frontend/src/components/AgentList.tsx` lines 1367, 1451 | 2026-09-19 | bg tile only calls window DELETE (close) and POST (open); no restart |
| S3 | codebase | `scripts/monitor.sh` lines 571-581 | 2026-09-19 | bg state file is `alive`/`dead` from `tmux has-session` only |
| S4 | codebase | `CLAUDE.md` (Key Design Decisions: pane liveness via `pane_current_command`; single-user, no auth) | 2026-09-19 | agent liveness precedent; no auth model |
| S5 | codebase | `skills/dev-commands/scripts/dev-commands.sh`, `skills/dev-commands/SKILL.md` | 2026-09-19 | `list` unscoped via `/api/status`; `tail` is plain `tail -n`; SKILL.md documents idle/busy/running states |
| S6 | codebase | `scripts/conductor.sh` lines 63, 81, 96; `scripts/lib/db.sh` line 80 | 2026-09-19 | `CONDUCTOR_BG_*` env only for linked agent; `pipe-pane` log attach; window name `<project>-<agent>` |
| S7 | codebase | `raw/research/bg-processes-project-scoping/index.md`; `raw/research/shared-dev-commands/index.md`, `index-4.md`; `wiki/work/roadmaps/archive/ROADMAP-020-shared-dev-commands-implementation.md` | 2026-09-19 | ROADMAP-020 scope already delivered; deferred per-project name uniqueness |
| S8 | web | https://tmuxai.dev/tmux-respawn-pane/ | 2026-09-19 | `respawn-pane -k` restarts in place; `remain-on-exit on` keeps dead panes |
| S9 | web | https://github.com/tmux/tmux/issues/5499 | 2026-09-19 | reported server SIGSEGV after respawn-pane/window when a control-mode client is behind |

## Excerpts

### S8 — How to respawn panes and manage process exit behavior?
https://tmuxai.dev/tmux-respawn-pane/
> Use `respawn-pane` to restart a command in the current pane without recreating it: `respawn-pane -k 'htop'`. Set `remain-on-exit on` to keep panes open when processes exit, allowing you to see exit status and respawn easily.

### S9 — Server SIGSEGV after respawn-pane when a control client is behind on the pane
https://github.com/tmux/tmux/issues/5499
> The server segfaults after respawn-pane or respawn-window (with or without -k, and on a dead remain-on-exit pane) when a control-mode client (-C/-CC) is attached and has not consumed all of the target pane's output.
