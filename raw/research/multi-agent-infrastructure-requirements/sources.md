---
topic: Infrastructure requirements for multi-agent architecture. This is relevant for the orchestrator, the proposed orchestrator agent.
slug: multi-agent-infrastructure-requirements
researched: 2026-09-19
---

# Primary Sources — Infrastructure requirements for multi-agent architecture (orchestrator agent)

Line numbers for codebase sources are as observed on 2026-09-19 against the working tree (uncommitted changes present — see `git status`); Serena line numbers are 0-based in tool output, the ones below are 1-based file lines where a `Read` was used.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::popTask` (872-896) | 2026-09-19 | Task claim is one atomic `UPDATE … WHERE id=(SELECT …) RETURNING`; pop flips `status='done'` + `completed_at` at *dispatch* time; tiers are agent → project → global; no role tier, no task-to-agent match beyond that |
| S2 | codebase | `host-server/db.ts::openDb` (266-275) | 2026-09-19 | `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, then `runMigrations` |
| S3 | codebase | `scripts/lib/db.sh` line 48 | 2026-09-19 | Bash side opens SQLite with `.timeout 5000` — same busy budget as the Node side |
| S4 | codebase | `host-server/index.ts::dispatchTaskToAgent` (518-562) | 2026-09-19 | Signature takes `cmdText` only (no task id); writes `busy` state file; appends a `dispatch.jsonl` record with no task id / tier / routing reason; best-effort `stashCheckpoint` first |
| S5 | codebase | `host-server/index.ts::pollAndDiff` (2686-2710) | 2026-09-19 | Host-server dispatch on idle transition is gated by `queuedTasks>0`, `windowPresent`, absence of `usage-limited` file, and `hasPendingBackgroundAgents(...)` (BUG-0001 sentinel); then `popTask` → `dispatchTaskToAgent`; SSE `agent-update` broadcast follows |
| S6 | codebase | `host-server/index.ts::startManagedLoop` (2899-2940) and the `'schedule poll'` loop (2986-3000) | 2026-09-19 | Existing background-job pattern: managed timer loop with slow-loop backoff + observability log; `dueSchedules`/`fireSchedule` enqueue tasks and `broadcastSSE('task-added', …)` — the natural home for an orchestrator job |
| S7 | codebase | `host-server/git.ts` (symbol overview) | 2026-09-19 | Exports only `applyStash, createWorktree, deleteBranch, detectBaseBranch, getGitRoot, isGitRepo, refExists, removeWorktree, siblingWorktreePath, stashCheckpoint` — no merge/integrate function |
| S8 | codebase | `host-server/db.ts::runMigrations` (lines ~280-460) | 2026-09-19 | `tasks` columns: `id, command, agent_id, project_id, position, status, source, schedule_id, created_at` (+`completed_at`); no role / attempt / lease / result / dependency columns. `agents.role` CHECK-enum added at schema v7; schema currently v10; default launch command is `claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md` |
| S9 | codebase | `host-server/index.ts::healMonitorWindow` (119-129); `scripts/conductor.sh` line 103 | 2026-09-19 | Host-server recreates the `monitor` tmux window and launches `scripts/monitor.sh` when missing — so the bash monitor is a live second dispatcher alongside `pollAndDiff` |
| S10 | codebase | `scripts/monitor.sh` (line 102 `pop_task_sql`; line 361 `check_usage`); Serena `search_for_pattern "pending-agents\|pending_agents\|hasPending"` over `scripts/` → no matches | 2026-09-19 | `monitor.sh` pops tasks via `pop_task_sql`; no reference to the BUG-0001 pending-agents sentinel exists anywhere under `scripts/` (absence-of-match evidence; not a runtime test) |
| S11 | codebase | `host-server/package.json` `dependencies` | 2026-09-19 | Runtime deps: `@fastify/cors`, `@fastify/static`, `@fastify/websocket`, `better-sqlite3`, `dotenv`, `fastify` — no Anthropic SDK, no Claude Agent SDK |
| S12 | codebase (wiki) | `wiki/work/decisions/archive/DEC-0006-task-routing-and-worker-provisioning.md` | 2026-09-19 | D1 **accepted 2026-09-18**: Option C — role-match tier in `popTask`/`pop_task_sql` + ephemeral worktree fallback; fallback must not auto-merge/teardown while BUG-0001 open; routing log required; primitives table (role exists; merge/teardown-trigger/per-task role missing) |
| S13 | codebase (wiki) | `wiki/work/tasks/TASK-0199-add-agent-description-column.md` | 2026-09-19 | Filed 2026-09-19, `status: todo`; states the `role` column "is already a mature, fully-wired feature and is explicitly out of scope"; adds only `agents.description` |
| S14 | codebase (wiki) | `wiki/work/bugs/index.md`; frontmatter `status:` of `TASK-133`, `TASK-0184` (archive), `TASK-0185`, `TASK-0187` | 2026-09-19 | BUG-0001 `in-progress` P1; TASK-0184 (background-job status detection) `done`; TASK-133 (sentinel-gate dispatch) `todo`; TASK-0185 (dispatch render-settle delay) `pending-uat`; BUG-0012 (fake-dispatch never fires) `open` |
| S15 | codebase (Serena memory) | `architecture/task-routing/dec-0006-constraints` | 2026-09-19 | Four non-obvious constraints: teardown destructive + trigger unreliable; pop logic implemented twice (drift risk); role taxonomy closed at 7; `git.ts` has no merge |
| S16 | codebase (Serena memory) | `conductor/usage-check-and-detection-bugs` | 2026-09-19 | `USAGE_CHECK_CMD='true'` — "There is currently NO automated usage checking" (DEC-0001); the prior command launched a full agentic turn per call |
| S17 | codebase (raw research) | `raw/research/claude-usage-quota-signal/index.md` | 2026-09-19 | Conclusion: "No reliable, non-interactively-scriptable signal exists today" for subscription quota |
| S18 | codebase (raw research) | `raw/research/orchestrator-agent-routing/index.md` (round 1) | 2026-09-19 | Prior routing recommendation A/B/C; its comparison table lists B's dependency as "Existing Claude API/Agent SDK access from host-server" |
| S19 | codebase (raw research) | `raw/research/orchestrator-agent-routing/index-2.md` (round 2) | 2026-09-19 | Ephemeral worker-per-task shape (D), A2A (E), decentralized (F); dispatch.jsonl churn evidence |
| S20 | codebase (raw research) | `raw/research/orchestrator-agent-routing/index-3.md` (round 3) | 2026-09-19 | Catalog-vs-orchestrator axes; recommends adding `role` + `description` columns; agent-as-tool failure axis; coding-specific cost figure still missing |
| S21 | codebase (Serena memory) | `claude-code/hooks-reference` (secondary synthesis of code.claude.com/docs/en/hooks) | 2026-09-19 | Hook events incl. `Stop`, `StopFailure`, `SubagentStop`, `TaskCreated`/`TaskCompleted`, `TeammateIdle`, `WorktreeCreate`/`WorktreeRemove`, `Notification` subtypes; hook stdin carries `session_id`, `transcript_path`, `cwd`. Second-hand — verify against the official page before building on a specific field |
| S22 | codebase (sibling repo, via scout agent) | `/Users/davidtaylor/Repositories/tmux-agent-status` — `README.md`, `hooks/better-hook.sh`, `scripts/lib/session-status.sh`, `scripts/sidebar-collector.sh`, `scripts/deploy-sessions.sh`, `scripts/claude-launcher.sh` | 2026-09-19 | File-based per-pane status with no locking; no queue/messaging; `deploy-sessions.sh` = one window + one worktree per manifest entry; launcher runs `exec claude --dangerously-skip-permissions "$prompt"` |
| S23 | codebase (sibling repo, via scout agent) | `/Users/davidtaylor/Repositories/claude-code-lsp-enforcement-kit` — `README.md`, `SECURITY.md`, `hooks/serena-usage-tracker.js`, `hooks/serena-pre-delegation.js` | 2026-09-19 | State keyed by `md5(cwd)`, non-atomic read-modify-write; no destructive-command policy; hooks fail open on parse errors; a session-reset hook exists because stale state gave a silent bypass |
| S24 | web | https://www.anthropic.com/engineering/multi-agent-research-system | 2026-09-19 | Production lessons: durable state, checkpoints/retry, full tracing, async coordination challenges (search-result excerpts; page not fetched in full) |
| S25 | web | https://code.claude.com/docs/en/headless | 2026-09-19 | `claude -p … --output-format json` returns `session_id`; `--resume <id>` continues; resume by session id/transcript path |
| S26 | web | https://www.buildthisnow.com/blog/guide/development/claude-code-headless-mode | 2026-09-19 | JSON output carries `result`, `session_id`, metadata, `total_cost_usd`; `--max-turns` errors at limit; `--bare` skips hooks/skills/MCP/CLAUDE.md discovery. Third-party summary of the official CLI reference |
| S27 | context7 | `/websites/code_claude_en_agent-sdk` — "maxBudgetUsd maxTurns limits, permission modes, session resume, and running subagents programmatically" | 2026-09-19 | SDK options `maxTurns`, `max_budget_usd`, env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` / `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, result subtypes `error_max_turns` / `error_max_budget_usd`, `resume` by session id |
| S28 | context7 | `/wiselibs/better-sqlite3` — "transaction .immediate() deferred exclusive behavior and WAL mode multiple processes SQLITE_BUSY" | 2026-09-19 | `.deferred/.immediate/.exclusive` transaction variants; WAL mode recommended for concurrency; in this build only the busy callback handles `SQLITE_BUSY` in WAL |
| S29 | web | https://code.claude.com/docs/en/agent-teams | 2026-09-19 | Agent Teams: shared task list, file-locked claiming, task dependencies, idle notifications to lead, experimental/disabled by default |
| S30 | web | https://github.com/minnzen/sqliteq | 2026-09-19 | SQLite queue reference design: atomic claim, visibility timeout, fencing, dead-letter after `maxReceive`, at-least-once |
| S31 | web | https://github.com/autumn-foundation/autumn/issues/2585 | 2026-09-19 | Lease pitfall: visibility timeout of 0 re-enqueues/dead-letters live handlers, burning attempts and duplicating side effects |
| S32 | web | https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution | 2026-09-19 | Worktrees move conflicts to merge time, not remove them; Overstory FIFO merge queue + watchdog; pre-warmed worktree pool practice |
| S33 | web | https://dev.to/andrea_schiona/running-coding-agents-in-parallel-with-git-worktrees-4cnk | 2026-09-19 | Worktrees do not isolate ports, databases, Docker volumes, caches |
| S34 | web | https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents | 2026-09-19 | Forgotten worktrees consume disk; worktrees are separate so conflicts can arise unnoticed |
| S35 | web | https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide | 2026-09-19 | Coordination overhead grows non-linearly with agent count; merge one branch at a time |
| S36 | web | https://www.truefoundry.com/blog/claude-code-limits-explained | 2026-09-19 | 5-hour rolling window + weekly cap; one shared bucket across Claude Code / chat / Cowork |
| S37 | web | https://www.faros.ai/blog/claude-code-token-limits | 2026-09-19 | Only coding-specific multiplier found: Agent Teams ≈7x tokens in plan mode (attributed to Anthropic; second-hand) |
| S38 | web | https://fast.io/resources/claude-rate-limits-guide/ | 2026-09-19 | "Agent SDK credit separation planned for June 15 was paused on the effective date" — programmatic-use billing treatment is in flux |
| S39 | web | https://amux.io/guides/claude-code-headless/ | 2026-09-19 | Practitioner failure modes of parallel headless fleets: rate-limit burn, no cost caps, lost session ids, resume-dialog trap |
| S40 | web | https://www.aurorasre.ai/blog/opentelemetry-ai-agent-observability | 2026-09-19 | OTel GenAI agent conventions (`invoke_agent`, `execute_tool`, …) all marked "Development", not stable |
| S41 | web | https://code.claude.com/docs/en/sandboxing | 2026-09-19 | Sandbox = filesystem + network isolation, "not a complete isolation boundary"; `--dangerously-skip-permissions` guidance |
| S42 | web | https://levelop.dev/blog/how-to-build-multi-agent-systems-2026 | 2026-09-19 | Loop/handoff-circle failure modes; hard step cap + tracing + tool guardrails, instrumented before scaling |
| S43 | codebase | Serena `search_for_pattern "hasPendingBackgroundAgents\("` over `host-server/` (non-test) | 2026-09-19 | The sentinel gate is called from exactly two sites, both in `host-server/index.ts` (lines 970 and 2700); definition in `host-server/pendingAgents.ts:24`; none in `scripts/` |

