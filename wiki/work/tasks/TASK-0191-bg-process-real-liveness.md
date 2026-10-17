---
id: TASK-0191
aliases: [TASK-0191]
title: "Report real running/exited liveness for bg processes instead of window-exists-only"
status: pending-uat
created: 2026-09-19
updated: 2026-09-19
depends_on: []
blocks: []
parallel_safe_with: [TASK-0190, TASK-0192]
uat: "[[UAT-0191]]"
tags: [bg-processes, host-server, monitor, liveness, roadmap-0024]
---

# TASK-0191 — Report real running/exited liveness for bg processes instead of window-exists-only

relates_to::[[ROADMAP-0024]]
relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]

> ROADMAP-0024 Phase 2 (Backend). Independent of the restart operation. Phase 3's `dev-commands` `status` change and Phase 4's dashboard badge both consume the field this task adds.

## Objective

"Alive" for a bg process currently means only "its tmux window exists". `scripts/monitor.sh` (~lines 571-581) writes `alive` or `dead` to `$STATE_DIR/bg-<name>.state` from window presence alone, and `host-server/index.ts::buildBgStatuses` reports `windowPresent` plus the raw state-file string. Because the launch command is typed into a shell that stays open (`new-window` then `send-keys`), a dev server that crashes drops back to a shell prompt and the window remains, so it still reads as healthy. That defeats the purpose of "restart it if necessary". Report a real liveness: `running` when the pane is running the process, `exited` when the window is present but the pane has fallen back to a plain shell, and `stopped` when no window exists, using the same `pane_current_command` rule the agent path already uses.

## Approach

