---
topic: why some but not all 'inactive' agents are showing a window from another agent (possible name collision? `tmux-conductor-3` inactive is showing `tmux-conductor-3-copy` active terminal)
slug: inactive-agent-shows-other-agents-window
researched: 2026-09-19
---

# Primary Sources — Inactive agent shows another agent's tmux window

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/db.ts::agentWindowName` | 2026-09-19 | Window name is `${projectName}-${name}`; clone `-copy` name is a superstring of the original |
| S2 | tmux (live) | `tmux list-windows -a`, `has-session`, `display-message`, `capture-pane` against session `conductor` (tmux 3.7c) | 2026-09-19 | Empirical proof of prefix matching and that `=` exact-match prefix rejects it |
| S3 | codebase | `host-server/state.ts::readTmuxWindowInventory` | 2026-09-19 | Exact-name `Map<window, paneCmd>` from a single `list-windows` |
| S4 | codebase | `host-server/index.ts` snapshot/poll (`inventory.windows.get(wn) ?? null`, lines ~237-241, ~2491-2496) | 2026-09-19 | Status path uses exact lookup → correct NO WINDOW badge |
| S5 | codebase | `host-server/state.ts::isTmuxWindowPresent`, `capturePaneTail`, `capturePaneTailRaw`, `isPaneDead`, `sendTextToPane`; `host-server/index.ts` routes (kill-window ~1282/1390, keys, upload, tail ~1585, ws ~1709, 409 "window already exists" ~1065/1909/2023) | 2026-09-19 | All use `-t sess:win` prefix-matching targets; the presence guard passes on prefix match |
| S6 | codebase | `host-server/index.ts` terminal-loop (~2708-2714) and focused-terminal-loop (~2737-2743) | 2026-09-19 | Captures every agent's pane with no `windowPresent` check and broadcasts over SSE |
| S7 | codebase | `scripts/monitor.sh` (has-session ~509, capture-pane ~178/228), `scripts/dispatch.sh`, `scripts/teardown.sh`, `scripts/broadcast.sh` | 2026-09-19 | Bash side uses the same prefix-matching `-t "$SESSION:$name"` idiom |
| S8 | screenshot | `tmp/dashboard-drops/1789797079126-Screenshot-2026-09-19-at-12.50.14-AM.png`, `…1789797079149-Screenshot-2026-09-19-at-12.50.09-AM.png` | 2026-09-19 | `tmux-conductor-3` (NO WINDOW) shows live terminal + "DIRECT INPUT — KEYS GO TO TMUX-CONDUCTOR-3"; `tmux-conductor-2` (NO WINDOW) shows "Window not present." |

## Excerpts

### S2 — live tmux resolution test
Command: `tmux has-session|display-message|capture-pane -t "conductor:<name>"`; windows present: `tmux-conductor-tmux-conductor-3-copy` (idx 9), `tmux-conductor-roadmap` (idx 7).
```
target conductor:tmux-conductor-tmux-conductor-3        -> has-session rc=0; display-message: "9 tmux-conductor-tmux-conductor-3-copy"
target conductor:tmux-conductor-tmux-conductor-2        -> "can't find window: tmux-conductor-tmux-conductor-2"; rc=1
target conductor:tmux-conductor-tmux-conductor-3-copy   -> rc=0; "9 tmux-conductor-tmux-conductor-3-copy"
target conductor:=tmux-conductor-tmux-conductor-3       -> "can't find window: tmux-conductor-tmux-conductor-3"; rc=1
```

### S5 — the guard and a target
`host-server/state.ts`:
```ts
export function isTmuxWindowPresent(sessionName: string, windowName: string): boolean {
  const result = spawnSync('tmux', ['has-session', '-t', `${sessionName}:${windowName}`], {
```

### S3 — exact inventory
`host-server/state.ts`:
```ts
['list-windows', '-t', sessionName, '-F', '#{window_name}\t#{pane_current_command}'],
```
`host-server/index.ts`: `const paneCurrentCommand = inventory.windows.get(wn) ?? null; const windowPresent = paneCurrentCommand !== null;`