## Excerpts

### S1 — `popTask`
`host-server/db.ts`
> `UPDATE tasks SET status='done', completed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = (`
> `SELECT t.id FROM tasks t WHERE t.status = 'queued' AND (`
> `ORDER BY CASE WHEN t.agent_id IS NOT NULL THEN 0 WHEN t.project_id IS NOT NULL THEN 1 ELSE 2 END, t.position LIMIT 1) RETURNING id, command, …`

Code comment above it: "TASK-125: soft flip instead of DELETE — the popped row's status becomes 'done' with completed_at set".

### S2 — `openDb`
> `db.pragma('journal_mode = WAL');` / `db.pragma('foreign_keys = ON');` / `db.pragma('busy_timeout = 5000');`

### S3 — bash DB wrapper
`scripts/lib/db.sh:48`
> `sqlite3 -cmd '.timeout 5000' -separator $'\x1f' "$CONDUCTOR_DB" "$@"`

### S4 — `dispatchTaskToAgent`
> `async function dispatchTaskToAgent(db, conf, agent, cmdText: string, detection: string, opts?: { clearFirst?: boolean })`
> `const dispatchRecord = { ts, agent: win, command: cmdText, state: 'idle', state_age_s: 0, detection, queue: 'none', queue_remaining: 0, pane_tail: paneTail };`

