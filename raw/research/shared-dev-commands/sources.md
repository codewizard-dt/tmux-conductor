---
topic: a way to list vital dev commands for a project in a format that agents of the same project have access to. agents can check to see if a specific dev process is running and check its output. examples would be "npm run dev" or "make dev" etc. these will run in their own tmux window but will be shared amongst all agents of that project. we may need a user-scoped skill with related bash script to do that efficiently. these commands would also be managed via the ui like agents are
slug: shared-dev-commands
researched: 2026-09-13
---

# Primary Sources — Shared, Project-Scoped Dev Commands for Agents

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::buildBgStatuses`, `BgStatus`, and the `/bg-processes` route block (lines ~136-165, 1754-1882) | 2026-09-13 | `BgStatus` shape; confirms `POST/DELETE /bg-processes` write to `conductor.conf` via `appendBgProcessToConf`/`removeBgProcessFromConf`, with an explicit comment naming conductor.conf as authoritative — the split-brain source |
| S2 | codebase | `scripts/monitor.sh` lines 462-473 | 2026-09-13 | Confirms `monitor.sh` writes `alive`/`dead` to `$STATE_DIR/bg-<name>.state` every poll tick based on `tmux has-session` |
| S3 | web | https://github.com/DarthSim/overmind | 2026-09-13 | Overmind (Procfile + tmux process manager) uses a real tmux window per process specifically to avoid the buffering/color-loss problems of plain stdout redirection — validates the existing `pipe-pane`-to-logfile approach as an industry-standard primitive |
| S4 | web | https://recca0120.github.io/en/2026/04/16/overmind-procfile-process-manager/ | 2026-09-13 | Explains *why* naive `> file` redirection breaks colored/buffered output and why tmux control-mode/pipe-pane style capture is preferred — directly supports not replacing the existing capture mechanism |
| S5 | codebase | `scripts/lib/db.sh::load_bg` (lines 69-83) and `scripts/conductor.sh` (lines 19-23, 90-99) | 2026-09-13 | Confirms the shell scripts load and spawn bg processes exclusively from SQLite (`SELECT name, workdir, launch_cmd FROM bg_processes`), which is what actually runs — contradicting the host-server API's conductor.conf-based CRUD (S1) |
| S6 | web | https://code.claude.com/docs/en/skills | 2026-09-13 | Official Claude Code Skills docs: `SKILL.md` + bundled `scripts/` directory is the standard shape for a skill that ships an executable helper; user-scoped skills live under `~/.claude/skills/` |
| S7 | web | https://www.shruggingface.com/blog/the-system-skill-pattern | 2026-09-13 | "System Skill Pattern" — a worked example of a user-scoped skill (`~/.claude/skills/<name>`) wrapping a CLI script that reads/writes local state, directly analogous to the proposed `dev-commands` skill wrapping the existing bg-process log/state files |

## Excerpts

### S1 — `host-server/index.ts` (bg-process route + comment)
`host-server/index.ts:1787-1789`
> // conductor.conf is authoritative for bg processes (what conductor.sh spawns
> // and teardown.sh kills) — write the definition there, not the DB.
> await appendBgProcessToConf(conf._confPath, name, workdir, launchCmd);

### S2 — `scripts/monitor.sh` (liveness write)
`scripts/monitor.sh:463-472`
> for bg_name in "${BG_NAMES[@]}"; do
>   ...
>   if ! tmux has-session -t "$bg_target" 2>/dev/null; then
>     ...
>     echo "dead" > "$STATE_DIR/bg-$bg_name.state"
>   else
>     echo "alive" > "$STATE_DIR/bg-$bg_name.state"
>   fi
> done

### S3 — Overmind README
https://github.com/DarthSim/overmind
> There are some good Procfile-based process management tools, including foreman by David Dollar, which started it all. The problem with most of those tools is that processes you want to manage start to think they are logging their output into a file, and that can lead to all sorts of problems: severe lagging, and losing or breaking colored output.

### S4 — Overmind explainer
https://recca0120.github.io/en/2026/04/16/overmind-procfile-process-manager/
> foreman's log issues come from how processes detect their output destination. When a program's stdout isn't a real terminal, it switches to buffered mode — color escape codes get stripped and output batches until the buffer fills. Overmind runs each process in a real tmux window and uses tmux's control mode to capture output.

### S5 — `scripts/lib/db.sh` (`load_bg`)
`scripts/lib/db.sh:69-83`
> load_bg() {
>   BG_NAMES=()
>   ...
>   done < <(sql "SELECT name, workdir, launch_cmd FROM bg_processes ORDER BY name")
> }

### S6 — Claude Code Skills docs
https://code.claude.com/docs/en/skills
> Save it under your home directory to get it in every project, commit it to a repository to share it with everyone who works there, or distribute it through a plugin or managed settings to reach a whole team. ... Create the Skill directory: mkdir -p ~/.claude/skills/codebase-visualizer/scripts · Save this to ~/.claude/skills/codebase-visualizer/SKILL.md.

### S7 — The System Skill Pattern
https://www.shruggingface.com/blog/the-system-skill-pattern
> The basic idea is that you tell Claude that you want to kick off a Pomodoro session, and share what you're working on. The SKILL.md defines how to run and operate the Pomodoro recording system. ... Bash(cd /Users/jakedahn/.claude/skills/pomodoro && ./pomodoro timeout: 30m start --task "Refactor ABC-123")
