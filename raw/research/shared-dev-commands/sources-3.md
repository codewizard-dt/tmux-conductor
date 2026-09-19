---
topic: >
  Assess the assumptions in raw/research/shared-dev-commands/index.md, then run
  another /research pass on closing the split-brain, project-scoping, UI/UX,
  and skill/script gaps for ROADMAP-020.
slug: shared-dev-commands
researched: 2026-09-13
---

# Primary Sources — Re-verify shared-dev-commands gaps + scope Phases 1-4

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts` lines 37-43, 139-145, 296-317, 335-357, 410-443, 674-687 (`BgProcess`, `BgProcessRow`, `agents`/`bg_processes`/`tasks`/`schedules` DDL, `agents_v2` migration, `tasks_v8` migration, `listBgProcesses`/`createBgProcess`/`deleteBgProcess`) | 2026-09-13 | Confirmed `bg_processes` still lacks `project_id`; confirmed schema is at version 8; found the `agents_v2` per-project-unique-index migration as the closest (but not directly applicable) precedent |
| S2 | codebase | `scripts/conductor.sh` lines 30-31, 62-66, 80-84 (`CONDUCTOR_LOG_DIR`/`CONDUCTOR_STATE_DIR`/`CONDUCTOR_BG_*` env export) | 2026-09-13 | Re-confirmed every agent still gets `CONDUCTOR_STATE_DIR`/`CONDUCTOR_LOG_DIR` unconditionally; line numbers shifted by ~1-4 lines from the original report's citation, no behavior change |
| S3 | codebase | `raw/research/shared-dev-commands/index-2.md`, `sources-2.md` (concurrent research pass, same session) | 2026-09-13 | Independently re-confirmed the split-brain in more depth (exact call sites, `AGENT_BG_LINKS` also split, bash already SQLite-only for the link); its own "Next Steps" shows Phase 1 is already being scoped as a standalone task in this session |
| S4 | codebase | `host-server/db.ts:301` (`bg_processes.name TEXT NOT NULL UNIQUE`), `host-server/index.ts:1839` (`conf.bgProcesses.some((b) => b.name === name)`), CLAUDE.md's tmux-window-name-global-uniqueness note | 2026-09-13 | Established that `bg_processes.name` uniqueness is global (unlike `agents.name`, which is per-project via `idx_agents_project_name`), and is additionally cross-checked against agent window names — forces `project_id` to be classificatory-only, not a uniqueness scope |
| S5 | codebase | `frontend/src/components/AddBgProcessForm.tsx` (full file, 197 lines); `frontend/src/components/AgentList.tsx` lines 55-64 (`BgProcess` interface), 1279-1289 (`BgProcessSection`), 1595-1604 (`groupByProject`), 1629-1633 (empty-state pattern); `frontend/src/components/AddAgentForm.tsx` lines 192-215 (project `<select>` pattern) | 2026-09-13 | Confirmed `AddBgProcessForm.tsx` has no project awareness at all (only fetches `{name}[]` from `/status`); confirmed `BgProcessSection` has no empty-state message and no grouping; confirmed `AddAgentForm.tsx`'s project-select pattern to mirror |
| S6 | codebase | `~/.claude/skills/` directory listing (66 entries) via `ls -la` and `find -maxdepth 2 -name scripts -type d` | 2026-09-13 | Confirmed zero of this user's 66 global skills bundle a `scripts/` subdirectory — the "SKILL.md + scripts/" pattern cited by the prior research has no local precedent |
| S7 | codebase | `.claude/skills/typecheck/SKILL.md` (project-scoped skill, via Serena `list_dir`); `install-hooks.sh` (repo root, `mcp__serena__get_symbols_overview`, 173 lines) | 2026-09-13 | Confirmed the one project-scoped skill is also single-file; confirmed `install-hooks.sh` is the closest local precedent for installing repo-tracked material into `~/.claude/` (copy + merge-register, dedup-by-command), applicable to Phase 4 only if a bundled script is chosen over inline `SKILL.md` Bash |

## Excerpts

### S1 — `host-server/db.ts`
`host-server/db.ts:299-305`
> CREATE TABLE IF NOT EXISTS bg_processes (
>   id INTEGER PRIMARY KEY,
>   name TEXT NOT NULL UNIQUE CHECK (name GLOB '[A-Za-z0-9_-]*'),
>   workdir TEXT NOT NULL,
>   launch_cmd TEXT NOT NULL,
>   linked_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL
> );

`host-server/db.ts:351-353` (the `agents_v2` migration's uniqueness-index precedent)
> ALTER TABLE agents_v2 RENAME TO agents;
> CREATE UNIQUE INDEX idx_agents_project_name ON agents(project_id, name) WHERE project_id IS NOT NULL;
> CREATE UNIQUE INDEX idx_agents_null_name ON agents(name) WHERE project_id IS NULL;

### S4 — uniqueness cross-check
`host-server/index.ts:1839` (inside `POST /bg-processes`)
> if (conf.bgProcesses.some((b) => b.name === name)) {
>   return reply.status(409).send({ error: `bg process '${name}' already defined` });
> }

### S5 — `AddBgProcessForm.tsx`'s lack of project awareness
`frontend/src/components/AddBgProcessForm.tsx:11-13, 26-32`
> interface Agent {
>   name: string;
> }
> ...
> const [agents, setAgents] = useState<Agent[]>([]);
> useEffect(() => {
>   void fetch(`${API_URL}/status`)
>     .then((r) => r.json())
>     .then((d: { agents?: Agent[] }) => { if (d.agents) setAgents(d.agents); })

### S5 — `BgProcessSection`'s missing empty state
`frontend/src/components/AgentList.tsx:1279-1281`
> function BgProcessSection({ bgs }: { bgs: BgProcess[] }) {
>   if (bgs.length === 0) return null
>   return (

### S6 — no bundled-script skill precedent
`ls -la ~/.claude/skills/` output (2026-09-13)
> 66 directory entries, each `drwxr-xr-x` with 3-4 files max (SKILL.md + at most a couple loose reference .md files); `find ~/.claude/skills -maxdepth 2 -name "scripts" -type d` returned no matches.