(No `task_id`, `tier`, or `reason` key exists in the record.)

### S5 — `pollAndDiff` dispatch gate
> `if (!hasPendingBackgroundAgents(conf.stateDir, win, conf.pendingAgentStaleMs)) { const task = popTask(db, agent.name); if (task) { void dispatchTaskToAgent(db, conf, dbAgent, task.command, 'idle-transition-poll', { clearFirst: task.kind === 'project' })…`

Preceding condition includes `!existsSync(path.join(conf.stateDir, 'usage-limited'))`.

### S6 — managed loop / schedule poll
> `startManagedLoop('schedule poll', 5000, () => { … for (const s of dueSchedules(db, now)) { const task = fireSchedule(db, s, now); if (task) { broadcastSSE('schedule-fired', …); broadcastSSE('task-added', task); } } }, { warnAfterMs: 1000, backoffMs: 5000 });`

### S7 — `git.ts` exports
> Function: `applyStash, createWorktree, deleteBranch, detectBaseBranch, getGitRoot, isGitRepo, refExists, removeWorktree, siblingWorktreePath, stashCheckpoint`

### S8 — schema
> `CREATE TABLE IF NOT EXISTS tasks ( id INTEGER PRIMARY KEY, command TEXT NOT NULL, agent_id INTEGER REFERENCES agents(id) ON DELETE CASCADE, project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE, position REAL NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','backlog')), source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule')), schedule_id …, created_at …, CHECK (agent_id IS NULL OR project_id IS NULL) );` (v1; `status` gained `'done'` and `completed_at` in later migrations)
> `ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'generic' CHECK (role IN ('generic','frontend','backend','qa','devops','security','architect'))` (v7)
> `const newDefault = 'claude --dangerously-skip-permissions --append-system-prompt-file ~/.claude/rules/agent-teams-preference.md';` (v10)

