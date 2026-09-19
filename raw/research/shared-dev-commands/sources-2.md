---
topic: >
  Scope TASK-add for ROADMAP-020 Phase 1 ("Fix the split-brain"): make SQLite
  the sole source of truth for bg-process definitions.
slug: shared-dev-commands
researched: 2026-09-13
---

# Primary Sources — Fix the bg-process split-brain (ROADMAP-020 Phase 1)

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts` lines 1817-1940 (`POST/DELETE /bg-processes`, `POST/DELETE /bg-processes/:name/window`) | 2026-09-13 | Confirmed the four conf-writer call sites (`appendBgProcessToConf`, `removeBgProcessFromConf`, `addBgLink`, `removeBgLink`) and the two `conf.bgProcesses.find(...)` lookups in the window handlers |
| S2 | codebase | `host-server/config.ts::appendBgProcessToConf`, `::removeBgProcessFromConf`, `::addBgLink`, `::removeBgLink`, `::readConductorConf` | 2026-09-13 | Full bodies of the four writer functions (regex-edit `conductor.conf`'s `BG_PROCESSES=(...)`/`AGENT_BG_LINKS=(...)` blocks) and confirmation that `readConductorConf` still parses both into `ConductorConf.bgProcesses`/`agentBgLinks` |
| S3 | codebase | `scripts/lib/db.sh::load_bg` (lines 71-82), `scripts/lib/db.sh::load_agents` (line 65) | 2026-09-13 | `load_bg` reads bg-process definitions from SQLite only; `load_agents`'s SQL joins `bg_processes.linked_agent_id` directly — confirms the bash side never reads `AGENT_BG_LINKS` from conductor.conf for the link, only from SQLite |
| S4 | codebase | `scripts/conductor.sh` lines 62-66, `scripts/spawn.sh` lines 53-57 (and their container-mode duplicate blocks) | 2026-09-13 | `CONDUCTOR_BG_NAME`/`CONDUCTOR_BG_LOG`/`CONDUCTOR_BG_STATE` env injection is driven by `_linked_bg`, which `load_agents` populates from the SQLite join in S3 — confirms the link is SQLite-driven at runtime today |
| S5 | codebase | `host-server/db.ts::listBgProcesses` (674-676), `::createBgProcess` (678-683), `::deleteBgProcess` (685-687), `host-server/db.test.ts` (full-file pattern search) | 2026-09-13 | Confirmed the three functions' exact signatures/behavior, and that `db.test.ts` has zero `BgProcess`-related test cases — no existing coverage to preserve, only to add |
| S6 | codebase | `frontend/src/components/AddBgProcessForm.tsx` (fetch to `${API_URL}/bg-processes`), `frontend/src/components/AgentList.tsx` lines ~1208-1245 (`callApi` to `/bg-processes/:name[/window]`) | 2026-09-13 | Confirmed the frontend only depends on the existing JSON request/response contract, not on how the backend stores the data — no frontend changes required by this task |

## Excerpts

### S1 — `host-server/index.ts`
`host-server/index.ts:1847-1849`
> // conductor.conf is authoritative for bg processes (what conductor.sh spawns
> // and teardown.sh kills) — write the definition there, not the DB.
> await appendBgProcessToConf(conf._confPath, name, workdir, launchCmd);

### S3 — `scripts/lib/db.sh`
`scripts/lib/db.sh:65` (inside `load_agents`)
> done < <(sql "SELECT a.name, a.workdir, a.launch_cmd, COALESCE(b.name,''), COALESCE(p.name || '-' || a.name, a.name), a.id, COALESCE(a.project_id,'') FROM agents a LEFT JOIN bg_processes b ON b.linked_agent_id=a.id LEFT JOIN projects p ON a.project_id=p.id ORDER BY a.name")

`scripts/lib/db.sh:71-82` (`load_bg`)
> load_bg() {
>   BG_NAMES=()
>   declare -gA BG_DIRS
>   declare -gA BG_CMDS
>   local name workdir cmd
>   while IFS=$'\x1f' read -r name workdir cmd; do
>     [[ -z "$name" ]] && continue
>     BG_NAMES+=("$name")
>     BG_DIRS["$name"]="$workdir"
>     BG_CMDS["$name"]="$cmd"
>   done < <(sql "SELECT name, workdir, launch_cmd FROM bg_processes ORDER BY name")
> }

### S4 — `scripts/conductor.sh`
`scripts/conductor.sh:62-66`
> if [ -n "$_linked_bg" ]; then
>   _bg_env=" CONDUCTOR_BG_NAME='$_linked_bg' CONDUCTOR_BG_LOG='$LOG_DIR/bg-$_linked_bg.log' CONDUCTOR_BG_STATE='$STATE_DIR/bg-$_linked_bg.state'"
> fi
> env_prefix="CONDUCTOR_AGENT_NAME='$window_name' CONDUCTOR_STATE_DIR='$STATE_DIR' CONDUCTOR_LOG_DIR='$LOG_DIR'$_bg_env"
> tmux send-keys -t "$SESSION_NAME:$window_name" "$env_prefix $launch_cmd" Enter
