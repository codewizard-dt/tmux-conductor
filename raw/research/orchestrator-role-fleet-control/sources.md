---
topic: a new 'role' for agents is 'orchestrator' and they can manage tmux window agents and bg processes
slug: orchestrator-role-fleet-control
researched: 2026-09-20
---

# Primary Sources — Orchestrator Role for Fleet Control

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts` — schema migration block (v7 role column line 410; v8 `tasks_v8` rebuild lines 413-447; v10 line 452-461) | 2026-09-20 | `agents.role` is CHECK-constrained to 7 values; CHECK widening precedent is a full table rebuild with `foreign_keys = OFF`; schema currently v10 |
| S2 | codebase | `host-server/rolePresets.ts::ROLE_VALUES`, `getRoleFragment`, `applyRoleFragmentToWorktree` | 2026-09-20 | Enum mirrored in TS; role fragment is only written into `<worktree>/CLAUDE.md`; header comment demands sync with the CHECK |
| S3 | codebase | `host-server/role-presets.json` | 2026-09-20 | One prompt fragment per current role (7 keys); no `orchestrator` |
| S4 | codebase | `host-server/db.ts` lines 620-622 and 657-658 (Serena pattern search for `applyRoleFragmentToWorktree`) | 2026-09-20 | Only two call sites, both in worktree-creation paths — non-worktree agents get no role-driven prompt |
| S5 | codebase | `host-server/index.ts` route registrations (Serena pattern search for `'/agents…'`, `'/bg-processes…'`, `'/tasks…'`, `'/schedules…'`, lines 881-2405) | 2026-09-20 | Full existing control surface: agents, window open/close, keys, tasks, bg window/tail, schedules; `PATCH /agents/:id` accepts `role`; no bg restart route |
| S6 | codebase | `host-server/index.ts:299` (spawn `launchText`) | 2026-09-20 | Agent env is `CONDUCTOR_AGENT_NAME`, `CONDUCTOR_STATE_DIR`, `CONDUCTOR_LOG_DIR` only — no agent id, no role |
| S7 | codebase | `host-server/index.ts` `POST /agents` (1053-1119), `POST`/`DELETE /agents/:id/window` (1123-1318), `POST /agents/:id/keys` (1326-1342) | 2026-09-20 | Create/reopen/close semantics and status codes; role validated against `ROLE_VALUES`; default launch command includes `--append-system-prompt-file`; keys route bypasses the queue |
| S8 | codebase | `skills/dev-commands/SKILL.md` | 2026-09-20 | Agent-facing skill precedent: `curl`-based script, env-var contract, offline fallback |
| S9 | wiki | `wiki/work/tasks/TASK-0194-bg-restart-same-project-guard.md` | 2026-09-20 | `X-Conductor-Agent` header resolution, fail-closed on unknown/ambiguous, window-name non-injectivity, not-a-security-boundary caveat, human = header absent |
| S10 | wiki | `wiki/work/roadmaps/ROADMAP-0024-project-bg-process-agent-restart.md` | 2026-09-20 | Restart, liveness, cooldown, audit writer, caller resolution and schema-migration tasks already planned |
| S11 | wiki | `wiki/work/decisions/archive/DEC-0006-task-routing-and-worker-provisioning.md` (D1, lines 1-80) | 2026-09-20 | Role enum + worktree injection primitives; drivers 3 (no silent destruction) and 7 (enqueue only, no widened pane injection); role-match tier accepted, unbuilt |
| S12 | research | `raw/research/multi-agent-infrastructure-requirements/index.md` | 2026-09-20 | Task-completion semantics missing; two dispatchers; no quota/concurrency cap; `--dangerously-skip-permissions` default; schedules/managed loop as job host |
| S13 | research | `raw/research/host-agent-identification-and-control/index.md` | 2026-09-20 | `tmux send-keys` reaches any accessible pane; cross-session messaging is advisory only |
| S14 | research | `raw/research/bg-process-agent-access/index.md` | 2026-09-20 | Gaps in bg restart/liveness; project-blind skill; installer copies the skill dir; signed-token alternative |
| S15 | wiki | `wiki/knowledge/sources/orchestrator-agent-routing.md` | 2026-09-20 | Prior three rounds: router shape, "agent as tool vs subagent" conversational authority, enqueue-only constraint |
| S16 | memory | Serena memory `architecture/agent-identity` | 2026-09-20 | Agents are addressed by numeric id; name is project-scoped; unique indexes on `agents` |
| S17 | codebase | `frontend/src` pattern search: `AgentList.tsx:45` (`role?: string \| null`), `lib/api.ts:365` (`role?: string`) | 2026-09-20 | Frontend treats role as a free string; no hard-coded role list found |
| S18 | context7 | `/websites/code_claude` — "System prompt flags" (CLI reference) | 2026-09-20 | `--append-system-prompt-file` appends file contents for the current invocation only; Claude-specific flag |
| S19 | context7 | `/websites/code_claude` — "CLI flags" (`--strict-mcp-config`) and subagent `mcpServers` | 2026-09-20 | Per-session MCP servers can be scoped so only one session sees them |
| S20 | context7 | `/websites/code_claude` — "CLI flags" (`--settings`) | 2026-09-20 | Per-session settings override at launch |
| S21 | web | https://dev.to/kontext/how-do-i-enforce-least-privilege-for-ai-agents-using-external-tools-3o5c | 2026-09-20 | OWASP LLM06 Excessive Agency; complete mediation; tool and action minimisation |
| S22 | web | https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec05-bp01.html | 2026-09-20 | Least-privilege / permissions boundaries for agentic workflows; user confirmation of agent actions |
| S23 | web | https://praesidia.ai/blog/excessive-agency-owasp-llm06-controls | 2026-09-20 | Tool access allow-listed per agent rather than inherited from a server registration |
| S24 | web | https://zenity.io/academy/least-privilege-ai-agents | 2026-09-20 | "Least agency" governs behaviour on top of access |
| S25 | web | https://unix.stackexchange.com/questions/768222/find-which-tmux-session-and-pane-runs-a-given-process-id | 2026-09-20 | `TMUX_PANE` set at pane creation and inherited by descendants |
| S26 | web | https://man7.org/linux/man-pages/man1/tmux.1.html | 2026-09-20 | tmux manual confirms the pane id is passed to the child via `TMUX_PANE` |
| S27 | web | https://libtmux.git-pull.com/topics/self_location/ | 2026-09-20 | tmux writes the variables once at spawn and never revises them |
| S28 | web | https://github.com/YoanWai/agent-manager/pull/518 | 2026-09-20 | A sibling agent-manager resolves the calling session from `$TMUX_PANE` via `display-message`, guarding on the caller's `$TMUX` socket |
| S29 | wiki | `wiki/work/roadmaps/index.md` (ROADMAP-0023, -0024, -0025 entries) | 2026-09-20 | ROADMAP-0023 (sidebar/detail redesign) is active at 1/10 and rewrites the components a role UI would touch |

## Excerpts

### S1 — `host-server/db.ts` (schema v7)
`host-server/db.ts:410`
> `ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))`

### S1 — `host-server/db.ts` (v8 rebuild rationale)
`host-server/db.ts:414-421`
> `SQLite cannot ALTER a CHECK constraint in place, so widening tasks.status's allowed values to include 'done' requires the same table-rebuild pattern used for the v2 agents migration above: create the new-shape table, copy every row across explicitly (never SELECT *, so column order/defaults can't silently mismatch), drop the old table, rename, recreate the index.`

### S2 — `host-server/rolePresets.ts`
`host-server/rolePresets.ts:3-7`
> `Source of truth for the role enum is host-server/db.ts's agents.role SQLite CHECK constraint (TASK-111): CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect')). If that CHECK constraint ever changes, update ROLE_VALUES below (and role-presets.json) to match — and vice versa.`

### S4 — call sites of `applyRoleFragmentToWorktree`
`host-server/db.ts:622` and `:658`
> `applyRoleFragmentToWorktree(worktreePath, data.role ?? 'generic');`
> `applyRoleFragmentToWorktree(worktreePath, agent.role);`

### S6 — spawn environment
`host-server/index.ts:299`
> ``const launchText = `CONDUCTOR_AGENT_NAME='${winName}' CONDUCTOR_STATE_DIR='${stateDir}' CONDUCTOR_LOG_DIR='${logDir}' ${agent.launchCmd}`;``

### S9 — TASK-0194 (identity and caveat)
> `Match by exact string equality against agentWindowName({ name, projectName }) for every agent` … `` `unknown` and `ambiguous`: **deny (fail closed)**; an unresolvable identity must never widen access. ``
> `Not a security boundary. Header spoofing by an agent that knows another agent's name is possible; this is the same single-user, no-auth trust model as the rest of the host-server.`
> `human/dashboard: allow (unchanged single-user semantics; still audited).`

