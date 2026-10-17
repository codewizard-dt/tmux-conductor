---
topic: "how to differentiate actual user input."
slug: differentiate-actual-user-input
researched: 2026-09-20
---

# Primary Sources — Telling Genuine User Input Apart From Everything Else an Agent Receives

Builds on [../last-user-message-capture/sources.md](../last-user-message-capture/sources.md); sources already registered there are not repeated. Serena line numbers are approximate.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/71364f71-a163-451a-9b07-7c137a63f865.jsonl` (this session's transcript, `jq` tallies pinned to this file) | 2026-09-20 | Real provenance values on user records: typed → `origin.kind:"human"`, `promptSource:"typed"`; typed slash commands → `human`/null with `<command-name>` wrapper; 48 peer messages → `origin` null, `promptSource` null; `/clear` wrapper and `[Request interrupted by user]` → null/null; no hook-execution records in the transcript |
| S2 | codebase | `wiki/work/tasks/TASK-0219-verify-userpromptsubmit-payloads.md` — `## Findings` | 2026-09-20 | Claude Code 2.1.278 payload keys incl. `prompt_id`; single-line `send-keys` dispatch byte-identical to typed; slash-command and paste behaviour; built-ins fire nothing; Up-recall not determined |
| S3 | codebase | `host-server/index.ts::dispatchTaskToAgent` (~L537–585: `dispatchRecord` appended to `dispatch.jsonl` before `sendDispatchToPane`); `host-server/state.ts::sendDispatchToPane`; `scripts/monitor.sh` (`DISPATCH_LOG`) | 2026-09-20 | The conductor writes `{ts, agent, command, …}` before typing; project-kind tasks send `/clear` first; monitor.sh writes the same log |
| S4 | codebase | `host-server/index.ts::sendDirectInput` (~L618–686) | 2026-09-20 | Dashboard Direct Input keystrokes reach the pane through a server-side function, so the server can see human input sent from the dashboard |
| S5 | codebase | `hooks/lib/write-state.js::writeState`; installed copy `~/.claude/hooks/tmux-conductor/lib/write-state.js` (read L85–115); `host-server/context.ts::resolveTranscriptPath` | 2026-09-20 | Repo hook persists `last_prompt` with no sender notion; installed copy still has the old sidecar merge (no `last_prompt`); server already pins and reads each agent's transcript |
| S6 | codebase | `host-server/index.ts` spawn (~L311 `winName`, ~L322 `CONDUCTOR_AGENT_NAME=…`) and rename handler (~L1517–1531); `host-server/db.ts::agentWindowName` (L34–36); `scripts/conductor.sh` (~L60), `scripts/spawn.sh` (~L51) | 2026-09-20 | Hook key equals server read key at spawn; rename renames the tmux window and `<win>.state` but not `<win>.meta.json` |
| S7 | codebase | `host-server/db.ts` — `CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY, …)` (~L337) | 2026-09-20 | No `AUTOINCREMENT` on `agents.id` |
| S8 | context7 | `/websites/code_claude` — "SDKMessageOrigin kinds human task-notification…" (Agent SDK TypeScript reference) | 2026-09-20 | `origin.kind` values and meanings; absent `origin` is unattributed (before v2.1.210 treated as human); `isSynthetic`, `unclassified` |
| S9 | web | https://github.com/anthropics/claude-code/issues/16952 | 2026-09-20 | "[BUG] UserPromptSubmit hook fires when Task/subagent completes instead of only on user prompt submission" |
| S10 | web | https://github.com/colbymchenry/codegraph/issues/1832 | 2026-09-20 | "UserPromptSubmit fires for messages the user never typed"; hook receives `<task-notification>` as `input.prompt` exactly like a real prompt; suggests skipping host wrapper prefixes |
| S11 | web | https://github.com/usulpro/epic-loop/issues/4 | 2026-09-20 | Claude Code 2.1.273: completion notice delivered as a `UserPromptSubmit` event with a synthetic `<task-notification>` body; "The assumption 'UserPromptSubmit == a human typed something' does not hold on Claude Code" |
| S12 | web | https://github.com/technicalpickles/cq/pull/62 | 2026-09-20 | Null `origin` means "unknown", not "confirmed non-human"; 93 real records with `origin.kind='human'` and `promptSource='sdk'` disagree |
| S13 | web | https://github.com/anthropics/claude-code/issues/83015 | 2026-09-20 | Real typed prompts carry `promptSource: "typed"`, `origin: {kind: "human"}` (all 72 real prompts in that session) |
| S14 | web | https://github.com/agigante80/claude-code-hubbub/issues/52 | 2026-09-20 | A Monitor line is a `type:"user"` record with `promptSource:"system"`, `origin:{kind:"task-notification"}`, string content wrapping the line |
| S15 | web | https://sqlite.org/autoinc.html | 2026-09-20 | Without AUTOINCREMENT, rowids of previously deleted rows might be reused |
| S16 | web | https://code.claude.com/docs/en/settings | 2026-09-20 | Claude Code writes `~/.claude/settings.json` the first time you change an option in `/config` that it stores in user settings |
| S17 | web | https://github.com/anthropics/claude-code/issues/94489 | 2026-09-20 | Reported corruption of global `settings.json` from non-atomic writes by Claude Code's own settings writer |
| S18 | context7 | `/websites/code_claude` — interactive-mode "Queue messages while Claude works" and "Command history" | 2026-09-20 | Enter while Claude works queues the message; Up-arrow recall is per working directory and resubmits pasted content |
| S19 | codebase | `scripts/verify-bg-link-retired.sh` (header, `api` mode) | 2026-09-20 | Precedent for a fully isolated stack: real host-server on private port 18797 with scratch conf/DB and a private tmux server, never contacting live `:8788` |
| S20 | codebase | `frontend/vite.config.ts` (`FRONTEND_PORT`, `PROXY_TARGET`, `BACKEND_PORT`); `host-server/config.ts` (`CONDUCTOR_CONF`); `.env.example` | 2026-09-20 | Ports, proxy target and conf path are env-overridable, so a second isolated stack is possible |

