---
topic: why some but not all 'inactive' agents are showing a window from another agent (possible name collision? `tmux-conductor-3` inactive is showing `tmux-conductor-3-copy` active terminal)
slug: inactive-agent-shows-other-agents-window
researched: 2026-09-19
sources: [./sources.md]
---

# Research: Inactive agent shows another agent's tmux window

> **Root cause: tmux prefix matching, not a DB/name collision.** The host-server addresses every pane with `-t <session>:<windowName>`. tmux resolves the window part by exact name first, then falls back to a unique **prefix** match (and fnmatch). An agent whose own window is gone (`tmux-conductor-tmux-conductor-3`) therefore silently resolves to the still-running window `tmux-conductor-tmux-conductor-3-copy`, because the dead agent's window name is a prefix of the copy's. It is "some but not all" because only agents whose window name is a strict prefix of another live window's name are affected. The status badge is correct ("NO WINDOW") since it uses an exact-match inventory; the terminal pane, tail endpoint, and — worse — every write path (keys, upload, kill, dispatch) use the prefix-matching target and hit the wrong pane. Fix: address windows with tmux's exact-match `=` prefix (`session:=window`) or by window id.

## Research Questions
1. Is the DB/agent-name model producing a real collision, or is this a lookup problem?
2. How does the host-server target a tmux window, and how does tmux resolve that target?
3. Why do `tmux-conductor-3` show the copy's terminal but `tmux-conductor-2` / `roadmap` do not?
4. Which code paths are affected (read-only vs. mutating)?
5. What is the minimal, correct fix?

## Current State (Codebase)
- Window name = `${projectName}-${agentName}` via `agentWindowName()` (`host-server/db.ts:33`). Agent `tmux-conductor-3` in project `tmux-conductor` → window `tmux-conductor-tmux-conductor-3`. The clone is `tmux-conductor-3-copy` → window `tmux-conductor-tmux-conductor-3-copy`. [S1]
- Live tmux session at research time had windows `…-3-copy` (index 9) and `tmux-conductor-roadmap` (7), but no window for `…-3` or `…-2`. [S2]
- **Status detection is exact-match and correct**: the snapshot/poll path builds a `Map<windowName, paneCmd>` from one `list-windows` call and does `inventory.windows.get(wn)`; a miss → `windowPresent=false` → `no-window`. This is why the badge reads NO WINDOW for both screenshots. [S3][S4]
- **Everything else builds `-t ${sessionName}:${windowName}` (prefix-matching)**: `capturePaneTail`, `capturePaneTailRaw`, cursor `display-message`, `isPaneDead`, `isTmuxWindowPresent` (`has-session -t sess:win`), `sendTextToPane`, and the inline `kill-window` / `rename-window` / `send-keys BTab` / `pipe-pane` calls in `host-server/index.ts`. [S5][S6]
- `isTmuxWindowPresent` is the guard used by the terminal endpoints and mutating routes, so the guard itself passes for a prefix match. [S5][S6]
- The 2-second `terminal-loop` / `focused-terminal-loop` capture every agent's pane **without** a `windowPresent` check, so the wrong-pane text is broadcast over SSE straight into the dashboard's terminal view. [S6]
- Bash scripts use the same idiom (`tmux has-session -t "$target"`, `send-keys -t`, `capture-pane -t` in `monitor.sh`, `dispatch.sh`, `teardown.sh`). [S7]

## Key Findings
1. **tmux prefix-matches window targets — verified empirically (tmux 3.7c).** With windows `…-3-copy` present and `…-3` absent: `has-session -t conductor:…-3` → rc 0 and `display-message` reports window `9 …-3-copy`; `…-2` (no prefix match) → "can't find window", rc 1; `conductor:=…-3` (exact-match prefix) → "can't find window", rc 1. [S2]
2. **Not a name collision.** Names are distinct in the DB and in tmux; it is a target-resolution problem. The "collision" instinct is close — one name is a prefix of the other — but tmux never sees two windows with the same name. [S1][S2]
3. **Why "some but not all":** only agents whose `project-name` window name is a strict prefix of another live window's name are exposed: `…-3` (prefix of `…-3-copy`). `…-2` and `roadmap` have no such sibling, so their pane resolves to nothing and shows "Window not present." (screenshot 2). The `…-copy` naming produced by `POST /agents/:id/clone` guarantees this prefix relationship for every cloned agent whose original is stopped. [S1][S2]
4. **The bug is worse than a display glitch — writes go to the wrong pane.** Because `isTmuxWindowPresent` passes on a prefix match, an inactive agent's UI actions act on the *copy*:
   - Interact mode "DIRECT INPUT — KEYS GO TO TMUX-CONDUCTOR-3" (visible in screenshot 1) → `sendDirectInput` → keys/text typed into the copy's pane. [S5]
   - `POST /agents/:id/upload` (image drop) types a path into the copy. [S5]
   - "Stop"/kill-window (index.ts:1277-1282) and delete (1388-1390) → `kill-window -t sess:…-3` **kills the copy's live window**. [S5]
   - Queue dispatch / `monitor.sh` `has-session` guards can likewise dispatch to the copy. [S7]
   - Creating/spawning an agent whose window name is a prefix of a live window returns `409 window already exists` (1065, 1909, 2023). [S5]
