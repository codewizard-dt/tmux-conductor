---
id: TASK-0189
aliases: [TASK-0189]
title: "Spike whether pipe-pane log capture survives respawn-window -k versus kill-window plus new-window"
status: done
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: [TASK-0190]
parallel_safe_with: [TASK-0186, TASK-0187, TASK-0188]
uat: ""
tags: [bg-processes, tmux, spike, roadmap-0024]
---

# TASK-0189 — Spike whether pipe-pane log capture survives respawn-window -k versus kill-window plus new-window

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]
relates_to::[[tmux-window-target-prefix-matching]]
blocks::[[TASK-0190]]

> ROADMAP-0024 Phase 1 (Decisions & Spike). Produces a **written finding, not production code.** All experiments run against a throwaway tmux server on a private socket so the live conductor session is never touched.

## Objective

`raw/research/bg-process-agent-access/index.md` (Key Finding 3) recommends `respawn-window -k` for an in-place restart but marks it **unverified** whether the existing `tmux pipe-pane -o "cat >> $LOG_DIR/bg-<name>.log"` attachment survives a respawn, and notes a tmux bug report of server crashes when `respawn-*` runs while a control-mode client is behind on the pane's output. The restart operation (`TASK-0190`) must re-attach log capture correctly, so it needs a measured answer to: which restart mechanism is used, and exactly what must be re-done afterwards.

## Approach

Test on the local tmux (record `tmux -V`; the repo targets tmux >= 3.0, dev machine is macOS). Use a private socket (`tmux -L bgspike-$$ ...`) and scratch files under `./tmp/bg-pipe-spike/` (repo rule: host-side scratch always goes in `./tmp/`, never `/tmp`). Compare two mechanisms:

- **M1: `respawn-window -k -t <session>:=<name> -c <workdir> "<cmd>"`** (window and pane survive; process replaced)
- **M2: `kill-window` then `new-window -n <name> -c <workdir>` then type the command with `send-keys -l ... Enter`** (what `POST /bg-processes/:name/window` does today)

Questions to answer for each mechanism, with evidence (command output, log contents):

1. After the restart, does new output from the replacement process reach `bg-<name>.log` **without** re-issuing `pipe-pane`?
2. If `pipe-pane -o` is re-issued after M1 while the old pipe is still attached, does `-o` toggle the pipe **off** (tmux documents `-o` as "only open a new pipe if no previous pipe exists", i.e. a second call closes it)? This is the main correctness hazard for a reattach step.
3. Is output emitted between the restart and the reattach lost, and is a `--- restart <ts> ---` marker written to the log by the server (rather than typed into the pane) ordered correctly relative to the new process's first output?
4. Behavior when the old process ignores SIGHUP/SIGTERM or the pane is already dead (`remain-on-exit`): does `-k` still work, and does the pane's exit status stay inspectable?
5. Does either mechanism change `#{pane_current_command}` timing in a way that would confuse the liveness check (`TASK-0191`), for example a short window where the pane reads as a plain shell?
6. Any crash or hang (record the tmux version; the control-mode bug does not apply here because no `-C` client is attached, but confirm by noting whether the host-server or dashboard ever attaches one).

The finding must end in a single recommendation: which mechanism `TASK-0190` uses, the exact ordered command sequence (including whether `pipe-pane` is re-issued, and how to make the reattach idempotent, for example `pipe-pane` with no command first to close, then `-o` to open), and the marker-write ordering.

## Finding

Measured 2026-09-20 on **tmux 3.7c, macOS 26.3 (arm64)**, private sockets `bgspike-<pid>`, scratch under `./tmp/bg-pipe-spike/` (gitignored: `run.sh`, `probe/direct-launch.sh`, `results-1..9.txt`). The main harness ran twice (default shell `zsh -f`, then `bash --norc`); every count below matched across both shells unless noted. On macOS `sh` is bash, so a launched `sh -c ...` reads as `pane_current_command=bash`. Mechanisms: **M1** = `respawn-window -k`; **M1s** = `respawn-window -k` with no command, then type the launch command (same launch semantics as `new-window` + `send-keys`); **M2** = `kill-window` + `new-window` + type.

### Answers

