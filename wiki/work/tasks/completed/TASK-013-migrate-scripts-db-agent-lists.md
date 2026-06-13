---
id: TASK-013
title: "Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists"
status: done
created: 2026-06-12
updated: 2026-06-12
depends_on: [TASK-009]
blocks: []
parallel_safe_with: [TASK-001, TASK-011, TASK-012]
uat: "../uat/UAT-013-migrate-scripts-db-agent-lists.md"
tags: [shell, sqlite, conductor, spawn, teardown, broadcast]
---

# TASK-013 — Migrate conductor.sh, spawn.sh, teardown.sh, broadcast.sh to DB-loaded agent lists

## Objective

Migrate the four remaining lifecycle scripts — `scripts/conductor.sh`, `scripts/spawn.sh`, `scripts/teardown.sh`, `scripts/broadcast.sh` — off `conductor.conf`'s `AGENTS=(...)` / `BG_PROCESSES=(...)` bash arrays and onto the SQLite-backed loaders in `scripts/lib/db.sh`. Each script sources `lib/db.sh`, calls `load_agents` (and `load_bg` where it iterates background processes), and iterates the resulting `AGENT_NAMES[]` / `BG_NAMES[]` indexed arrays plus the `AGENT_DIRS`/`AGENT_CMDS`/`AGENT_BG` and `BG_DIRS`/`BG_CMDS` associative arrays — exactly as `monitor.sh` already does after TASK-010. Every script must preserve its existing behavior.

## Approach

TASK-009 created `scripts/lib/db.sh` with `sql()`/`sql_one()`, `load_agents`, `load_bg`, and `pop_task_sql`. `load_agents` resets `AGENT_NAMES=()` then populates it (ordered `ORDER BY a.name`) along with `AGENT_DIRS["$name"]`, `AGENT_CMDS["$name"]`, and `AGENT_BG["$name"]` (the linked bg-process name, empty string if none, via `LEFT JOIN bg_processes`). `load_bg` resets `BG_NAMES=()` then populates it (ordered `ORDER BY name`) along with `BG_DIRS["$name"]` and `BG_CMDS["$name"]`. TASK-010 already wired this into `monitor.sh` (sources `lib/db.sh`, then `conductor.conf` for the remaining scalar settings, then calls `load_agents`/`load_bg`).

The four target scripts today each iterate the conf arrays directly. The current shapes are:

- **conductor.sh** — `echo "Agents: ${#AGENTS[@]}"` / `"BG procs: ${#BG_PROCESSES[@]}"`; a validation loop `for _entry in "${AGENTS[@]}"; do IFS=: read -r _name _workdir _ <<< "$_entry"; ... done`; builds a `_bg_link` map (per-agent linked bg → `CONDUCTOR_BG_*` env); creates the session from `${AGENTS[0]}` then a window per `${AGENTS[$i]}` for `i=1..${#AGENTS[@]}-1` (`IFS=: read -r name workdir launch_cmd`); spawns one window per `"${BG_PROCESSES[@]}"` entry guarded by `[ "${#BG_PROCESSES[@]}" -gt 0 ]`.
- **spawn.sh** — same shape as conductor.sh but split-pane: `echo "Agents: ${#AGENTS[@]}"`; validation loop over `"${AGENTS[@]}"`; first agent from `${AGENTS[0]}` via `tmux new-session`, remaining via `tmux split-window` + `select-layout tiled` for `i=1..${#AGENTS[@]}-1`; one split per `"${BG_PROCESSES[@]}"` entry; final summary lines reference `${#AGENTS[@]}` and `${#BG_PROCESSES[@]}`.
- **teardown.sh** — `for entry in "${AGENTS[@]}"; do IFS=: read -r name _workdir _launch_cmd; dispatch.sh "$SESSION_NAME:$name" "/exit"; done`, then `for entry in "${BG_PROCESSES[@]:-}"; do ... tmux send-keys ... C-c; done`.
- **broadcast.sh** — `for entry in "${AGENTS[@]}"; do IFS=: read -r name _workdir _launch_cmd; target="$SESSION_NAME:$name"; ... dispatch.sh "$target" "$CMD"; done`.

