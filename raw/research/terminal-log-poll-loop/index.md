---
topic: Confirm the current SSE pane-polling loop location/shape in host-server/index.ts and where tuning constants are defined, as prep for wiring appendTerminalLogChunk (TASK-106) into it
slug: terminal-log-poll-loop
researched: 2026-07-06
sources: [./sources.md]
---

# Research: SSE pane-polling loop location for terminal-log append wiring

> `tailPollLoop` (`host-server/index.ts:2183-2204`) is the existing SSE pane-polling loop: every `terminalPollMs` (default 2000ms, via `conductor.conf`/`config.ts`) it captures a tail-lines snapshot per unfocused agent with `capturePaneTail`, diffs it against `prevTailMap`, and on change broadcasts `terminal-output` over SSE. This is the correct, minimal insertion point for `appendTerminalLogChunk` — `agent.id` (numeric) is already in scope as `a.id`, and the config.ts `parsePositiveIntSetting` pattern is the established way to add a new tuning constant such as `TERMINAL_LOG_MAX_ROWS_PER_AGENT`.

## Research Questions
1. Exact function/symbol name and line range of the pane-capture poll loop in `host-server/index.ts`.
2. What variable holds captured pane text at that point — full snapshot vs. delta.
3. Whether delta/diff logic against a previous capture already exists.
4. Pattern used for tuning constants in `host-server/config.ts` and how `conductor.conf` maps to them.
5. How `agent.id` (numeric) is available at the call site.

## Current State (Codebase)

- **`tailPollLoop`** (`host-server/index.ts:2183-2204`, confirmed via `get_symbols_overview` + `find_symbol`):
  ```ts
  function tailPollLoop() {
    try {
      const conf = readConductorConf();
      const inventory = readTmuxWindowInventory(conf.sessionName);
      if (inventory.timedOut) return;
      if (!inventory.sessionExists) return;
      const agents = listAgents(db).filter(
        (a) => !focusedAgents.has(a.id) && inventory.windows.has(agentWindowName(a)),
      );
      for (const a of agents) {
        const wn = agentWindowName(a);
        const lines = conf.terminalTailLines;
        const text = capturePaneTail(conf.sessionName, wn, lines, 'terminal-loop');
        if (prevTailMap.get(a.id) !== text) {
          broadcastSSE('terminal-output', { agentId: a.id, agent: a.name, text, lines });
          prevTailMap.set(a.id, text);
          const found = extractPaneLabel(text);
          if (found !== null) agentLabelCache.set(a.id, found);
        }
      }
    } catch { /* tail poll is best-effort */ }
  }
  ```
- Registered at `host-server/index.ts:2368`: `startManagedLoop('tail poll', () => readConductorConf().terminalPollMs, () => { timeSync('terminalTicks', tailPollLoop); }, { warnAfterMs: 1500, backoffMs: 5000 });` — this is the loop TASK-012 (`in-progress`, per `wiki/work/tasks/index.md`) already ties to the `terminal-output` SSE event, confirming `tailPollLoop` is the canonical pane-polling-for-SSE loop.
- A separate, higher-frequency sibling **`tailPollLoopFocus`** (with its own `prevTailMapFocus`, `focusedTerminalPollMs` default 250ms, `focusedTerminalTailLines` default 300) exists for the single "focused" agent shown in an open terminal modal. It polls far more often and captures far deeper tail — appending every tick here would blow through any reasonable per-agent row cap almost immediately, and it's driven by user focus rather than session activity. Out of scope for this task; only `tailPollLoop` (the unfocused, always-on, 2s-cadence card loop) is the intended integration point.

## Key Findings