### S9 — monitor healing
> `// Recreate the monitor window inside an existing session, mirroring conductor.sh. No-op when the window is already there.`
> `spawnSync('tmux', ['send-keys', '-t', windowTarget(sessionName, 'monitor'), monitorScript, 'Enter'], …)`

### S10 — bash dispatcher
`scripts/monitor.sh:102`
> `pop_task_sql "$agent_id" "$project_id"  # sets POPPED_TASK, LAST_QUEUE_KIND, LAST_QUEUE_REMAINING`

Search `pending-agents|pending_agents|hasPending` over `scripts/` returned `{}`.

### S11 — host-server dependencies
> `"dependencies": { "@fastify/cors": "^11.2.0", "@fastify/static": "^9.1.3", "@fastify/websocket": "^11.2.0", "better-sqlite3": "^12.0.0", "dotenv": "^16.4.7", "fastify": "^5.8.5" }`

### S12 — DEC-0006
`wiki/work/decisions/archive/DEC-0006-task-routing-and-worker-provisioning.md`
> "**Chosen option**: **Option C — role router with ephemeral worktree fallback**"
> "the fallback path **must not** perform an automatic merge-and-teardown while `BUG-0001`'s false-idle gap remains open (it must require explicit human confirmation until then), and every routing decision **must** be recorded with the tier that matched"
> Primitive table rows: "Per-task capability field | **Missing**", "Merge-back / integration | **Missing**", "Task-completion → teardown trigger | **Missing**"