- **Reuse the agent liveness rule.** `host-server/state.ts` already has `SHELL_COMMANDS` and `isPaneDead(sessionName, windowName, launchCmd)`, and `readTmuxWindowInventory()` already returns `window_name -> pane_current_command` in one `list-windows` call, so `buildBgStatuses` can derive liveness from the inventory map it is already handed, at zero extra tmux cost. Add a pure `bgLiveness({ windowPresent, paneCommand, launchCmd, graceUntil? })` function in `host-server/state.ts` (or a small `bgLiveness.ts`) so it is unit-testable.
- **Launch-command caveat.** If the bg process's own launch command is a shell (for example `zsh -c ...` or an interactive `bash`), a shell in the pane is normal; follow `isPaneDead`'s existing "shell agents are always alive" branch using `launchCommandName`/`launchCommandBasename`.
- **Startup race.** Right after `send-keys` the pane still shows the shell for a moment before the child forks. Give a short grace (for example 3 s after the window's creation or the last restart) where a shell reads as `running`, not `exited`; expose it as a named constant (`BG_STARTUP_GRACE_MS`) and document it. The window creation time is available from tmux (`#{window_activity}`/`#{window_created}` via the inventory format string) or from the restart timestamp once `TASK-0190` lands; use whichever is available without depending on `TASK-0190`.
- **Vocabulary.** New `BgStatus.liveness: 'running' | 'exited' | 'stopped'`. The state file written by `monitor.sh` changes from `alive`/`dead` to `running`/`exited`/`dead` (`dead` retained for "window not found", matching the existing branch that also calls `move_to_backlog`). Keep `windowPresent` on the payload (the frontend uses it today). The monitor must compute the same rule in bash with `tmux display -p -t "$SESSION:=$bg_name" '#{pane_current_command}'` mirroring `pane_dead()` at `scripts/monitor.sh` ~163-170, including the launch-command-is-a-shell exception.
- **Do not change** the agent status pipeline, and do not gate dispatch on bg liveness (bg processes are never dispatched to and never affect idle/usage teardown, per CLAUDE.md).
- Fixing the wording in `skills/dev-commands/SKILL.md` and pointing the script at the new field is Phase 3 (`Point dev-commands status/tail at the new liveness and output endpoints and fix the SKILL.md state vocabulary`); this task only notes the vocabulary change in `wiki/knowledge/concepts/background-process-registry.md` and `scripts/README.md`.

## Steps

### 1. Inventory consumers of the bg state value  <!-- agent: Explore -->

- [x] With Serena `search_for_pattern`, list every reader/writer of `bg-<name>.state` and of the strings `alive`/`dead` for bg processes across `host-server/`, `frontend/src/`, `scripts/` (`monitor.sh`, `verify-dev-commands.sh` line ~80 writes `running` to a fixture state file), `skills/dev-commands/`, and `hooks/`
- [x] Record which of them will need updating for the new `running`/`exited`/`dead` set, and confirm `frontend/src/lib/api.ts` `BgStatus` type and `AgentList.tsx` bg tile rendering (they show `windowPresent`/`state`)
  - Finding: there is no `BgStatus` in `frontend/src/lib/api.ts`; the frontend bg type is `BgProcess` at `frontend/src/components/AgentList.tsx:63-72` (`windowPresent`, `state: string | null`). Step 2's frontend type edit targets `BgProcess` there. Only hard coupling: `scripts/verify-dev-commands.sh:82,84` `idle` fixture/assertion for `bg-vite`. `SKILL.md` wording is Phase 3.

### 2. Server-side liveness  <!-- agent: general-purpose -->

- [x] Add `bgLiveness()` (pure) and `BG_STARTUP_GRACE_MS` in `host-server/state.ts`; reuse `SHELL_COMMANDS` and `launchCommandName`
  - Signature: `bgLiveness({ windowPresent, paneCommand?, launchCmd, windowActivityMs?, nowMs? }): BgLiveness`; grace uses tmux `#{window_activity}` (new `windowActivityMs` map on `TmuxWindowInventory`), applied only when both `windowActivityMs` and `nowMs` are passed. Live-tmux expansion of `#{window_activity}` is unverified (UAT).
- [x] Extend `BgStatus` in `host-server/index.ts` with `liveness: 'running' | 'exited' | 'stopped'`; in `buildBgStatuses` derive it from the passed-in `windowInventory` (window name -> `pane_current_command`); when no inventory is passed (fallback branch), call the existing single-window `display-message` helper
- [x] Add the field to the frontend `BgStatus` type in `frontend/src/lib/api.ts` (type only; UI use is Phase 4)
  - Landed as optional `liveness?` on `BgProcess` in `frontend/src/components/AgentList.tsx` (no `BgStatus` exists in `api.ts`); `api.ts` untouched.


### 3. Monitor state file  <!-- agent: general-purpose -->

- [x] In `scripts/monitor.sh` (bg loop near lines 571-581) replace the unconditional `alive` write with `running`/`exited` using a `bg_pane_exited()` helper that mirrors `pane_dead()` (exact-match target `"$SESSION_NAME:=$bg_name"`, shell-launch exception via the existing `is_shell_cmd`); keep `dead` for the missing-window branch
- [x] Update `scripts/verify-dev-commands.sh` fixtures only if they assert the old vocabulary; run `bash -n` on every touched script

### 4. Tests and docs  <!-- agent: general-purpose -->

- [x] Add `bgLiveness` cases to `host-server/state.test.ts`: window absent -> `stopped`; non-shell command -> `running`; plain shell -> `exited`; shell within grace -> `running`; launch command that is itself a shell -> `running`; empty command string from tmux -> `running` (fail toward not restarting)
- [x] Add a bash check to `scripts/verify-dev-commands.sh` (or a small new `scripts/verify-bg-liveness.sh` on a private tmux socket under `./tmp/`) proving a crashed process reads `exited` while a running one reads `running`
  - Written as `scripts/verify-bg-liveness.sh` (`bash -n` clean). Running it is [DEFERRED-TO-UAT]; it replicates `bg_pane_exited` rather than sourcing `monitor.sh`, so keep the two in sync.
- [x] Update `wiki/knowledge/concepts/background-process-registry.md` and `scripts/README.md` with the new vocabulary; run `cd host-server && npx tsc --noEmit && npm test` and `cd ../frontend && npx tsc --noEmit`

## Dependencies

- Depends on: none.
- Blocks: nothing hard; Phase 3 (`dev-commands` `status`) and Phase 4 (dashboard badge) items consume the new field.
- Parallel-safe with `TASK-0190` (restart) and `TASK-0192` (output endpoint); expect small overlap in `host-server/index.ts` bg code, in disjoint regions.