1. **Text is a tail-lines snapshot, not an incremental delta.** `capturePaneTail(sessionName, windowName, n, owner)` (`index.ts:449-457`) shells out to `tmux capture-pane` for the last `n` lines (`conf.terminalTailLines`, default 100) every tick — it is always the current bottom-of-pane snapshot, not "only what's new since last poll." [S1]
2. **Change-diff logic already exists, but it's snapshot-equality, not line-level delta.** `prevTailMap` (`Map<number, string>`, a module constant per the file's symbol overview) holds the last-broadcast snapshot per `agent.id`; the loop only acts (`broadcastSSE` + `prevTailMap.set`) when the new snapshot string differs from the stored one. There is no separate line-diffing/patch logic — it's whole-snapshot string comparison. For the log-append wiring this means: append when `text` changes (mirroring the existing SSE-broadcast condition), storing the same `text` value already computed — no new diff logic needs to be written. [S1]
3. **`agent.id` is already numeric and in scope.** `agents = listAgents(db).filter(...)` returns rows typed with a numeric `id` (used directly as `a.id` in the existing `broadcastSSE(...)` call and as the `prevTailMap` key) — this is exactly the `agentId: number` `appendTerminalLogChunk` expects; no lookup/resolution needed. [S1]
4. **Tuning-constant pattern is `config.ts`'s `ConductorConf` interface + `readConductorConf()`.** Every numeric tuning knob (`statusPollMs`, `terminalPollMs`, `focusedTerminalPollMs`, `terminalTailLines`, etc.) follows the same three-part pattern: (a) added to the `bash -c "source ${confPath} && declare -p ..."` variable list inside `readConductorConf`, (b) parsed via the existing `parsePositiveIntSetting(output, 'VAR_NAME', defaultValue)` helper (`config.ts:96-99`, returns `defaultValue` unless the parsed value is a finite positive int), (c) added as a field on the `ConductorConf` interface and the returned `cache` object. `conductor.conf` documents each knob with a comment block directly above its declaration (e.g. `TERMINAL_TAIL_LINES=100` / `FOCUSED_TERMINAL_TAIL_LINES=300` under "capture-pane line depths"). A new `TERMINAL_LOG_MAX_ROWS_PER_AGENT` constant should follow this exact three-part pattern. [S2], [S3]
5. **`appendTerminalLogChunk`/`agent_terminal_log` do not exist yet in the codebase** (`search_for_pattern` for both terms across `host-server/` returned zero matches) — confirms TASK-106 (status `todo`) is a hard, unmerged dependency; this task cannot start until TASK-106 lands. [S4]
6. **`db` is already an in-scope module constant in `index.ts`** (present in the file's top-level `Constant` symbol list), so `appendTerminalLogChunk(db, ...)` needs no new import wiring beyond the function name itself.

## Constraints

- `host-server/index.ts` is a declared hot file (per TASK-073/TASK-075 precedent and this task's own brief) — the insertion into `tailPollLoop` must be a minimal Serena symbol-level edit (`find_symbol` + `replace_symbol_body` or `insert_after_symbol`), re-reading the symbol immediately before editing, never a whole-file rewrite.
- `host-server/config.ts`'s `readConductorConf()` bash `declare -p` variable list, the `ConductorConf` interface, and the `cache` object all need the new field added consistently — missing any one of the three silently drops the value back to the hardcoded default.
- The append must not throw inside `tailPollLoop`'s existing best-effort `try { ... } catch { /* tail poll is best-effort */ }` wrapper — any DB error must not break SSE broadcasting.
- Do not touch `tailPollLoopFocus` / `prevTailMapFocus` — out of scope, would defeat the row cap.

## Recommendation

Insert the `appendTerminalLogChunk(db, a.id, text, conf.terminalLogMaxRowsPerAgent)` call inside the existing `if (prevTailMap.get(a.id) !== text) { ... }` block in `tailPollLoop`, alongside the existing `broadcastSSE`/`prevTailMap.set`/`agentLabelCache.set` calls — this reuses the already-computed `text` and the already-existing change-detection, requiring no new diff logic. Add `TERMINAL_LOG_MAX_ROWS_PER_AGENT` to `config.ts` following the exact `parsePositiveIntSetting` three-part pattern used for `terminalTailLines`, with a sane default (e.g. 500) and a `conductor.conf` comment block modeled on the existing "capture-pane line depths" section.

## Next Steps

- `/task-add` — create TASK-107 scoped exactly to this wiring (this research is prep for that task).