## Excerpts

### S8 — SDKMessageOrigin
https://code.claude.com/docs/en/agent-sdk/typescript
> `human` | Direct input from the end user. … Claude Code treats a user message with no `origin` as unattributed … Before v2.1.210, Claude Code treated an absent `origin` on a user message as human input.

> `task-notification` | Synthetic turn injected for a delivery that arrives without a fresh user prompt, such as a finished background task

### S11 — epic-loop issue
https://github.com/usulpro/epic-loop/issues/4
> The harness delivers the completion notice as a UserPromptSubmit hook event whose prompt body is a synthetic <task-notification> block.

> The assumption "UserPromptSubmit == a human typed something" does not hold on Claude Code.

### S10 — codegraph issue
https://github.com/colbymchenry/codegraph/issues/1832
> UserPromptSubmit fires for messages the user never typed. When a background agent (the Agent tool) finishes, Claude Code injects a <task-notification> block into the turn as a user message, and the hook receives it on stdin as input.prompt exactly like a real prompt.

### S13 — real typed prompts
https://github.com/anthropics/claude-code/issues/83015
> All 72 real prompts in the session carry promptSource: "typed".

### S12 — provenance caveats
https://github.com/technicalpickles/cq/pull/62
> Final branch review found 93 real records with origin.kind='human' and promptSource='sdk' -- the two fields disagree on who counts as human on a small slice of data.

### S15 — SQLite rowid reuse
https://sqlite.org/autoinc.html
> If you ever delete rows or if you ever create a row with the maximum possible ROWID, then ROWIDs from previously deleted rows might be reused when creating new rows … the purpose of AUTOINCREMENT is to prevent the reuse of ROWIDs from previously deleted rows.

### S1 — this session's transcript (jq tally, verbatim result)
```
 48 null   null    Another Claude session sent a message: <teammate-message teammate_id="X…
  2 human  null    <command-message>research</command-message> <command-name>/research</c…
  1 null   null    <command-name>/clear</command-name> <command-message>clear…
  1 human  typed   hi
  1 human  typed   continue
  1 human  typed   Stop all sub-agents.
  1 human  null    <command-message>roadmap-create</command-message> <command-name>/roadm…
  1 human  null    <command-message>power-mode</command-message> <command-name>/power-mod…
```
(columns: `origin.kind`, `promptSource`, leading text; string-content, non-meta user records)

### S16 — settings writes
https://code.claude.com/docs/en/settings
> It writes ~/.claude/settings.json the first time you change an option in the /config menu that it stores in user settings, such as the theme

### S19 — isolated-stack precedent
`scripts/verify-bg-link-retired.sh`
> api — boots the REAL host-server from this working tree on a private port (18797) with a scratch conductor.conf/DB and a PRIVATE tmux server (TMUX_TMPDIR under ./tmp/) … The live :8788 server and the `conductor` tmux session are never contacted.