| # | Question | M1 / M1s (`respawn-window -k`) | M2 (`kill-window` + `new-window`) |
|---|----------|-------------------------------|-----------------------------------|
| 1 | Does new output reach `bg-<name>.log` without re-issuing `pipe-pane`? | **Yes.** Same pane id (`%1` before and after), `#{pane_pipe}` stays `1`, one `cat` process, `NEW-PROCESS-1` and ticks appear after the marker. Also 20/20 for a replacement that prints immediately (`pane_pipe==1` after 20/20 respawns). | **No.** New pane id, `pane_pipe=0`, zero `cat` processes, zero new lines in the log. Capture must be re-attached. |
| 2 | Does re-issuing `pipe-pane -o` on an already-piped pane toggle it off? | **Yes, confirmed.** `pipe=1` -> `pipe-pane -o` -> `pipe=0`, log stops growing (0 bytes over 2.2 s in run 2), a third `-o` turns it back on. Idempotent alternatives, each applied 3x from piped and from unpiped state: `pipe-pane` (close) then `pipe-pane -o`, **or** `pipe-pane "cat >> log"` **without `-o`** (replaces any existing pipe). Both end at `pipe=1`, exactly 1 `cat` process, 0 duplicated log lines. Best guard: read `#{pane_pipe}` and only attach when it is `0`. | Same tmux behaviour (it is a property of `pipe-pane`, not the restart). |
| 3 | Output lost between restart and reattach; marker ordering | **No loss** (no reattach step). Marker ordering for M1: server `appendFileSync` **after** `respawn-window` returns and **before** the command is typed (M1s) is `MARK` then `NEW` in **20/20 in each shell, 0 iterations with old-process lines after the marker**, and it is ordered by causality (the marker precedes the keystroke that starts the process). Marker written **before** the respawn is also ordered before `NEW` but the still-running old process wrote lines after it in 5/20 (zsh) and 8/20 (bash) iterations, so it is wrong. Marker written after `respawn-window` for a directly launched command (M1) was ordered 80/80 (4 runs of 20) but only by a race with the new process's startup, not guaranteed. In-band marker (`printf ...; cmd` as the respawn command) was 20/20, but see Q5 (a compound command keeps a shell as the pane's foreground process). Closing the pipe, respawning, writing the marker, then reopening lost the new process's immediate first line 20/20. | With the pipe attached **before** typing, the first output is captured 20/20. With the attach **after** typing (the order `conductor.sh:95-96`, `spawn.sh:86-87`, and `host-server/index.ts` ~1961 and ~2056 use today) the first output was **lost 20/20** in the loaded harness (2/20 in a debug variant) and **kept 20/20** in two idle-server probes: it is a race between the `send-keys` and `pipe-pane` client processes and the shell's startup, so it is load-dependent, not deterministic. Marker before the restart: ordered but the old process keeps writing until killed; marker after: `NEW` lands **before** `MARK` in 20/20. |
| 4 | Process ignores SIGHUP/SIGTERM; dead pane | **`-k` does not kill it, in either mechanism.** `respawn-window -k` returned 0 and the replacement started, but a `trap "" HUP TERM` process survived as an orphan (`ppid 1`), whether launched by typing (M1s, and M2 identically) or as the direct respawn command (root ignoring signals: survived; well-behaved root with an ignoring child: the child survived). SIGKILLing a **pre-captured** descendant list after the respawn returned removed every survivor (both cases that had one). Dead pane with `remain-on-exit on`: `#{pane_dead}=1`, `#{pane_dead_status}=7` stay inspectable; `respawn-window` **without** `-k` works on a dead pane and keeps `pane_pipe=1`; `respawn-window` without `-k` on a **live** pane fails (`window ... still active`, exit 1), so `-k` is required. Note `#{pane_current_command}` on a dead pane still reads the last command (`sleep`), not a shell. | Same orphan survival (old pid alive, `ppid 1`, both shells). `kill-window` on a dead pane works. |
| 5 | Does the restart confuse `#{pane_current_command}` liveness? | Tight-loop sampling (about 4 ms per sample) across the restart: M1 direct shows a **transient of about 3-8 ms** (`zsh`, or `tmux` then `sh` with the `bash --norc` default) before the command name; M1s shows the shell for about 15-25 ms until the typed command runs, then `bash`. `#{window_activity}` **resets to now at respawn** (probe: 1789887002 -> 1789887006 with now = 1789887006), so the existing 3 s `BG_STARTUP_GRACE_MS` covers it. **Hazard:** wrapping the command as `printf ...; { cmd; }; exec "$SHELL"` left `pane_current_command=zsh` for the whole run (the wrapper shell is the foreground process), which `bgLiveness` would call `exited` past the grace, so a compound wrapper is unsafe. | Window is **absent for about 4 ms**, then a new pane shows `pipe=0` for about 5 ms, then `pipe=1`. During the gap `tmux display-message -p -t 'session:=name'` **exits 0 and returns the current window's pane** (probe: `%0 main zsh`) instead of failing, while `has-session -t 'session:=name'` and `list-panes -t` correctly exit 1 (`can't find window`). |
| 6 | Crash or hang? Control-mode client? | None. 30 back-to-back restarts each: server stayed up, all 30 `L-<i>` lines captured for both mechanisms, one `cat` per live window (17 total = 17 live piped windows, no leaked `cat`), no orphaned `sleep 30`. No `-C` client anywhere: Serena search over `host-server/`, `frontend/src`, `scripts/`, `hooks/` finds only `tmux attach-session` (a normal client) in `scripts/conductor.sh:119` and `scripts/spawn.sh:105`, so the reported control-mode crash does not apply. | Same. |

Caveat: only tmux 3.7c was tested (the repo targets >= 3.0); `#{pane_pipe}` is not confirmed on 3.0. Fallback if it is missing: `pipe-pane -t T "cat >> log"` without `-o` is safe regardless (replace semantics).

