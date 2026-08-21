---
topic: Confirm the current SSE pane-polling loop location/shape in host-server/index.ts and where tuning constants are defined, as prep for wiring appendTerminalLogChunk (TASK-106) into it
slug: terminal-log-poll-loop
researched: 2026-07-06
---

# Primary Sources — SSE pane-polling loop location for terminal-log append wiring

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::tailPollLoop` (lines 2183-2204), `capturePaneTail` (449-457), `startManagedLoop('tail poll', ...)` (2368) | 2026-07-06 | Full body of the SSE pane-polling loop, its cadence source (`terminalPollMs`), the snapshot-vs-`prevTailMap` change-detection, and confirmation that `a.id` is numeric and already in scope |
| S2 | codebase | `host-server/config.ts::readConductorConf` (lines 142-216) | 2026-07-06 | The three-part pattern (declare -p var list → `parsePositiveIntSetting` → `ConductorConf`/`cache` field) every tuning constant follows, including `terminalTailLines`/`terminalPollMs` precedent |
| S3 | codebase | `conductor.conf` (repo root, lines 93-109) | 2026-07-06 | Documentation-comment convention for tuning knobs (`STATUS_POLL_MS`, `TERMINAL_POLL_MS`, `TERMINAL_TAIL_LINES`, etc.) to model a new `TERMINAL_LOG_MAX_ROWS_PER_AGENT` entry on |
| S4 | codebase | `search_for_pattern("appendTerminalLogChunk\|agent_terminal_log")` across `host-server/` | 2026-07-06 | Zero matches — confirms TASK-106's schema/helpers are not yet merged, making it a hard unmerged dependency |
| S5 | codebase | `wiki/work/tasks/index.md` (TASK-012 entry) | 2026-07-06 | Cross-check: TASK-012 ("Replace tail polling with SSE push for terminal output ... backend tailPollLoop broadcasting terminal-output events") independently confirms `tailPollLoop` is the established SSE terminal-output mechanism |

## Excerpts

### S1 — `host-server/index.ts::tailPollLoop`
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

### S2 — `host-server/config.ts::parsePositiveIntSetting`
```ts
function parsePositiveIntSetting(output: string, varName: string, defaultValue: number): number {
  const parsed = parseInt(parseScalar(parseDeclare(output, varName)), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
```
Used for every `*Ms`/`*Lines` tuning field, e.g.:
```ts
const terminalPollMs = parsePositiveIntSetting(output, 'TERMINAL_POLL_MS', 2000);
const terminalTailLines = parsePositiveIntSetting(output, 'TERMINAL_TAIL_LINES', 100);
```

### S3 — `conductor.conf`
```
# capture-pane line depths for unfocused terminal cards and focused terminal
# views. Focused views stay deeper than cards while avoiding repeated 500-line
# full-screen snapshots on every modal tick.
TERMINAL_TAIL_LINES=100
FOCUSED_TERMINAL_TAIL_LINES=300
```