The migration pattern (mirroring monitor.sh): keep `source "$SCRIPT_DIR/../conductor.conf"` for scalar settings (`SESSION_NAME`, `STATE_DIR`, `LOG_DIR`, etc.) — `db.sh` only sources the conf in a subshell to extract `DB_PATH`, so conf scalars are NOT exported into the script's scope. Add `source "$SCRIPT_DIR/lib/db.sh"` and a `load_agents` (+ `load_bg` for conductor.sh/spawn.sh/teardown.sh) call before the first agent/bg iteration. Replace each `for ... in "${AGENTS[@]}"` / index loop with iteration over `"${AGENT_NAMES[@]}"`, reading fields from the associative arrays (`AGENT_DIRS["$name"]`, `AGENT_CMDS["$name"]`, `AGENT_BG["$name"]`) instead of `IFS=: read`. Replace `"${BG_PROCESSES[@]}"` loops with `"${BG_NAMES[@]}"` + `BG_DIRS`/`BG_CMDS`. Replace `${#AGENTS[@]}` / `${#BG_PROCESSES[@]}` counts with `${#AGENT_NAMES[@]}` / `${#BG_NAMES[@]}`.

> **First-vs-rest note (conductor.sh / spawn.sh):** both scripts special-case `${AGENTS[0]}` (creates the session) then loop `${AGENTS[$i]}` from index 1. After migration, index `AGENT_NAMES[0]` for the first agent and loop `for (( i=1; i<${#AGENT_NAMES[@]}; i++ )); do name="${AGENT_NAMES[$i]}"; ...`. Preserve this two-phase structure; do not collapse it.

> **bg-link note (conductor.sh / spawn.sh):** the existing `_bg_link[$name]` lookup that injects `CONDUCTOR_BG_NAME`/`CONDUCTOR_BG_LOG`/`CONDUCTOR_BG_STATE` is exactly what `AGENT_BG["$name"]` now provides (empty string = no link). Replace the `_bg_link` build/lookup with `AGENT_BG["$name"]`, keeping the `[ -n "$_linked_bg" ]` guard and the identical env-prefix string.

## Steps

### 1. Migrate conductor.sh to load_agents / load_bg  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `get_symbols_overview` / `search_for_pattern` on `scripts/conductor.sh` to confirm current `AGENTS`/`BG_PROCESSES` usage and the `_bg_link` build
- [x] After `SCRIPT_DIR` setup and the existing `source "$SCRIPT_DIR/../conductor.conf"`, add `source "$SCRIPT_DIR/lib/db.sh"` then `load_agents` and `load_bg` (keep the conf source — `db.sh` only sources conf in a subshell, so `SESSION_NAME`/`STATE_DIR`/`LOG_DIR` still come from the explicit conf source)
- [x] Replace `${#AGENTS[@]}` → `${#AGENT_NAMES[@]}` and `${#BG_PROCESSES[@]}` → `${#BG_NAMES[@]}` in the banner echoes
- [x] Rewrite the git-root validation loop to iterate `"${AGENT_NAMES[@]}"`, reading `_workdir="${AGENT_DIRS["$name"]}"` instead of `IFS=: read`
- [x] Replace the `_bg_link` map build with direct `AGENT_BG["$name"]` lookups; keep the `[ -n "$_linked_bg" ]` guard and identical `CONDUCTOR_BG_*` env-prefix
- [x] First agent: `name="${AGENT_NAMES[0]}"; workdir="${AGENT_DIRS["$name"]}"; launch_cmd="${AGENT_CMDS["$name"]}"`; remaining via `for (( i=1; i<${#AGENT_NAMES[@]}; i++ ))` indexing `AGENT_NAMES[$i]`
- [x] Replace the `BG_PROCESSES` window-spawn block: guard `[ "${#BG_NAMES[@]}" -gt 0 ]`, loop `for name in "${BG_NAMES[@]}"`, read `BG_DIRS["$name"]` / `BG_CMDS["$name"]`, keep the `tmux new-window` + `send-keys` + `pipe-pane` + log line unchanged
- [x] Verify the `monitor` window creation and any `REPO_ROOT` references are untouched

