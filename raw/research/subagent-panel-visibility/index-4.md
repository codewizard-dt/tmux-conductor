---
topic: How to guarantee the agent-teams/naming preference reaches every agent tmux-conductor spawns into other projects, not just this repo
slug: subagent-panel-visibility
researched: 2026-09-13
sources: [./sources-4.md]
---

# Research: Wiring the preference through tmux-conductor's own launch-command storage

> Builds on [index-3.md](index-3.md), which recommended `~/.claude/rules/agent-teams-preference.md` (global, reaches every project) plus an optional `--append-system-prompt-file` baked into each agent's launch command for a more surgical, conductor-only guarantee. This pass traces exactly *where* that launch command lives and is constructed in the actual codebase, since the user specifically wants it to reach agents in **other** projects tmux-conductor spawns, not just this repo.

**The launch command is not a script constant — it's a per-agent, per-project value already stored in SQLite, and both real spawn paths just interpolate whatever string is stored there verbatim.** This means the surgical fix from `index-3.md` doesn't require touching `conductor.sh`, `spawn.sh`, or `host-server/index.ts`'s dispatch logic at all — it requires updating the **stored `launch_cmd` values themselves** (one default for future projects, one bulk update for existing agents), because every spawn path already just types out `agent.launchCmd`/`AGENT_CMDS["$name"]` unmodified into the pane.

## Research Questions
- Where does an agent's `launch_cmd` actually come from, and is it fixed at creation time or resolved dynamically from its project on every spawn?
- How many distinct code paths turn a stored launch command into a live tmux pane, and do they all read the same stored value?
- Does tmux-conductor already have a way to distinguish "this is a Claude Code agent" from Codex/Aider/custom agents at the point a launch command is dispatched, so an injected flag doesn't corrupt non-Claude agents?
- Given all that, what's the minimal, correct set of edits to make the `--append-system-prompt-file` preference (from `index-3.md`) reach every current and future Claude Code agent tmux-conductor spawns, across every project?

## Current State (Codebase)

- **`agents.launch_cmd`** is a required, frozen string captured once at agent-creation time — never re-derived from its project afterward. `createAgent()` (`host-server/db.ts:581-596`) inserts whatever `launchCmd` string it's given; there is no join back to `projects.default_launch_cmd` on read [S1].
- **`projects.default_launch_cmd`** exists purely as a *template* for new agents, not a live default: `POST /projects/:id/agents` resolves `const launchCmd = typeof launchCmdOverride === 'string' ? launchCmdOverride.trim() : project.defaultLaunchCmd` (`host-server/index.ts:2116`) [S2] — i.e. it's copied into the new agent's own frozen `launch_cmd` at that moment. Editing a project's `default_launch_cmd` later has **zero effect on agents already created** under that project.
- **The frontend never actually relies on the backend's fallback default.** `AddProjectForm.tsx`'s `defaultLaunchCmd` state initializes to a `DEFAULT_LAUNCH_COMMAND` constant and is a controlled input — the form always submits an explicit string, so `createProject()`'s own `?? 'claude --dangerously-skip-permissions'` fallback (`host-server/db.ts:497`) is dead code in practice for anything created through the UI [S6]. There are three places the literal default string currently lives: the SQL schema `DEFAULT` (`db.migration.test.ts:128`), the `db.ts` JS fallback, and this frontend constant [S1][S6].
- **Exactly two code paths turn a stored launch command into a live tmux pane**, and both are dumb interpolation — neither parses or validates the command beyond what's needed for agent-type detection elsewhere:
  1. `scripts/conductor.sh` / `scripts/spawn.sh` (bash, batch startup): `load_agents()` populates `AGENT_CMDS["$name"]` straight from SQLite (`scripts/lib/db.sh:44-57`), and `tmux send-keys -t "$SESSION_NAME:$window_name" "$env_prefix $launch_cmd" Enter` types it in literally [S5].
  2. `host-server/index.ts`'s live single-agent spawn function (dashboard "Add Agent" flow, no restart required): builds `launchText = "CONDUCTOR_AGENT_NAME=... ${agent.launchCmd}"` and sends it via `tmux send-keys -t target -l -- launchText` (`host-server/index.ts:257-273`) [S2].
  A third path (`bg_processes`) also interpolates a stored `launch_cmd` the same way, but bg processes are arbitrary dev-server commands, never Claude Code agents, and out of scope here.
- **Both paths (and several others) already detect "is this agent a Claude Code session" from the launch command string**, for an unrelated purpose (idle/busy pattern selection): `scripts/monitor.sh`'s `launch_cmd_name()` (bash, lines 113-123) extracts the first word of the command, skipping `VAR=value` prefixes [S4]; `host-server/state.ts`'s `detectAgentType(launchCmd): 'claude' | 'codex' | 'custom'` (lines 251-256) does the TS-side equivalent, and is already called at every status-computation site in `host-server/index.ts` [S3]. Both exist independently (no shared implementation across the bash/TS boundary), but both already solve exactly the "don't corrupt a Codex/custom agent's command" problem an injected flag would need to avoid.

## Key Findings

1. **No source-code change is required to make the preference reach every project — only a data change.** Since every spawn path blindly types out the stored `launch_cmd`/`launchCmd` string, appending `--append-system-prompt-file ~/.claude/rules/agent-teams-preference.md` to that *stored value* is sufficient; there is no separate "template" the dispatch code applies on top. This is a materially simpler answer than modifying `conductor.sh`, `spawn.sh`, and `host-server/index.ts` in three places to inject a flag at dispatch time.

