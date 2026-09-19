---
id: TASK-0166
aliases: [TASK-0166]
title: "Wire the agent-teams naming preference into every Claude Code agent's launch command"
status: in-progress
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [host-server, frontend, agent-teams, migration]
---

# TASK-0166 — Wire the agent-teams naming preference into every Claude Code agent's launch command

## Objective

Make every Claude Code agent tmux-conductor spawns — in this repo and in any other project — carry the "always name your parallel `Agent(...)` calls" preference at the system-prompt level via `--append-system-prompt-file`, without touching Codex/custom agents. This closes out the research in `raw/research/subagent-panel-visibility/index.md` through `index-4.md`: `agents.launch_cmd` is frozen at creation time and both real spawn paths (`scripts/conductor.sh`/`spawn.sh`'s `AGENT_CMDS`, and `host-server/index.ts`'s live single-agent spawn function) just interpolate the stored string verbatim, so this is a **data fix** (the stored launch-command strings, going forward and backfilled), not a change to spawn/dispatch logic.

## Approach

1. Write the actual instruction content once, at `~/.claude/rules/agent-teams-preference.md` (outside this repo, user-level — loads unconditionally for every project on this machine, same mechanism as the user's existing `~/.claude/rules/lsp-first.md`). This file is the target the launch-command flag points at.
2. Update the **single frontend source of truth** for the default Claude launch command: `frontend/src/lib/launchCommands.ts`'s `LAUNCH_COMMAND_PRESETS[0].command` (currently `'claude --dangerously-skip-permissions'`). `DEFAULT_LAUNCH_COMMAND` and `commandForPreset('claude')` both derive from this array element, so editing it here is sufficient on the frontend — no separate constant to touch. **Caution**: `presetForCommand()` (same file) does an *exact string match* against `LAUNCH_COMMAND_PRESETS[*].command` to decide which preset a stored command matches in the UI dropdown — since it reads from the same array, this stays self-consistent as long as every "claude" preset comparison goes through this one array, but verify no other file hardcodes the literal string `'claude --dangerously-skip-permissions'` for a *comparison* (as opposed to a first-word/prefix check) that this change would silently break.
3. Update the **two backend defaults** in `host-server/db.ts`:
   - The live schema's `CREATE TABLE projects` statement (`db.ts:289`), `default_launch_cmd TEXT NOT NULL DEFAULT 'claude --dangerously-skip-permissions'` → append the flag. **Do not touch the historical schema snapshots in `host-server/db.migration.test.ts` (lines ~128, ~225, ~917)** — those are fixtures representing old schema versions on purpose, used to test forward migrations; changing them would corrupt what those tests verify.
   - `createProject()`'s JS fallback (`db.ts:497`), `data.defaultLaunchCmd ?? 'claude --dangerously-skip-permissions'` → append the flag. (Low practical impact today since the frontend form always sends an explicit value per step 2's file, but keep it consistent for any other caller, e.g. `curl`/API scripts, that omits `defaultLaunchCmd`.)
4. Write a one-off, idempotent backfill script (e.g. `scripts/backfill-agent-teams-flag.mjs`, run once via `node` against the live `better-sqlite3` DB at the path `conductor.conf`/`CONDUCTOR_DB` resolves) that:
   - Opens the same SQLite DB `host-server/db.ts` uses.
   - For every row in `agents` and every row in `projects`, extracts the first whitespace-separated token of `launch_cmd`/`default_launch_cmd`, skipping any leading `VAR=value` assignments — mirror `host-server/state.ts::detectAgentType`'s `launchCommandBasename`/`scripts/monitor.sh::launch_cmd_name`'s logic exactly (first non-`VAR=value` word) rather than re-deriving new detection rules.
   - Only touches rows whose first token is exactly `claude`.
   - Skips (no-ops) any row whose `launch_cmd`/`default_launch_cmd` already contains `--append-system-prompt-file`, so the script is safely re-runnable.
   - Appends ` --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md` to every remaining matching row and reports a summary count of rows updated per table.
   - Never touches `bg_processes.launch_cmd` rows (never Claude Code agents).
5. Run the backfill script once against the live DB and record the row counts it reports in this task file's Notes before closing it out.

## Steps

### 1. Write the global rule file <!-- agent: general-purpose -->

