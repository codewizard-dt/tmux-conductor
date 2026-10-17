---
id: TASK-0189
aliases: [TASK-0189]
title: "Spike: does pipe-pane log capture survive respawn-window -k, and can a crash be detected?"
status: trashed
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0186, TASK-0187, TASK-0188]
uat: ""
tags: [bg-processes, tmux, spike, roadmap-0024]
---

# TASK-0189 — Spike: does pipe-pane log capture survive respawn-window -k, and can a crash be detected?

relates_to::[[bg-process-agent-access]]
relates_to::[[tmux-window-target-prefix-matching]]

> ROADMAP-0024 Phase 1 spike. Experiment only: **no repo code changes.** The verdict decides how the Phase 2 restart operation and liveness signal are built.

## Objective

Today a bg process is started by `tmux new-window` (which opens the default shell), then `send-keys "<launchCmd>" Enter`, then `pipe-pane -o "cat >> $LOG_DIR/bg-<name>.log"`. Two open questions decide the restart design: (1) does `pipe-pane` capture survive a restart done with `respawn-window -k` versus kill-window + new-window; (2) because the command runs inside a persistent shell, a crashed process leaves a live shell prompt and the window still exists, so "alive" (window present) cannot detect the crash — would running `launchCmd` as the window's own command with `remain-on-exit` make a crash detectable (`#{pane_dead}`)? Produce a measured verdict on tmux 3.7c.

## Approach

**Safety: use a private tmux server** — every command is `tmux -L bg-spike-<pid> ...` so the live conductor session is never touched. Work under `./tmp/bg-spike/` (repo-local, gitignored). Fixture commands: a ticker (`bash -c 'echo BANNER; i=0; while true; do echo tick $i; i=$((i+1)); sleep 1; done'`), a crasher (`bash -c 'echo BANNER; sleep 2; exit 3'`), and a cwd/env probe (`bash -c 'pwd; echo FOO=$FOO'`) launched with `FOO=bar` and `-c ./tmp/bg-spike/workdir`.

Variants compared:
- **A — today:** `new-window -c dir` + `send-keys cmd Enter` + `pipe-pane -o`; restart = `kill-window` then repeat.
- **B — respawn:** `respawn-window -k -t target 'cmd'` (command passed explicitly) on an A-style window; also test a bare `respawn-window -k` with no command (expected: restarts the shell, not the command).
- **C — command as window command:** `new-window -c dir 'cmd'` with `set-option -w remain-on-exit on`, then `pipe-pane -o`; restart = `respawn-window -k`.

Criteria per variant: (1) log capture continues after restart (`#{pane_pipe}` and appended `tick` lines); (2) early output such as `BANNER` is not lost to the pipe-pane-after-start race; (3) cwd and env preserved on restart; (4) crash detectability — `#{pane_dead}`/`#{pane_dead_status}` (C) versus `#{pane_current_command}` returning a shell name after the crasher exits (A); (5) restart while the process is still running works with `-k`, and plain `respawn-window` without `-k` refuses.

## Steps

### 1. Set up the private sandbox  <!-- agent: general-purpose -->

- [ ] `mkdir -p ./tmp/bg-spike/workdir`; record `tmux -V` (expect 3.7c). Start `tmux -L bg-spike-$$ new-session -d -s spike -x 200 -y 50`. Write the three fixture commands into small scripts under `./tmp/bg-spike/` so quoting is not a variable.

### 2. Run variant A (baseline)  <!-- agent: general-purpose -->

- [ ] Start the ticker; confirm the log grows; kill and recreate; confirm the log continues (append), check `BANNER` presence and cwd/env. Then start the crasher, wait 3 s, and record `#{pane_current_command}` and whether the window still exists (validates the "crash is invisible to window presence" inference).

### 3. Run variant B  <!-- agent: general-purpose -->

- [ ] On a running A-style window: `respawn-window -k -t ... 'cmd'`; record `#{pane_pipe}`, whether log lines keep appending, cwd/env, and `BANNER` re-capture. Repeat with bare `respawn-window -k` (no command) and with no `-k` on a live pane; record each result and error text.

### 4. Run variant C  <!-- agent: general-purpose -->

- [ ] Command-as-window with `remain-on-exit on`: run the crasher, record `#{pane_dead}`, `#{pane_dead_status}` and that the window persists; `respawn-window -k` to restart it and record pipe-pane state, log continuity and cwd/env. Compare early-output loss against A.

### 5. Write the verdict and clean up  <!-- agent: general-purpose -->

- [ ] Fill this task's `## Notes` with: a table of variants A/B/C x criteria 1-5 with the exact commands and observed outputs; a clear recommendation for (a) the restart mechanism (respawn vs kill+new-window) and (b) the liveness signal (`pane_dead` vs `pane_current_command` vs window presence), including any behavior that changes `POST /bg-processes/:name/window`; and follow-up consequences for the Phase 2 restart and liveness items.
- [ ] `tmux -L bg-spike-$$ kill-server`; delete `./tmp/bg-spike/`. Confirm the real conductor tmux session was never touched (`tmux ls` unchanged).

## Notes