2. **"Passed onto other agents from other projects" requires touching data in three places, not one, because the default is copy-on-create, not live-joined:**
   - The three literal-default sites (SQL schema `DEFAULT`, `db.ts`'s `createProject` fallback, `AddProjectForm.tsx`'s `DEFAULT_LAUNCH_COMMAND`) need the flag added so **every newly created project from now on** prefills agents with it.
   - **Every already-existing agent row**, across every already-existing project, has its own frozen `launch_cmd` from before this change and needs a one-time backfill — editing the project's `default_launch_cmd` after the fact does not reach them (finding above).
   - **Every already-existing project's own `default_launch_cmd`** should also be backfilled, so an agent added to that project tomorrow (without an override) inherits the flag too, not just brand-new projects.

3. **The backfill must be conditional on agent type, reusing logic that already exists in two different languages.** A blind string-append to every `agents.launch_cmd` row would corrupt any Codex/Aider/custom-command agent (`--append-system-prompt-file` is a Claude-Code-only flag). `launch_cmd_name()` (bash) / `detectAgentType()` (TS) already answer "is this a `claude` command" correctly and are the right gate to reuse — a migration script can either shell out through the same first-word-extraction logic `launch_cmd_name()` implements, or (more simply, since this is a one-off SQLite operation) filter rows with a `WHERE launch_cmd = 'claude' OR launch_cmd LIKE 'claude %'`-style match mirroring the same "first word is exactly `claude`" rule those functions encode, then skip any row that already contains the flag (idempotency, in case the migration is re-run).

4. **This is the same underlying value `index-3.md`'s Option C already pointed at** — that pass recommended baking `--append-system-prompt-file` into "the stored `launch_cmd` template," inferring conductor.sh's dynamism from `AGENT_CMDS`/`load_agents` alone. This pass confirms the mechanism goes one level deeper (a SQLite-backed, per-agent-frozen value with a copy-on-create project template, plus a second independent live-spawn path in `host-server/index.ts` that pass hadn't yet traced) and that both existing spawn paths already share the same "just interpolate the stored string" behavior, so a single data fix (not a code fix in two languages) is sufficient.

## Constraints
- `launch_cmd`/`launchCmd` values are also displayed verbatim in the UI (`ProjectList.tsx`, `ProjectDetailPage.tsx` show `project.defaultLaunchCmd` directly) — appending a long `--append-system-prompt-file <path>` flag will show up in those displays too; this is cosmetic, not a functional risk, but worth expecting.
- No SSE event exists for project mutations (`updateProject`) per prior task history [S2 cross-reference in codebase] — a bulk backfill of `projects.default_launch_cmd` won't push a live UI update; the dashboard's `ProjectList` only re-fetches on its own mutations or mount, so existing open dashboard tabs would need a refresh to see the new default reflected, though this has no bearing on already-spawned agents either way.
- A currently-running agent's pane is unaffected by any of this until it's next spawned fresh (killed and recreated, or a brand-new agent added) — editing `launch_cmd` in the DB does not retroactively alter an agent's pane that's already running with the old command.
- Whatever path is chosen must not touch `bg_processes.launch_cmd` rows — those are never Claude Code sessions and the flag would be meaningless there.

## Recommendation

**Treat this as a two-part data fix, gated by the same "is this a `claude` launch command" rule the codebase already encodes twice:**

1. **Forward-looking default**: update the three literal-default sites (SQL migration `DEFAULT`, `db.ts`'s `createProject` fallback string, `AddProjectForm.tsx`'s `DEFAULT_LAUNCH_COMMAND`) from `'claude --dangerously-skip-permissions'` to `'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md'` (or whatever the final rule-file path is), so every new project and every agent added under it from now on carries the flag automatically.
2. **One-time backfill**: a small script (or a single `host-server` maintenance route) that iterates every existing `agents` row and every existing `projects` row, checks `detectAgentType(launch_cmd) === 'claude'` (or the bash equivalent), skips any row whose `launch_cmd` already contains `--append-system-prompt-file`, and appends the flag to the rest. This is the only way already-existing agents in already-existing other-project rows pick up the preference — no amount of editing `~/.claude/rules/` or `conductor.sh` reaches them, because their `launch_cmd` was already frozen before this change.
3. **Keep the global `~/.claude/rules/agent-teams-preference.md` file from `index-3.md` too, as defense in depth** — it covers the (likely rare) case of an agent launched with a hand-typed command that skips the stored-`launch_cmd` path entirely (e.g. a manually opened tmux window running `claude` outside conductor's own spawn functions), and reinforces the same content at both the context layer (rules file) and the system-prompt layer (`--append-system-prompt-file`) for everything conductor itself spawns.

### Risks / residual gaps
- Not verified in this pass: whether any other code path constructs `launch_cmd` besides `createAgent`/`createProject`'s handlers (e.g. a CLI import/seed script) — a full-repo grep for every `INSERT INTO agents` / `INSERT INTO projects` call site would close this gap before actually running a backfill.
- The exact backfill mechanism (raw SQL via `sqlite3` CLI vs. a small Node script reusing `detectAgentType` vs. a temporary host-server route) was not chosen here — this stays a research-level recommendation, not an implementation, per this skill's scope.

## Next Steps
- `/task-add` candidate: "Add `--append-system-prompt-file ~/.claude/rules/agent-teams-preference.md` to the default Claude launch command (schema default, `db.ts` fallback, `AddProjectForm.tsx` constant) and backfill every existing `claude`-type row in `agents`/`projects` with the same flag, gated by `detectAgentType`/`launch_cmd_name`." This is the concrete implementation of both this pass and `index-3.md` combined.
- Prerequisite (not yet done, per the prior report): actually write `~/.claude/rules/agent-teams-preference.md` — the task above assumes that file exists at the path the flag points to.