### S11 — DEC-0006 drivers
> `No unmerged work may be silently destroyed | Teardown today is git worktree remove --force + git branch -D — both discard uncommitted and unmerged work without warning`
> `Routing must only enqueue or spawn, never inject keystrokes beyond the existing dispatch path | host-server has no authentication`

### S12 — infrastructure requirements
> `Permissive launch posture. Default launch command is claude --dangerously-skip-permissions --append-system-prompt-file … [S8]; there is no auth on the host-server`
> `No task completion semantics. popTask sets status='done', completed_at=now at dispatch [S1]. "Done" therefore means "sent to a pane", not "finished".`

### S18 — Claude Code system prompt flags
https://code.claude.com/docs/en/cli-reference
> `--append-system-prompt-file | Appends file contents to the default prompt`
> `These flags apply only to the current invocation. For persistent personas you can switch between and share across a project, use output styles. For project conventions Claude should always follow, use CLAUDE.md.`

### S19 — Claude Code MCP scoping
https://code.claude.com/docs/en/cli-reference
> `--strict-mcp-config | Only use MCP servers from --mcp-config, ignoring all other MCP configurations.`

### S20 — Claude Code `--settings`
https://code.claude.com/docs/en/cli-reference
> `--settings | Path to a settings JSON file or an inline JSON string. Values you set here override the same keys in your settings.json files for this session.`