### 2. Migrate spawn.sh to load_agents / load_bg  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `search_for_pattern` on `scripts/spawn.sh` to confirm current `AGENTS`/`BG_PROCESSES` usage (split-pane variant)
- [x] Add `source "$SCRIPT_DIR/lib/db.sh"` + `load_agents` + `load_bg` after the existing conf source
- [x] Replace `${#AGENTS[@]}` / `${#BG_PROCESSES[@]}` counts (banner + final summary lines) with `${#AGENT_NAMES[@]}` / `${#BG_NAMES[@]}`
- [x] Rewrite the git-root validation loop to iterate `"${AGENT_NAMES[@]}"` reading `AGENT_DIRS["$name"]`
- [x] Replace `_bg_link` with `AGENT_BG["$name"]` lookups (same guard + env-prefix as conductor.sh)
- [x] First agent from `AGENT_NAMES[0]` (`tmux new-session`); remaining via `for (( i=1; i<${#AGENT_NAMES[@]}; i++ ))` using `tmux split-window` + `select-layout tiled` (preserve the tiled rebalance after each split)
- [x] Replace the `BG_PROCESSES` split block: guard `[ "${#BG_NAMES[@]}" -gt 0 ]`, loop `"${BG_NAMES[@]}"` reading `BG_DIRS`/`BG_CMDS`, keep `tmux split-window` + `send-keys` + `pipe-pane` + `select-layout tiled` + log line unchanged

### 3. Migrate teardown.sh to load_agents / load_bg  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `search_for_pattern` on `scripts/teardown.sh` to confirm the two loops (`/exit` to agents, `C-c` to bg)
- [x] Add `source "$SCRIPT_DIR/lib/db.sh"` + `load_agents` + `load_bg` after the existing conf source
- [x] Rewrite the `/exit` loop to iterate `"${AGENT_NAMES[@]}"` and call `dispatch.sh "$SESSION_NAME:$name" "/exit" || true` (drop the `IFS=: read`)
- [x] Rewrite the `C-c` loop to iterate `"${BG_NAMES[@]}"` (replacing `for entry in "${BG_PROCESSES[@]:-}"; do [ -z "$entry" ] && continue`); keep `tmux send-keys -t "$SESSION_NAME:$name" C-c 2>/dev/null || true`
- [x] Confirm the `sleep 10` graceful-exit wait and `tmux kill-session` are unchanged

### 4. Migrate broadcast.sh to load_agents  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Use Serena `search_for_pattern` on `scripts/broadcast.sh` to confirm the single fan-out loop
- [x] Add `source "$SCRIPT_DIR/lib/db.sh"` + `load_agents` after the existing conf source (no `load_bg` — broadcast only targets agents)
- [x] Rewrite the loop to iterate `"${AGENT_NAMES[@]}"`: `target="$SESSION_NAME:$name"`, keep the `tmux has-session` guard, the `dispatch.sh "$target" "$CMD"` call, the `sent`/`skipped` counters, and the "pane not found" skip message unchanged

### 5. Syntax verification (all four scripts)  <!-- agent: general-purpose --> <!-- Completed: 2026-06-12 -->

- [x] Run `bash -n scripts/conductor.sh` — no syntax errors
- [x] Run `bash -n scripts/spawn.sh` — no syntax errors
- [x] Run `bash -n scripts/teardown.sh` — no syntax errors
- [x] Run `bash -n scripts/broadcast.sh` — no syntax errors
- [x] Confirm none of the four scripts still reference `${AGENTS[` or `${BG_PROCESSES[` (Serena `search_for_pattern` over `scripts/` should return zero matches in these four files)