5. **Secondary:** `extractPaneLabel(text)` on the wrong pane text can assign the copy's label to the inactive agent (`terminal-loop`). [S6]

## Constraints
- Must not break exact-name lookups for existing agents (window names may contain `-`, `.`, etc.; tmux special chars `:` and `.` in window names already problematic for targets — separate concern).
- `TMUX_SYNC_TIMEOUT_MS` sync-spawn model: fix should not add extra tmux calls to hot paths (the inventory Map already gives exact presence for free).
- Bash scripts and TS both need the same fix; host-server has duplicated `capturePaneTail*` in `index.ts` and `state.ts`.

## Solution Comparison

| Criteria | A: `=` exact-match prefix (`sess:=win`) | B: Use window IDs (`@N`) from inventory | C: Guard only (presence check from inventory) |
|----------|------|------|------|
| **Approach** | Central `windowTarget(session, win)` helper returns `` `${session}:=${win}` ``; replace all template targets | Resolve name→`window_id` from `list-windows`, target `@N` | Replace `isTmuxWindowPresent` with exact `list-windows` membership; leave targets as-is |
| **Pros** | Tiny, keeps API; verified to work; fixes reads and writes | Immune to rename/duplicate names, also disambiguates duplicates | Smallest change |
| **Cons** | Must touch every call site (TS + bash); still ambiguous with duplicate names | Extra lookup per call or a cache; ids go stale on respawn | Race window between check and use; unguarded loops still mis-target; misses `kill-window` etc. if any call skips the guard |
| **Complexity** | Low | Medium | Low |
| **Codebase fit** | High | Medium | Medium |
| **Maintenance** | Low (one helper) | Medium | Higher (relies on every caller remembering the guard) |

## Recommendation
**Option A, plus making `isTmuxWindowPresent` exact.**
1. Add `windowTarget(sessionName, windowName)` → `${sessionName}:=${windowName}` in `host-server/state.ts`; export and use it in every `-t` (capture, display-message, send-keys, kill-window, rename-window, pipe-pane, has-session) in `state.ts` and `index.ts`. De-duplicate the two `capturePaneTail*` implementations while there.
2. `isTmuxWindowPresent` uses the new target, so all existing guards become exact.
3. In `terminal-loop` / `focused-terminal-loop`, skip agents whose inventory entry is absent (avoids a wasted tmux call and any residual leakage).
4. Bash: quote targets as `"$SESSION_NAME:=$window_name"` in `monitor.sh`, `dispatch.sh`, `teardown.sh`, `broadcast.sh`, `conductor.sh` bg pipe-pane lines.
5. Tests: a `state.test.ts` case with two windows `foo` / `foo-copy` asserting `isTmuxWindowPresent('s','foo')` is false when only `foo-copy` exists (uses a throwaway tmux session under `./tmp/`), plus a regression check on `capturePaneTail` returning `''`.

**Risks:** `=` is supported by tmux ≥ 2.1 (project requires ≥ 3.0 — OK); window names containing `:` or `.` remain unaddressable (pre-existing). Existing duplicate-name detection (`windowState`) is already exact and unchanged.

**If constraints change:** if duplicate window names must be tolerated, move to Option B (window ids).

## Next Steps
- `/task-add` "Address tmux windows with exact-match `=` targets (fix inactive agent showing sibling's window; also prevents keys/kill hitting `-copy`)".
- Interim workaround: don't use Interact/Stop/Delete on an inactive agent while its `-copy` is running, or rename the copy so the original name isn't its prefix.
- Consider filing as a BUG (data-loss class: kill-window on the wrong agent): `/bug-file`.
