---
topic: "improve 'background processes' by linking them to a project, and all agents from a project can check its output at any time and can restart it if necessary"
slug: bg-process-agent-access
researched: 2026-09-19
sources: [./sources.md]
---

# Research: Project-linked background processes that every project agent can inspect and restart

> Builds on [../shared-dev-commands/index.md](../shared-dev-commands/index.md) and [../bg-processes-project-scoping/index.md](../bg-processes-project-scoping/index.md). ROADMAP-020 (done) already delivered the DB-as-source-of-truth split-brain fix, `bg_processes.project_id`, `GET /projects/:id/bg-processes`, a project selector and grouping in the UI, and the agent-facing `dev-commands` skill (`list`/`status`/`tail`). **"Link to a project" is therefore mostly done at the data layer; the remaining work is the agent-facing half.** Three gaps stop "all agents from a project can check its output at any time and restart it": (1) there is **no restart primitive** anywhere (API, script, or UI), only separate open/close-window actions; (2) the agent skill is **project-blind** (`list` shows every bg process, and an agent has no way to learn its own project); (3) "alive" only means *the tmux window exists*, so a crashed dev server that dropped back to a shell prompt still reads as healthy, which undermines "restart it if necessary". Recommendation: add a server-side `POST /bg-processes/:name/restart` plus a real liveness signal, resolve the caller's project server-side from `CONDUCTOR_AGENT_NAME`, and extend `dev-commands.sh` with project-filtered `list` and a `restart` subcommand, then add a dashboard Restart button.

## Research Questions
- What of "link bg processes to a project" already exists after ROADMAP-020, and what is still missing?
- How can an agent learn which project it belongs to, and which bg processes are "its" project's?
- Is there any restart capability today (API, script, UI), and what would a safe one look like?
- Can an agent trust the current "alive/dead" signal to decide a restart is needed?
- Is the log output an agent reads actually usable (format, growth, restart boundaries)?

## Current State (Codebase)

- **Data layer is done.** `bg_processes.project_id` exists; `buildBgStatuses` (`host-server/index.ts:149-174`) returns `projectId`/`projectName`; `GET /projects/:id/bg-processes` exists (`index.ts:2266-2278`) [S1]. `POST /bg-processes` accepts `projectId` (`index.ts:1886`); `PATCH /bg-processes/:name` can change it (`index.ts:1952`) [S1]. The legacy `linked_agent_id` (one bg process ↔ one agent) still exists alongside it.
- **No restart primitive.** The bg routes are `POST /bg-processes`, `PATCH`/`DELETE /bg-processes/:name`, `POST /bg-processes/:name/window` (open) and `DELETE /bg-processes/:name/window` (close) [S1]. `POST …/window` returns **409 "window already exists"** if the window is present (`index.ts:2023-2025`), so a restart today means two separate calls, `DELETE` then `POST`, non-atomically. The frontend only wires those two calls to separate Close/Open buttons (`AgentList.tsx:1367`, `:1451`) [S2].
- **Fragile spawn.** `POST …/window` builds shell strings with `execSync` and sends the launch command as `send-keys "${entry.launchCmd}" Enter` inside literal double quotes (`index.ts:2027-2029`), so a `launchCmd` containing `"`, `$`, or backticks is mangled or expanded, and `workdir` is interpolated unquoted [S1]. This path is currently human-triggered; an agent-triggered restart will exercise it far more often. *(inference from code; not exercised)*
- **"alive" means only "window exists".** `monitor.sh` writes `alive`/`dead` to `bg-<name>.state` from `tmux has-session` alone (`scripts/monitor.sh:571-581`); `buildBgStatuses` reports `windowPresent` from window inventory [S1][S3]. The window is created with `tmux new-window` and the command is typed into the resulting shell, so if the dev server exits or crashes the shell stays and the window remains present. *(inference from the spawn shape; the agent-side liveness precedent, `pane_current_command`, is documented in CLAUDE.md and already used for agents)* [S4]
- **Project-blind agent tooling.** `skills/dev-commands/scripts/dev-commands.sh` `list` reads `GET /api/status` and prints **every** bg process; `status`/`tail` take a bare name [S5]. No env var tells an agent its project: agents get only `CONDUCTOR_AGENT_NAME` (the window name, `<project>-<name>` for project agents), `CONDUCTOR_STATE_DIR`, `CONDUCTOR_LOG_DIR` (`index.ts:275`; `scripts/lib/db.sh:80`) [S1][S6]. The `CONDUCTOR_BG_NAME/LOG/STATE` env vars exist only for a single explicitly *linked* agent (`scripts/conductor.sh:63,81`) [S6]. The server can still map agent → project (`GET /agents` carries `projectId`/`projectName`).
- **Skill doc drift.** `SKILL.md` describes states "idle/busy/running", but `monitor.sh` only ever writes `alive`/`dead` for bg processes [S3][S5].
- **Log quality.** Output is captured by `tmux pipe-pane -o "cat >> $LOG_DIR/bg-<name>.log"` (`scripts/conductor.sh:96`, `index.ts:2029`): raw bytes, so ANSI escapes and carriage-return progress redraws are included, the file grows unbounded, and nothing marks where a restart happened (appends across restarts) [S1][S6]. `dev-commands.sh tail` is a plain `tail -n` of that file [S5]. There is no bg equivalent of the agent `GET /agents/:agent/tail` (rendered pane capture) route. *(inference for the ANSI/growth points)*
- **No auth by design** (single-user local host-server, per CLAUDE.md), so any agent can already call the mutating endpoints; project scoping of *restart* would be a guard the server adds, not something inherited [S4].
- **Naming.** `bg_processes.name` is globally `UNIQUE` and log/state files are keyed by bare name, so two projects cannot each have a bg process called `dev`. The prior scoping research deferred a per-project unique-index rebuild "until project-scoped creation is added" [S7].