- [x] Create `~/.claude/rules/agent-teams-preference.md` (no `paths:` frontmatter, so it loads unconditionally) stating: when dispatching multiple `Agent(...)` tool calls for parallel work, always pass an explicit, descriptive `name` to each call. Briefly note why (agent teams is enabled machine-wide via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `~/.claude/settings.json`; a named call becomes a full teammate with a panel row that persists while siblings are still working, instead of a plain subagent's row that clears the instant it finishes). Cross-reference `raw/research/subagent-panel-visibility/` in `tmux-conductor` for the full mechanism.
- [x] Add a short (3-5 line) cross-referencing section to this repo's own root `CLAUDE.md` pointing at the new global rule file, so anyone reading this project's own docs sees the convention without needing `~/.claude/rules/` visible to them.

<!-- Updated: 2026-09-17 -->
<!-- Created ~/.claude/rules/agent-teams-preference.md (no paths: frontmatter, matching lsp-first.md's format) — states the naming convention, why (agent teams env var, teammate row persistence, @mention/SendMessage addressability), and cross-references raw/research/subagent-panel-visibility/index.md. Added a new "## Agent Dispatch Convention" section to CLAUDE.md, right before "## MCP Tool Rules". Both files verified by direct read after the sub-agent's report — content matches exactly, no unexpected/injected content despite a harness-level "instruction-shaped pattern" flag on the sub-agent's own output text (verified as a false positive: the flag was almost certainly triggered by the literal string CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 near "settings.json" in prose, not any actual injected directive). -->

### 2. Update the frontend launch-command source of truth <!-- agent: general-purpose -->

- [x] In `frontend/src/lib/launchCommands.ts`, change `LAUNCH_COMMAND_PRESETS[0].command` from `'claude --dangerously-skip-permissions'` to `'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md'`.
- [x] Grep the frontend for any other literal occurrence of `'claude --dangerously-skip-permissions'` used in a string-equality comparison (not just displayed) that this change could silently break, and fix or note any found.

<!-- Updated: 2026-09-17 -->
<!-- LAUNCH_COMMAND_PRESETS[0].command updated with the appended flag; verified directly by reading the file after the sub-agent's report (a second harness "instruction-shaped pattern" flag on this sub-agent's output was again a false positive — triggered by the literal string --dangerously-skip-permissions, which is genuinely part of the launch command text being edited, not an injected directive). No other literal-comparison occurrences found in the frontend (only rendering consumers in AddAgentForm.tsx/AddProjectForm.tsx). tsc --noEmit clean. -->

### 3. Update the backend defaults <!-- agent: general-purpose -->

- [x] In `host-server/db.ts:289`, update the `CREATE TABLE projects` statement's `default_launch_cmd` column `DEFAULT` value to include the same appended flag.
- [x] In `host-server/db.ts:497` (`createProject`'s `data.defaultLaunchCmd ?? '...'` fallback), update the fallback string the same way.
- [x] Do **not** modify the schema snapshots inside `host-server/db.migration.test.ts` (the pre-v3/pre-v7/pre-v8/pre-v9-style fixtures around lines 128/225/917) — confirm the full host-server test suite (`npm test` or equivalent in `host-server/`) still passes unmodified after steps 3's edits, since those fixtures intentionally simulate old schema state.

<!-- Updated: 2026-09-17 -->
<!-- db.ts:290 (CREATE TABLE projects DEFAULT) and db.ts:498 (createProject's fallback) both updated with the appended flag (actual lines one higher than the task's 289/497 estimates). db.migration.test.ts's 3 historical schema fixtures (lines 128/225/917) confirmed untouched by direct re-search after editing. DISCOVERED GAP, fixed as a natural extension of this same step (same safety profile — a static default string, no DB/spawn effect): host-server/index.ts:1007's POST /agents route has its OWN separate destructuring default (`launchCmd = 'claude --dangerously-skip-permissions'`) that this task's Approach section never enumerated as one of "the two backend defaults" — but it's a direct agent-creation path bypassing createProject entirely, so leaving it unfixed would defeat this task's own stated goal for any agent created via that route without an explicit launchCmd. Fixed to match (verified this is the only such occurrence via a fresh search — one unrelated comment mention at line 1169 is not a default and was left alone). host-server tsc --noEmit clean; npm test 159/159 pass. Two harness "instruction-shaped pattern" flags on this step's sub-agent output (both triggered by the literal string "--dangerously-skip-permissions" appearing in normal prose describing the edit) verified as false positives by direct file reads. -->

### 4. Write and run the one-off backfill script <!-- agent: general-purpose -->

- [x] Create `scripts/backfill-agent-teams-flag.mjs` per the Approach section's spec: opens the live SQLite DB via `better-sqlite3`, applies the same "first token is exactly `claude`" detection `state.ts::detectAgentType`/`monitor.sh::launch_cmd_name` already use, skips rows already containing the flag, appends it to `agents.launch_cmd` and `projects.default_launch_cmd` for matching rows, prints a per-table summary of rows updated/skipped.
- [BLOCKED: needs explicit human confirmation before running] Run the script once against the live DB (`DB_PATH`/`CONDUCTOR_DB` as resolved by `conductor.conf`) and paste the summary output into this task file's Notes section below.
- [BLOCKED: depends on the previous line running first] Spot-check via `sqlite3` (or the dashboard) that at least one pre-existing Claude Code agent's `launch_cmd` now contains the flag, and that a Codex/custom-command agent (if any exist) was left untouched.

<!-- Updated: 2026-09-17 -->
<!-- scripts/backfill-agent-teams-flag.mjs written and verified (node --check clean, and manually reviewed the full source): mirrors state.ts's launchCommandName/launchCommandBasename detection exactly, resolves the DB path the same way db.ts/config.ts do (CONDUCTOR_DB env, else conductor.conf's DB_PATH sourced safely via execFileSync argv — no shell-injection risk), idempotent via a FLAG_MARKER check, wraps each table's updates in a db.transaction, never touches bg_processes. DELIBERATELY NOT RUN: this environment has a live, shared conductor session with real running agents and real project data across multiple unrelated projects (bootstrap, cryptwiz, wetware, etc.) — running this backfill would permanently mutate every existing agent's/project's launch_cmd row across the whole machine, a real, cross-project, unreverted mutation that needs explicit human awareness before it happens, not an unattended background action. This is a judgment call, same category as skipping TASK-133 and deferring TASK-151's live-agent-creation UAT case — flagged, not silently run or silently skipped. The script is ready for a human to run (`node scripts/backfill-agent-teams-flag.mjs`) whenever they choose. -->

### 5. Verify end-to-end <!-- agent: general-purpose -->

- [BLOCKED: requires running Step 4's backfill and/or spawning a real new agent, both deliberately left for human execution — see Step 4's note] Add a new project via the dashboard's "Add Project" form (or `POST /api/projects` with no `defaultLaunchCmd`) and confirm the created project's `default_launch_cmd` contains the flag.
- [BLOCKED: same reason] Spawn a new agent under that project and confirm (via `sqlite3` or `GET /api/agents`) its `launch_cmd` carries the flag, then verify the flag actually reaches the live pane (start the agent, run `/context` in it, confirm the rule file's memory content loaded — or simpler, confirm the literal `claude ...` command line typed into the pane includes the flag).
- [x] Run the host-server test suite + `tsc --noEmit` (or this repo's standard typecheck command) to confirm nothing broke.

<!-- Updated: 2026-09-17 -->
<!-- Static gates already confirmed clean during steps 2-3 (host-server tsc --noEmit clean, 159/159 tests; frontend tsc --noEmit clean). The two live-verification bullets require either running Step 4's backfill or spawning a brand-new real tmux agent — both deliberately deferred to a human, per Step 4's note. -->

## Notes

<!-- Record the backfill script's summary output here after running it in Step 4. -->
<!-- STATUS: Steps 1-3 fully complete and verified (rule file, frontend default, backend defaults + one extra gap found and fixed at index.ts's POST /agents route). Step 4's script is written and ready but deliberately not executed. Step 5 is blocked on that same human decision. This task is intentionally left `in-progress`, not `pending-uat` — the remaining work is a real, cross-project live-database mutation plus spawning a real agent, not something to auto-progress through an unattended /loop cycle. To finish: review scripts/backfill-agent-teams-flag.mjs, run it, then complete Step 5's two live-verification bullets. -->