### S13 — TASK-0199
> "the `role` column (schema v7, `ROLE_VALUES` enum, TASK-115, TASK-167) is already a mature, fully-wired feature and is explicitly **out of scope** for this task"

### S15 — DEC-0006 constraints memory
> "The pop logic is implemented twice and can drift. `host-server/db.ts::popTask` (TypeScript) and `scripts/lib/db.sh::pop_task_sql` (bash) must both get the new role tier, in the same order (agent_id → project_id → role → global, by `position`)."

### S16 — usage check memory
> "Fixed: `USAGE_CHECK_CMD='true'`. There is currently NO automated usage checking."

### S17 — quota signal research
> "**No reliable, non-interactively-scriptable signal exists today.**"

### S18 — round 1 comparison row
> "| **Dependencies** | None new (SQL columns only) | Existing Claude API/Agent SDK access from host-server | Another live tmux-conductor agent slot + its own skill/prompt |"

### S22 — tmux-agent-status (scout-reported excerpts)
`README.md`: "Write `working`, `done`, or `wait` to `~/.cache/tmux-agent-status/<session>.status`"
`hooks/better-hook.sh`: "(SubagentStop excluded - subagents finishing doesn't mean the main agent is done)"
`scripts/claude-launcher.sh`: `exec claude --dangerously-skip-permissions "$prompt"`
`scripts/sidebar-collector.sh`: PID-file singleton guard using `kill -0 "$old_pid"` — check-then-write; cache published via `> "${CACHE_FILE}.tmp"` then `mv -f`. No `flock` found.

### S23 — LSP enforcement kit (scout-reported excerpts)
`README.md`: "State file: `~/.claude/state/lsp-ready-<md5(cwd)>`. 24-hour TTL, pruned on session start."
`SECURITY.md`: "A fail-open bug silently disables enforcement for all users of the kit"
`README.md`: "All blockers fail-**closed** in spirit: parse errors `process.exit(0)` (allow)" (self-contradictory: parse errors allow).
`hooks/serena-pre-delegation.js`: exempt agents matched by exact case-insensitive name; earlier "`.includes(e)` allowed substring matches".

### S24 — Anthropic multi-agent research system
https://www.anthropic.com/engineering/multi-agent-research-system
> "But this asynchronicity adds challenges in result coordination, state consistency, and error propagation across the subagents."
> "Agents are stateful and errors compound....Agents can run for long periods of time, maintaining state across many tool calls. This means we need to durably execute code and handle errors along the way." (as quoted from the page in a search excerpt)
> "We combine the adaptability of AI agents built on Claude with deterministic safeguards like retry logic and regular checkpoints. Debugging benefits from new approaches...Adding full production tracing let us diagnose why agents failed and fix issues systematically." (as quoted from the page in a search excerpt)

### S25 — Claude Code headless docs
https://code.claude.com/docs/en/headless
> "If you're running multiple conversations, capture the session ID to resume a specific one: session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id') claude -p "Continue that review" --resume "$session_id""

### S26 — headless guide
https://www.buildthisnow.com/blog/guide/development/claude-code-headless-mode
> "Three, via --output-format: text (default plain text), json (structured JSON with the result, session_id, metadata, and total_cost_usd), and stream-json (newline-delimited JSON, one event per line, for real-time streaming)."
> "For deterministic CI, add --bare. It skips auto-discovery of hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md, which makes runs faster and reproducible."

### S27 — Claude Agent SDK (Context7)
> `env={"CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1", "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "5"}, max_budget_usd=5.0,`
> `maxTurns: 30, // Prevent runaway sessions`
> `} else if (message.subtype === "error_max_budget_usd") { console.log("Hit budget limit.");`