## Key Findings

1. The literal request "link to a project" is largely satisfied by ROADMAP-020 [S1][S7]; the roadmap should not re-plan it, only close the residual gaps: legacy `NULL project_id` rows, the `linked_agent_id` overlap, and global name uniqueness.
2. Restart is the largest missing capability; it must be a single server-side operation so agents and the dashboard share one code path (and one place to fix the quoting/injection fragility) [S1][S2].
3. `tmux respawn-window -k` / `respawn-pane -k` restarts a command in place without recreating the window, and `remain-on-exit on` keeps a dead pane visible so exit status is inspectable [S8]. Whether the existing `pipe-pane` log attachment survives a respawn is **unverified** and needs a spike before choosing respawn over kill-window+new-window. A tmux bug report notes server crashes when `respawn-*` runs while a control-mode client is behind on the pane's output [S9]; low risk here (no control-mode clients) but a reason to prefer the simple kill+new-window path if the spike is inconclusive.
4. A restart trigger needs a trustworthy "is it actually running" signal; window presence is not it (see Current State). Adding `pane_current_command`-based liveness (`running` / `exited`) mirrors the existing agent liveness rule and keeps the state vocabulary honest [S3][S4].
5. Because agents cannot currently learn their project, resolving the caller's project **on the server** from `CONDUCTOR_AGENT_NAME` (sent as a header/query param by the script) avoids changing spawn env and works for already-running agents; exporting `CONDUCTOR_PROJECT_ID` at spawn is the simpler alternative but only reaches newly spawned agents [S1][S6].

## Constraints
- All code edits via Serena; host-server is `strict` TypeScript with `better-sqlite3`; new bg columns/uniqueness changes need a schema_version migration with a fixture test in `db.migration.test.ts` [S7].
- The skill script must stay self-contained (env vars + `curl`/optional `jq`, offline fallback), since it runs from arbitrary agent workdirs [S5].
- Must not fork the `bg-<name>.log` / `.state` conventions; restart must re-attach `pipe-pane` logging like `conductor.sh` does.
- Agents can be running mid-task; a restart must be an explicit action with an audit trail and a cooldown so an agent cannot restart-loop a shared dev server.

## Solution Comparison

| Criteria | A: Server-side restart + server-resolved project (recommended) | B: Skill script does kill+new-window itself via tmux | C: Export project env at spawn, script calls existing open/close |
|----------|------|------|------|
| Approach | New `POST /bg-processes/:name/restart`; script sends `CONDUCTOR_AGENT_NAME`; server checks caller project == bg project | Script runs tmux commands directly | Add `CONDUCTOR_PROJECT_ID`; script does DELETE then POST window |
| Pros | One code path for UI and agents; guard and audit centralized; fixes quoting once | No server change | No server-side caller resolution |
| Cons | Needs new route + caller resolution | Bypasses server, no guard/audit, duplicates spawn logic, tmux dependency in agent shells | Non-atomic; only new agents get the env; guard is client-side only |
| Complexity | Medium | Medium | Low-Medium |
| Codebase fit | High (mirrors `POST /agents/:id/window`) | Low (breaks host-server-owns-tmux pattern) | Medium |
| Maintenance | Low | High | Medium |

## Recommendation

**Option A**, phased:
1. **Backend primitives**: `POST /bg-processes/:name/restart` (single operation; safe quoting; re-attach `pipe-pane`; write a `--- restart <ts> ---` marker to the log; 409 during cooldown; audit line to a JSONL log with the caller agent); real liveness (`running`/`exited` via `pane_current_command`, surfaced in `BgStatus` and the state file); `GET /bg-processes/:name/tail` returning ANSI-stripped output. Spike `respawn-window -k` vs kill+new-window and pipe-pane survival first.
2. **Project-aware access**: server-side caller→project resolution; project-filtered `GET /projects/:id/bg-processes` reuse; guard restart to callers in the same project (unscoped/`NULL` rows: decision needed); decide fate of `linked_agent_id` and global name uniqueness.
3. **Agent skill**: `dev-commands.sh list` defaults to the caller's project (`--all` for everything), new `restart <name>`, `tail` with ANSI stripping, `status` reporting real liveness; fix `SKILL.md` state vocabulary. Installer already copies the skill dir.
4. **Dashboard**: Restart button and `exited` badge on the bg tile; show last restart time and who triggered it.
5. **Verification**: unit tests for the route and migration fixtures, `verify-dev-commands.sh` extension, UAT for agent-driven restart.

**Risks**: restart loops by an agent (cooldown + audit); `launchCmd` quoting (fix in the shared path); respawn/pipe-pane behavior (spike); name-collision across projects (decision).
**Alternative if constraints change**: if agents ever run outside the host (containers), switch caller resolution to a signed per-agent token.

## Next Steps
- `/roadmap-create` (this run) to sequence the phases above; then `/roadmap-next` to file tasks.
- Decisions to settle during planning: unscoped-row policy, `linked_agent_id` retirement, per-project name uniqueness.
