---
id: TASK-0218
aliases: [TASK-0218]
title: "Run UAT for the Create worktree menu action and the Clone into new worktree flow"
status: in-progress
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0209, TASK-0210, TASK-0211, TASK-0212, TASK-0213, TASK-0214, TASK-0215, TASK-0216, TASK-0217]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0218]]"
tags: [worktree, agents, clone, uat, verification, roadmap-0025]
---

# TASK-0218 — Run UAT for the Create worktree menu action and the Clone into new worktree flow

relates_to::[[worktree-on-any-agent]]
depends_on::[[TASK-0209]]
depends_on::[[TASK-0210]]
depends_on::[[TASK-0211]]
depends_on::[[TASK-0212]]
depends_on::[[TASK-0213]]
depends_on::[[TASK-0214]]
depends_on::[[TASK-0215]]
depends_on::[[TASK-0216]]
depends_on::[[TASK-0217]]

> **Roadmap**: ROADMAP-0025 Phase 3, item 3 (the closing task). Every earlier ROADMAP-0025 task defers its live check (real tmux, two browsers, real git) to this UAT, so it runs last, after TASK-0209..0217 are all merged.

## Objective

Prove end to end that worktree creation is reachable from any agent and behaves safely: the **Create worktree** menu action (enabled/disabled states, real error text, live-agent warning and restart, sibling-directory placement, propagation to other clients) and the **Clone into new worktree** flow (fresh isolated worktree with the window starting inside it, immediate correct SSE payload, teardown on delete), plus regressions on the plain **Clone** and the Add Agent **Use a git worktree** paths. Deliverables: one consolidated UAT file, the run results recorded in it, and any failures filed as bugs.

## Approach

- **One consolidated UAT, not nine.** The roadmap item is a single "Run UAT" line, so generate `wiki/work/uat/UAT-0218-worktree-menu-and-clone-flow.md` via `/uat-generate TASK-0218` (frontmatter `status: pending`, `task: TASK-0218`, `implements::[[TASK-0218]]`, same layout as `UAT-0201`/`UAT-0208`), consolidating the `[Deferred to TASK-0218]` recipes from TASK-0209..0217. Set this task's `uat:` to `[[UAT-0218]]` and its status to `pending-uat` when written.
- **Isolation (hard requirement, per CLAUDE.md).** All scratch under `./tmp/uat-0218/` — never `/tmp`. A throwaway git repo `./tmp/uat-0218/repo` (with a committed `packages/app/` subdirectory and one initial commit on `main`), a plain non-git directory `./tmp/uat-0218/plain`, and either the user's running dev stack with clearly named throwaway agents (`uat0218-*`) or, preferably, an isolated host-server (private `CONDUCTOR_CONF` with its own `DB_PATH`/`STATE_DIR`/`LOG_DIR`/`SESSION_NAME`, `TMUX_TMPDIR` private socket, unused `BACKEND_PORT`) following the `--live` pattern TASK-0208 defines for `verify-dev-commands.sh`. The UAT must never create worktrees for, restart, or delete the user's real agents; the worktrees it creates land in `./tmp/uat-0218/repo-worktrees/` and are removed in the cleanup case.
- **Mixed verification.** Cases with a runnable command carry a `**Command**` block and are run with `/uat-auto`; UI cases (menu rendering, reason line, banner, warning/notice dialogs, two-browser propagation, theme check) are UAT-UI cases walked with `/uat-walk` (Playwright MCP where possible). Each case names its deterministic half (`Repeatable Unit Test` / `Verify script` line): `git.test.ts`, `worktreeErrors.test.ts`, `db.migration.test.ts`, `agentDiff.test.ts`, `agentUpdatePayload.test.ts`, `worktreeTeardown.test.ts`, `AgentActionsMenu.test.tsx`, `AgentList.test.tsx`, and a documented gap for anything only a live run proves.
- **Optional live harness.** If the live steps are too fiddly to repeat by hand, add `scripts/verify-worktree-any-agent.sh` (opt-in, hermetic by default, skips with exit 0 and "SKIPPED" when `tmux`/`git`/`jq`/`curl` is missing or the port is busy) that seeds the throwaway repo and agents through the real API and asserts cases 5, 7, 8, 9 and 11 below via `curl`, `git`, and `tmux display -p '#{pane_current_path}'`. Wall-clock waits are bounded deadline loops, not fixed sleeps.
- **Failures.** A failing case is not patched inside this task: file it with `/bug-file` (or fold into the owning task if still open), note the verdict in the UAT, and leave this task `pending-uat` until re-run.

## Steps

### 1. Read inputs  <!-- agent: Explore -->

- [x] With Serena, read the merged results of TASK-0209..0217 (their step notes and every `Deferred to TASK-0218` line) and list each deferred live check; every one must map to a case below.
- [x] Read `wiki/work/uat/UAT-0201-collapsible-agent-sidebar.md` and `UAT-0208` (once it exists) for the layout, and `scripts/verify-diff-endpoint-worktree-and-uncommitted.sh` / `scripts/verify-dev-commands.sh` for the isolated-server harness style.

### 2. Generate the UAT file  <!-- agent: general-purpose -->