### Trimmed evidence

```
Q1 M1 (no reattach)   before: %1 pipe=1   after: %1 pipe=1   pipe processes: 1
   | OLD tick 2 | --- restart before-m1 --- | NEW-PROCESS-1 | NEW tick 0 ...
Q1 M2 (no reattach)   before: %3 pipe=1   after: %4 pipe=0   pipe processes: 0   NEW lines in log: 0
Q2  pipe=1 -> pipe-pane -o -> pipe=0 (log growth 0 bytes) -> -o -> pipe=1
Q2  close-then-open x3 / replace-without--o x3: pipe=1, 1 cat process, 0 duplicated lines
Q4c (bash) direct-launch root ignoring HUP/TERM:
    respawn-window -k exit=0   survivors after respawn -k: [31026]
    survivors after post-respawn SIGKILL of pre-captured tree: []
Q4b remain-on-exit: [q4deadm1] %95 cmd=sleep dead=1 status=7 pipe=1
Q5 M2 timeline: +4ms display-message -> %99 (a DIFFERENT window's pane, exit 0)
                +8ms new pane %101 pipe=0 -> +13ms pipe=1
Q9 M1s + marker before typing: ok=20 misordered=0 old-output-after-MARK=0 (zsh and bash), pane_pipe==1 in 20/20
```

### Recommendation for TASK-0190

**Use M1s: `respawn-window -k` with no command, then type the launch command.** Reasons: the pipe survives (no reattach in the normal case, no `-o` toggle hazard, no window/pane-id churn), the marker ordering is deterministic, and the pane still hosts an interactive shell exactly like a window from `new-window` + `send-keys`, so `bgLiveness` keeps its current semantics (a crashed process drops to a shell prompt and reads `exited`, the pane output stays for debugging). Rejected: direct `respawn-window -k "<cmd>"` (a crash closes the window, so `exited` becomes `stopped`, and the compound-wrapper variant breaks liveness), and M2 (loses the pipe, changes pane id, needs the reattach, opens the `display-message` fallback gap).

Ordered sequence, with `T = <session>:=<slug>` from `windowTarget()`, `LOG = $LOG_DIR/bg-<slug>.log`:

1. **Presence:** `tmux has-session -t T` (exit 0 = present). Use this, `isTmuxWindowPresent`, or `list-windows`; never infer absence from a failing `display-message -t` (it falls back to the current window and exits 0).
2. **Window absent (start path), in this order:** `new-window -d -t <session>: -n <slug> -c <workdir>`, then `pipe-pane -t T "cat >> '<LOG>'"` (no `-o` needed on a brand-new pane), then the marker (step 6), then `send-keys -t T -l -- <launchCmd>` and a separate `send-keys -t T Enter`. **Attach the pipe before typing**, unlike today's route order.
3. **Window present, capture the tree:** `#{pane_pid}` via `display-message -p -t T`, then the descendant pids of it by walking `ps -axo pid=,ppid=` (macOS `pgrep` has no `-s`; `ps` session id reads 0). Keep the list including the root.
4. `respawn-window -k -t T -c <workdir>` (no shell-command argument; `-k` is mandatory on a live pane).
5. **Kill survivors:** for each captured pid still alive (`kill -0`), `kill -KILL` it. This is the only thing that stops a HUP/TERM-ignoring process from surviving as an orphan that keeps its port. Do not kill the pane root **before** step 4 (it would close the window).
6. **Reattach guard (idempotent):** `display-message -p -t T '#{pane_pipe}'`; if `0`, `pipe-pane -t T "cat >> '<LOG>'"` **without `-o`**. In the measured normal case it is already `1` and this is a no-op. Never issue a bare `pipe-pane -o` on a pane that may already be piped.
7. **Marker:** server-side `appendFileSync(LOG, "\n--- restart <ISO-8601 UTC> ---\n")` **after step 4 returns (and after the guard) and before step 8**, never typed into the pane.
8. **Start:** `send-keys -t T -l -- <launchCmd>` then `send-keys -t T Enter` (`-l` with `--`, `Enter` separate, per the repo dispatch convention).