### S28 — better-sqlite3 (Context7)
> `insertMany.immediate(cats); // uses "BEGIN IMMEDIATE"`
> "so only the busy callback handles SQLITE_BUSY in WAL mode."

### S29 — Claude Code Agent Teams
https://code.claude.com/docs/en/agent-teams
> "Task claiming uses file locking to prevent race conditions when multiple teammates try to claim the same task simultaneously."
> "Tasks can also depend on other tasks: a pending task with unresolved dependencies cannot be claimed until those dependencies are completed."
> "A teammate whose turn ends on an API error notifies the lead that it failed and includes the error text."

### S30 — sqliteq
https://github.com/minnzen/sqliteq
> "If the consumer crashes or fails to delete the message, it becomes visible again after the timeout expires. After maxReceive deliveries, the message is dead-lettered. This is the same model as SQS and goqite, adapted for synchronous SQLite. Delivery guarantee is at-least-once."

### S31 — lease pitfall
https://github.com/autumn-foundation/autumn/issues/2585
> "With [jobs.sqlite] visibility_timeout_ms = 0 the cutoff equals now, so the claimed_at <= cutoff predicate matches a job claimed this instant. The maintenance pass runs within ~100ms, so live handlers are re-enqueued or dead-lettered mid-execution, burning attempts and duplicating side effects."

### S32 — git worktrees for parallel agents
https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution
> "Git worktrees provide file isolation without removing conflicts when multiple agents touch the same functionality."
> "For larger-scale agent fleets, the Overstory framework implements a FIFO merge queue with four-tier conflict resolution, plus a tiered watchdog system for fleet health monitoring."

### S33 — shared external state
https://dev.to/andrea_schiona/running-coding-agents-in-parallel-with-git-worktrees-4cnk
> "Port and service collisions — agents fight over the same dev server, database, or cache. Fix: explicit .env.local per worktree. Shared external state — databases, Docker volumes, and queues are still shared."

### S34 — worktree disk cost
https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents
> "One developer found 15 forgotten worktrees “consuming gigabytes” before starting to clean them up."

### S35 — coordination overhead
https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide
> "coordination overhead grows non-linearly with agent count. A shared checklist file becomes a merge conflict surface when a dozen agents are updating it simultaneously."
> "Merge one branch at a time."

### S36 — shared quota pool
https://www.truefoundry.com/blog/claude-code-limits-explained
> "The same bucket is shared across Claude Code, Claude.ai chat, and Cowork — burn tokens in one, you lose capacity in the others."

### S37 — Agent Teams token multiplier
https://www.faros.ai/blog/claude-code-token-limits
> "Anthropic notes that agent teams can consume about 7x more tokens than standard sessions when teammates operate in plan mode."

### S38 — programmatic billing in flux
https://fast.io/resources/claude-rate-limits-guide/
> "Agent SDK credit separation planned for June 15 was paused on the effective date"

### S39 — headless fleet failure modes
https://amux.io/guides/claude-code-headless/
> "Launching 50 agents in parallel against the API will burn through your rate limit in minutes. Cap concurrency with xargs -P, a semaphore, or a queue. No cost limits. A retry loop on a bad prompt can spend $100 in an hour. Always set per-invocation or per-day budget guards."

### S40 — OTel GenAI status
https://www.aurorasre.ai/blog/opentelemetry-ai-agent-observability
> "The conventions define operations including create_agent, invoke_agent, plan, invoke_workflow, and execute_tool"
> "every one of them is marked "Development," not stable"

### S41 — Claude Code sandboxing
https://code.claude.com/docs/en/sandboxing
> "Sandboxing reduces risk but is not a complete isolation boundary."
> "Without network isolation, a compromised agent could exfiltrate sensitive files like SSH keys. Without filesystem isolation, whether from a permissive policy or from disabling the filesystem layer, a compromised agent could backdoor system resources to gain network access."

### S42 — multi-agent loop guards
https://levelop.dev/blog/how-to-build-multi-agent-systems-2026
> "Multi-agent runs fail in ways single prompts never do: agents loop forever, hand off in circles, or silently drop context. You need a hard cap on total steps, tracing so you can see every handoff, and guardrails on tool use. Instrument this before you scale up, not after."