- [x] Run `/uat-generate TASK-0218` and ensure the resulting `UAT-0218-worktree-menu-and-clone-flow.md` contains at least these cases (tag each with the task it verifies):
  1. **Setup** — isolated stack, throwaway repo with `packages/app/`, non-git dir, agents: `uat0218-a` (repo root, no worktree, window live), `uat0218-sub` (workdir `packages/app`), `uat0218-plain` (non-git dir), `uat0218-wt` (created with **Use a git worktree**).
  2. **Menu item present and enabled** (0209) — `uat0218-a`: Create worktree is enabled, the tooltip reads as specified.
  3. **Reasoned disabled states** (0209) — `uat0218-wt`: disabled, visible line "Already has a worktree (conductor/<id>)"; `uat0218-plain`: disabled, "Workdir is not inside a git repository"; the reason is readable without hover and in light and dark themes; keyboard Up/Down skips disabled items.
  4. **Real error reasons** (0210) — pre-create `git branch conductor/<id>` for `uat0218-sub`, click Create worktree, and the banner shows git's actual "already exists" text once (not duplicated in the Details tab, not a generic message); `curl -X POST /api/agents/<plain id>/worktree` returns 400 with the not-a-repo message; a stopped host-server yields "Could not reach the host-server".
  5. **Sibling directory** (0212) — for `uat0218-sub` (subdirectory workdir) after clearing the pre-created branch: `worktreePath === ./tmp/uat-0218/repo-worktrees/<id>` (the `repo-worktrees` directory did not exist before), nothing new inside `./tmp/uat-0218/repo`, and `git -C ./tmp/uat-0218/repo status --porcelain` is empty.
  6. **Propagation** (0211, 0215) — two browser tabs on the Agents page; create a worktree in tab A; tab B's sidebar row shows `⎇ conductor/<id>` within ~3 s with no reload; `curl -N /api/events` shows a full-shaped `agent-update` including `worktreePath` and `branch`.
  7. **Live-agent warning and restart** (0216, 0213) — on live `uat0218-a`: the warning dialog appears before creation, Cancel creates nothing; Confirm creates and shows the "still running in <workdir>" notice; **Restart in worktree** (with its confirmation) relaunches the window and `tmux display -p -t <window> '#{pane_current_path}'` is the worktree; an edit made by the agent afterwards appears in the Diff tab. For an agent with no window there is no dialog and **Create window** starts inside the worktree.
  8. **Clone into new worktree, worktree-less source** (0213, 0214, 0215) — `uat0218-a` (before/after as appropriate): new agent is selected, its row shows the `⎇` badge on the first event (no badge-less flash), its window's `pane_current_path` is `repo-worktrees/<cloneId>`, and the source still has no worktree and an unchanged cwd.
  9. **Clone into new worktree, worktree-backed source; plain Clone unchanged** (0213, 0214) — cloning `uat0218-wt` with the new item gives a second, distinct worktree and branch; plain **Clone** of `uat0218-a` (no worktree) still shares its workdir with no worktree, and plain Clone of `uat0218-wt` still yields a worktree (existing behaviour).
  10. **Loud failure, no residue** (0213) — `POST /api/agents/<plain id>/clone` with `{"forceWorktree":true}` returns 400 and no agent row or tmux window is created; with a pre-created conflicting branch the dashboard shows the git reason and no clone row/window remains; the menu item is disabled for `uat0218-plain`.
  11. **Teardown** (0217) — delete a forced clone from the dashboard: its worktree directory, `git worktree list` entry and `conductor/<cloneId>` branch are gone, the source's worktree/branch/agent are intact; hand-delete another agent's worktree directory, delete that agent, and confirm the branch is also gone (prune path).
  12. **Regressions** — Add Agent with **Use a git worktree** still creates a worktree in the sibling directory and its window starts in it; agents with no worktree behave as before; `npm test` in `host-server/` and `npx vitest run` in `frontend/` are green.
  13. **Cleanup** — delete all `uat0218-*` agents (verifying step 11's guarantees), `rm -rf ./tmp/uat-0218`, confirm no `uat0218` tmux windows and no stray `*-worktrees` directory remain, and the user's real agents are untouched.
- [x] Add a **Repeatable Unit Test / Verify script** line to each case pointing at its deterministic half, and a "Gap" note where only a live run proves it.

### 3. (Optional) Live harness script  <!-- agent: general-purpose -->

- [WIP] Create `scripts/verify-worktree-any-agent.sh` per the Approach (isolated conf/DB/tmux socket/port, `trap` cleanup that kills only the private tmux server and host-server PID it started, refuses to run if `CONDUCTOR_CONF` is unset or points at the repo's real `conductor.conf`); `bash -n` it and run it once. Mention it in `scripts/README.md` if the repo documents sibling verifiers there.

### 4. Run and record  <!-- agent: general-purpose -->

- [ ] Run the automated cases with `/uat-auto` and the UI cases with `/uat-walk`; record pass/fail per case in `UAT-0218-…md`; file failures with `/bug-file`. Confirm the cleanup case left `./tmp/` clean.
- [ ] On an all-green run the standard `uat-*` flow closes TASK-0218; set the roadmap checkbox for this item only through that flow (do not tick it by hand).

## Files expected to be touched

`wiki/work/uat/UAT-0218-worktree-menu-and-clone-flow.md` (new), `wiki/work/uat/index.md` (via `/uat-generate`), optionally `scripts/verify-worktree-any-agent.sh` (new) and `scripts/README.md`. No production code — anything the UAT finds goes through bug files or back into the owning task.

## Dependencies

- **Depends on** all of TASK-0209 (menu item), TASK-0210 (real errors), TASK-0211 (propagation), TASK-0212 (sibling guard), TASK-0213 (force-worktree clone + pane cwd), TASK-0214 (clone menu item), TASK-0215 (clone SSE payload), TASK-0216 (live-agent warning/restart), TASK-0217 (teardown test) — it is the last item on the roadmap.
- **Blocks** nothing.
- Runs against live tmux and a browser, so it must not run in parallel with any task that restarts the dev server or edits the same files.