What must be re-done after restart to reattach log capture: **nothing in the normal case** (the pipe survives `respawn-window -k`, `pane_pipe` stays 1); only the step 6 guard, which re-attaches when `pane_pipe` is 0 (for example a window created by hand or a pane whose pipe was closed). The old-process kill (step 5) and the marker-before-typing ordering (step 7 before 8) are the two things that are easy to get wrong.

Follow-ups noticed, not fixed here (out of scope, no `host-server` edits): (a) the spawn paths attach `pipe-pane` after typing (`scripts/conductor.sh`, `scripts/spawn.sh`, and the two `execSync` routes in `host-server/index.ts`), which can lose first output under load; `TASK-0190`'s refactor of the open-window route should attach first. (b) `bgLivenessForWindow` (`host-server/state.ts`) reads "a failed `display-message` means the window is absent", which is false; today it is only called behind a `windowPresent` guard in `buildBgStatuses`, so keep that guard.

## Steps

### 1. Build the harness  <!-- agent: general-purpose -->

- [x] Create `./tmp/bg-pipe-spike/run.sh` (scratch; gitignored) that starts a private tmux server, `SOCK=bgspike-$$`, with a session, then for each mechanism runs the six checks above, printing labelled output and the resulting log file contents
  - Use a simple deterministic workload as the "bg process": `sh -c 'i=0; while true; do echo "tick $i"; i=$((i+1)); sleep 1; done'`, and a second replacement command that prints `NEW-PROCESS-<n>` so log lines identify which process wrote them
  - Always use exact-match window targets (`session:=name`) to match `windowTarget()` in `host-server/state.ts`
  - Clean up with `tmux -L "$SOCK" kill-server` in a `trap`, and never reference the live session name or `LOG_DIR`

### 2. Run the experiments  <!-- agent: general-purpose -->

- [x] Execute the harness at least twice (record `tmux -V`, macOS version), capturing raw outputs into `./tmp/bg-pipe-spike/results-<n>.txt`
- [x] Repeat check 4 with a process that traps and ignores TERM/HUP, and with `set-option -w remain-on-exit on` for the dead-pane case
- [x] For check 5, sample `tmux display -p -t <target> '#{pane_current_command}'` in a tight loop across each restart and record the observed sequence

### 3. Record the finding  <!-- agent: general-purpose -->

- [x] Write the result into this task under a new `## Finding` section above `## Steps`: a table of the six questions with M1/M2 results, the recommended mechanism, and the exact ordered command sequence for `TASK-0190`
- [x] Append a "Restart mechanism and log capture" subsection to `wiki/knowledge/concepts/background-process-registry.md` with `derived_from::[[TASK-0189]]`
- [x] Copy the key evidence (short, trimmed transcripts, not the whole run) into the Finding; do not write anything under `raw/` (the scratch results stay in gitignored `./tmp/`)
- [x] Update `TASK-0190`'s Approach section with the recommended mechanism and command sequence

### 4. Close out  <!-- agent: general-purpose -->

- [x] Flip this task to `done` per `wiki/work/tasks/lifecycle.md`, drop its line from `wiki/work/tasks/index.md`, tick the ROADMAP-0024 checkbox for this item, and append a `wiki/log.md` entry

## Dependencies

- Depends on: none.
- Blocks: `TASK-0190` (the restart operation adopts the mechanism and reattach sequence found here).
- Parallel-safe with `TASK-0186`, `TASK-0187`, `TASK-0188`.