### S21 — Least privilege for agents using external tools
https://dev.to/kontext/how-do-i-enforce-least-privilege-for-ai-agents-using-external-tools-3o5c
> `OWASP also recommends complete mediation: downstream requests should be validated against policy instead of trusting the LLM to decide whether an action is safe.`
> (from the companion article, https://dev.to/kontext/what-is-excessive-agency-vulnerability-4f2e) `Gate high-impact actions: require approval for deletes, external sends, privilege changes, and bulk exports.`

### S22 — AWS Well-Architected Generative AI Lens, GENSEC05-BP01
https://docs.aws.amazon.com/wellarchitected/latest/generative-ai-lens/gensec05-bp01.html
> `Implement user confirmation for the agent, requiring users to confirm agent actions and mitigating the risk of excessive agency.`

### S23 — Praesidia
https://praesidia.ai/blog/excessive-agency-owasp-llm06-controls
> `Tool access is allow-listed per agent rather than inherited from an MCP server registration, so the exposed surface matches the used surface.`

### S24 — Zenity
https://zenity.io/academy/least-privilege-ai-agents
> `Least privilege is the foundation, but it isn't the whole picture; an agent can stay entirely within its permissions and still act inappropriately, which is why least agency governs behavior on top of access.`

### S25 — tmux pane environment
https://unix.stackexchange.com/questions/768222/find-which-tmux-session-and-pane-runs-a-given-process-id
> `When tmux starts the first process in a pane, it puts TMUX_PANE in the environment of the process. The value of the variable is the pane ID (e.g. %2). Descendants of the first process will inherit the variable with the right value, unless some process decides to mangle the variable or the whole environment`

### S26 — tmux manual
https://man7.org/linux/man-pages/man1/tmux.1.html
> `The pane ID is passed to the child process of the pane in the TMUX_PANE environment variable`

### S27 — libtmux
https://libtmux.git-pull.com/topics/self_location/
> `tmux writes these variables into a pane's environment once, when it spawns the pane, and never revises them`

### S28 — agent-manager PR #518
https://github.com/YoanWai/agent-manager/pull/518
> `A pane id that is not one, or a $TMUX from another server (other socket, or same socket with another pid), resolves to no caller.`
