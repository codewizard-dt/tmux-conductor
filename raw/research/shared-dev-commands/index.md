---
topic: a way to list vital dev commands for a project in a format that agents of the same project have access to. agents can check to see if a specific dev process is running and check its output. examples would be "npm run dev" or "make dev" etc. these will run in their own tmux window but will be shared amongst all agents of that project. we may need a user-scoped skill with related bash script to do that efficiently. these commands would also be managed via the ui like agents are
slug: shared-dev-commands
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Shared, Project-Scoped Dev Commands for Agents

> tmux-conductor already has ~80% of this feature under the name "background processes" (`bg_processes`): named launch commands run in their own tmux window, with output captured to a log file and liveness written to a state file on every monitor poll, plus dashboard UI to add/remove/open/close them. What's actually missing is (1) project scoping — bg processes have no `project_id` today, so there's no way to say "these commands belong to this project" — and (2) an ergonomic, discoverable way for an *arbitrary* agent (not just a specially pre-linked one) to list/check/tail them from its own shell. There is also a live bug worth fixing first: the dashboard API and the shell scripts currently read bg-process definitions from two different, unsynced stores. Recommendation: fix the split-brain and add `project_id` to the existing `bg_processes` model (small, reuses proven code), then add a thin user-scoped skill + bash script that wraps the existing log/state-file conventions for agent-side discovery — no new registry, no new file formats, no new daemon.

## Research Questions
- What already exists in tmux-conductor for running/tracking shared, named dev processes, and how much of the ask does it already cover?
- Can an arbitrary agent (not a specially-linked one) already discover and check the output/liveness of a shared process, and if not, what's missing?
- Is there a project-scoping mechanism these commands could hook into, matching how agents/tasks/schedules are already scoped?
- Is the "user-scoped skill + bash script" pattern the right shape for the agent-side interface, and what does that convention look like in this ecosystem?
- Does "managed via the UI like agents" already have a home, or does it need new frontend surface?

## Current State (Codebase)

**The `bg_processes` mechanism already implements most of the ask**, under a different name and without project scoping:

- **Registry**: a background process is `name:workdir:launchCmd(+optional linked_agent_id)`, spawned as its own tmux **window** (`scripts/conductor.sh:90-99`, `scripts/spawn.sh` split-pane variant) — never dispatched to, never affects idle/usage shutdown logic (per `architecture/script-integration` Serena memory).
- **Output capture**: `tmux pipe-pane -t $SESSION:$name -o "cat >> '$LOG_DIR/bg-$name.log'"` at spawn time (`scripts/conductor.sh:97`, mirrored in `host-server/index.ts`'s `POST /bg-processes` handler at line 1797) — so `$LOG_DIR/bg-<name>.log` already holds the full captured output of every registered command, growing indefinitely (no rotation observed).
- **Liveness**: `scripts/monitor.sh:463-472` writes `alive`/`dead` to `$STATE_DIR/bg-<name>.state` on *every* poll tick (default `POLL_INTERVAL`, e.g. 15s), based on `tmux has-session -t "$SESSION:$bg_name"`.
- **Discovery env vars — but only for one "linked" agent**: `conductor.conf`'s `AGENT_BG_LINKS` maps at most one bg process to at most one agent; that agent alone gets `CONDUCTOR_BG_NAME`, `CONDUCTOR_BG_LOG`, `CONDUCTOR_BG_STATE` injected into its launch env (`scripts/conductor.sh:61-66`). Every *other* agent has no documented way to learn a bg process's name or resolve its log/state paths.
- **But every agent already gets the *directory* env vars**: `CONDUCTOR_STATE_DIR` and `CONDUCTOR_LOG_DIR` (absolute paths) are exported into *every* agent's launch environment regardless of workdir or link status (`scripts/conductor.sh:66,84`; confirmed by Serena memory `architecture/script-integration`). This means any agent can already reconstruct `$CONDUCTOR_LOG_DIR/bg-<name>.log` and `$CONDUCTOR_STATE_DIR/bg-<name>.state` for any *known* name — the missing piece is (a) knowing what names exist for its project, and (b) a documented command instead of ad hoc `cat`.
- **Host-server API**: `POST /api/bg-processes`, `DELETE /api/bg-processes/:name`, `POST/DELETE /api/bg-processes/:name/window` (`host-server/index.ts:1754-1882`). `GET /api/status` returns a `bgProcesses: BgStatus[]` array (`buildBgStatuses`, `host-server/index.ts:147-165`) with `name, workdir, launchCmd, windowPresent, state, logPath, statePath, linkedAgent`.
- **Dashboard UI**: `AddBgProcessForm.tsx` (create, with an "advanced" optional single-agent link picker) and `BgProcessSection`/`BgProcessRow` inside `AgentList.tsx` (lines ~1083-1191: status pill "running"/"window missing", open/close window, remove, with confirm dialogs) — i.e., bg processes are **already** managed via the UI much like agents are, just as one flat unscoped list rather than grouped/filterable by project.

**Gap 1 — a live split-brain bug in the current bg-process store.** Two different subsystems read/write bg-process *definitions* from two different places:
- The **shell scripts** (`conductor.sh`, `spawn.sh`, `monitor.sh`, via `scripts/lib/db.sh`'s `load_bg()`) load bg processes from **SQLite** (`SELECT name, workdir, launch_cmd FROM bg_processes`) — this is what actually gets spawned at session start and watched for liveness.
- The **host-server dashboard API** (`POST/DELETE /api/bg-processes`) reads/writes **`conductor.conf`'s `BG_PROCESSES` bash array** instead, via `appendBgProcessToConf`/`removeBgProcessFromConf` — with an explicit code comment: *"conductor.conf is authoritative for bg processes (what conductor.sh spawns and teardown.sh kills) — write the definition there, not the DB."* (`host-server/index.ts:1787-1789`)
- `host-server/db.ts`'s `createBgProcess`, `listBgProcesses`, `deleteBgProcess` functions exist and are fully implemented but have **zero callers** in `index.ts` — dead code from the TypeScript side (the SQLite table itself is still live, just only touched by the bash scripts via the `sqlite3` CLI, not through `db.ts`).
- **Net effect**: a bg process added through the dashboard is invisible to the *next* `conductor.sh` spawn and to `monitor.sh`'s liveness loop (both only ever read SQLite); a bg process seeded directly into SQLite is invisible to `GET /api/status`'s `bgProcesses` array (reads `conductor.conf` only, via `buildBgStatuses`/`readConductorConf`). CLAUDE.md's "Background processes are stored in the SQLite `bg_processes` table (not the `conductor.conf` `BG_PROCESSES` array)" and the Serena `architecture/script-integration` memory both describe the *old*, no-longer-accurate model — this is stale documentation *and* a functional inconsistency, not just a doc nit. *(inference: exact regression point not dated — not investigated further, out of scope for this research)*

**Gap 2 — no project scoping on bg processes.** `agents`, `tasks`, and `schedules` all carry a `project_id` foreign key (`host-server/db.ts` interfaces `Agent`, `Task`, `Schedule`), and the frontend already has per-project grouping (`ProjectList.tsx`) and per-project scoped forms (`AddAgentForm.tsx`, `AddTaskForm.tsx`). `bg_processes` never got this column — its `BgProcess` interface is `{ id, name, workdir, launchCmd, linkedAgentId }`, and the `conductor.conf` array entry is bare `name:workdir:cmd`. So "commands that agents *of the same project* have access to" has no structural home today: every bg process in a session is visible to every agent in that session, with no project filter.

**Gap 3 — no documented agent-side discovery command.** Nothing today lets an agent ask "what dev commands exist for my project?" — an agent would have to already know a specific bg-process name (from being told, or from reading `conductor.conf`, which agents are not normally pointed at) and manually reconstruct file paths by convention. There is no `list`, no `tail -f`-style helper, no cross-check between the (possibly up-to-`POLL_INTERVAL`-seconds-stale) state file and live `tmux has-session`.

## Key Findings

- The requested feature is >80% already built under the `bg_processes` name — pipe-pane output capture and poll-driven alive/dead state files are the exact mechanism needed for "check if running" and "check its output" [S1][S2].
- This is not a bespoke pattern: `tmux`-window-per-process plus captured pane output is the same core idea used by mature Procfile-style process managers (Overmind, spiritual successor to Foreman) specifically *because* piping a process's own stdout to a file (rather than redirecting descriptors at spawn) avoids buffering/color-loss artifacts that plain `> file` redirection causes — validating the existing `pipe-pane` choice as the right primitive rather than something to replace [S3][S4].
- A current, real bug: the dashboard API's bg-process CRUD and the shell scripts' bg-process loader read from two unsynced stores (`conductor.conf` vs SQLite) — confirmed via an explicit code comment in `host-server/index.ts` asserting conductor.conf is authoritative, contradicted by `scripts/lib/db.sh`'s `load_bg()` reading only SQLite [S1][S5].
- `bg_processes` has no `project_id`; every other shared/dispatchable entity in the schema (`agents`, `tasks`, `schedules`) does [S1].
- Anthropic's own Skills docs and observed community practice ("the System Skill Pattern") describe exactly the shape asked for: a `SKILL.md` plus a bundled `scripts/` directory containing an executable wrapper that Claude runs via Bash and receives only the output of — appropriate for a thin CLI over the existing log/state-file conventions [S6][S7].

## Constraints

- Any solution must not duplicate the tmux-window-per-process + pipe-pane + poll-driven state-file mechanism that already exists — extending it is far cheaper than reinventing it, and duplicating it would recreate the exact split-brain problem described in Gap 1 at a different layer.
- `POLL_INTERVAL`-driven staleness: the `bg-<name>.state` file is only as fresh as the last monitor tick (default cadence per existing conf), so any "is it running" check that trusts the file alone can lag reality by that interval; a live `tmux has-session` cross-check is cheap and already used elsewhere in the codebase (`isTmuxWindowPresent`).
- tmux window names are session-global — bg-process names must stay unique against both other bg processes and agent window names in the same session (existing constraint, documented in CLAUDE.md and enforced by `isTmuxWindowPresent`/`conf.bgProcesses.some(...)` checks in the `POST /bg-processes` handler); adding `project_id` does not relax this, since tmux itself has no project concept.
- `.env` files are off-limits to read or write per project policy — not relevant to this feature's data (no secrets involved) but worth noting as a standing constraint on any script this research proposes.
- Per repo convention, all host-side scratch/temp work must live under `./tmp/`, not `/tmp` — applies to any prototyping of the new script.

## Solution Comparison

| Criteria | A. Extend existing `bg_processes` (fix split-brain + add `project_id`) + thin skill/script wrapper | B. Build a new parallel "dev-commands" registry (new table, new conf keys, new UI section) | C. Skill/script only — read `conductor.conf`/glob files as-is, no DB or UI change |
|---|---|---|---|
| **Approach** | Fix Gap 1 (single SQLite source of truth, matching what scripts already do), add `project_id` column + route/UI plumbing, then a `~/.claude/skills/` wrapper over the existing log/state conventions | Add a second, independent "dev commands" concept alongside `bg_processes`, duplicating tmux-window spawn, pipe-pane capture, and state polling | Ship only the agent-facing skill/script; leave the backend/DB/UI untouched |
| **Pros** | Reuses a proven, already-tested mechanism; fixes a real existing bug; one mental model for "shared process" in DB, scripts, and UI; matches the `project_id` pattern already used everywhere else | No risk to existing bg-process behavior while building the new thing | Fastest to ship; zero backend risk |
| **Cons** | Touches tested route/migration code (`host-server/index.ts`, `db.migration.test.ts`, `AgentList.test.tsx` fixtures) — needs care, not a pure additive change | Two near-identical systems to maintain and explain; does not fix the split-brain bug; directly duplicates a feature the user is describing | Doesn't satisfy "managed via the UI like agents are" (explicit ask); doesn't add project scoping, so an agent still can't reliably enumerate *its project's* commands; script has to either re-implement conductor.conf parsing or keep depending on the buggy store |
| **Complexity** | Medium | Medium–High | Low |
| **Dependencies** | None new | None new, but more surface area | None new |
| **Codebase fit** | High — directly continues the `project_id` pattern already on agents/tasks/schedules | Poor — redundant with an existing, named feature | Partial — leaves two of three asked-for capabilities (UI management, project scoping) unaddressed |
| **Maintenance** | Low — same surface, correctly scoped | High — two systems to keep in sync indefinitely | Low now, but accrues debt once project scoping is inevitably requested later |

## Recommendation

**Recommended approach: Option A.**

Implementation outline:

1. **Fix the split-brain (prerequisite).** Make SQLite the single source of truth for bg-process *definitions*, matching what the shell scripts already assume. In `host-server/index.ts`, change `POST /bg-processes` and `DELETE /bg-processes/:name` to call the already-written-but-unused `createBgProcess`/`deleteBgProcess` from `db.ts` instead of `appendBgProcessToConf`/`removeBgProcessFromConf`; change `readConductorConf()`'s `bgProcesses` field (and `buildBgStatuses`) to source from `listBgProcesses(db)` instead of parsing `conductor.conf`'s `BG_PROCESSES` array. This removes a real, currently-live inconsistency and is a prerequisite for reliable project scoping (there's no point scoping a definition that two code paths disagree about).
2. **Add `project_id` to `bg_processes`.** A migration (same pattern as the existing `agents_v2`/`tasks_v8` migrations in `db.ts`'s `runMigrations`) adding `project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL`. Extend `BgProcess`/`BgProcessRow`/`mapBgProcess` accordingly.
3. **Expose project-filtered listing.** Add a `projectId` filter to `GET /api/status`'s `bgProcesses`, or a dedicated `GET /api/projects/:id/bg-processes`, so both the UI and the new script can ask "what's registered for project X."
4. **Extend the UI minimally.** Add a required Project select to `AddBgProcessForm.tsx` (same pattern as `AddAgentForm.tsx`), and group `BgProcessSection` by project in `AgentList.tsx`/`ProjectList.tsx` — the row component, status pill, and open/close/remove actions already exist and need no redesign.
5. **Ship the user-scoped skill + script.** `~/.claude/skills/dev-commands/SKILL.md` + `scripts/dev-commands.sh`, following the standard Skill bundling convention (`SKILL.md` + `scripts/`, per Anthropic's own docs) [S6]. The script:
   - Resolves `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` from the environment — already exported into every agent's pane today, no new plumbing needed.
   - `list` — calls `GET /api/projects/:id/bg-processes` (falls back to globbing `$CONDUCTOR_STATE_DIR/bg-*.state` if the host-server is unreachable) to enumerate this project's registered commands.
   - `status <name>` — reports the `bg-<name>.state` contents *and* a live `tmux has-session` cross-check, explicitly labeling which is which so an agent doesn't trust a stale file blindly.
   - `tail <name> [-n N]` — `tail -n N "$CONDUCTOR_LOG_DIR/bg-<name>.log"`.
   - Reuses 100% of the existing file conventions (`bg-<name>.log`, `bg-<name>.state`, `alive`/`dead`) — no new file formats, no new polling loop, no new daemon.

Risks and mitigations:
- **Migration/route change touches tested code.** `AgentList.test.tsx` has `BgProcess` fixtures and `host-server/db.migration.test.ts` already exercises schema migrations — extend both rather than skip them; run the full suite before merging the split-brain fix.
- **Stale liveness.** State file lags by up to one `POLL_INTERVAL`; the script's `status` subcommand should cross-check live `tmux has-session` rather than trust the file alone (mirrors what `host-server`'s own `detectAgentStatus`-style checks already do for agents).
- **Name collisions.** tmux window names remain session-global regardless of `project_id` — keep enforcing name uniqueness at insert time across *all* bg processes and agents in a session, not just within a project.
- **Unbounded log growth.** `bg-<name>.log` files are append-only with no observed rotation — out of scope for this feature but worth flagging if "vital dev commands" run for long sessions; not investigated further here.

**Alternative if constraints change:** if there's a hard reason `conductor.conf` must remain the bash-consumable definition of truth (e.g., an external tool depends on parsing it directly — not observed in this codebase), Option A's step 1 could instead *sync* conductor.conf from SQLite on every write rather than fully cutting over; this reintroduces a (now-consistent, one-directional) split but avoids changing what the bash scripts read. Not recommended unless such a dependency is confirmed, since no such consumer was found in this research.

## Next Steps

- `/task-add Fix bg_processes split-brain: make SQLite the single source of truth for bg-process CRUD in host-server/index.ts (currently writes to conductor.conf while scripts/lib/db.sh reads SQLite)`
- `/task-add Add project_id to bg_processes (migration + BgProcess/BgProcessRow/mapBgProcess + project-filtered listing endpoint) and thread a project selector through AddBgProcessForm.tsx / BgProcessSection`
- `/task-add Create a user-scoped ~/.claude/skills/dev-commands skill + bash script that lists/status/tails a project's bg processes via the existing bg-<name>.log / bg-<name>.state conventions`
- If the split-brain fix feels riskier than expected once scoped, consider `/decision-create` to record the "SQLite authoritative vs conductor.conf authoritative" choice explicitly before touching the routes, since it reverses a decision a past commit deliberately made (per the code comment in `host-server/index.ts:1787-1789`).
