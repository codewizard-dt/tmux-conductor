---
topic: "How to make the terminal text in the browser fill the width of the component instead of wrapping early"
slug: terminal-width-early-wrap
researched: 2026-08-15
sources: [./sources.md]
---

# Research: Terminal text wraps early instead of filling the component width

> The dashboard's xterm.js panel isn't the bottleneck — it's just faithfully displaying text that was already hard-wrapped at 80 columns by tmux before it ever left the host. `capturePaneTail`/`capturePaneTailRaw` in `host-server/state.ts` run `tmux capture-pane -p`, which snapshots the pane's *own* rendered width as plain text with real line breaks baked in. Because the conductor's tmux session is headless (`new-session -d`, never attached to by a real terminal) and no code anywhere sets `default-size`/`window-size`/`resize-window`, every window sits at tmux's out-of-the-box default of **80×24** — confirmed live against the user's running session. xterm's `FitAddon` correctly fits the *display grid* to the container, but that's irrelevant: the source text is already wrapped at 80 chars, so widening the browser panel just adds empty space to the right. The fix has to widen the actual tmux pane, not the frontend.

## Research Questions
- What produces the text shown in the browser terminal — a live PTY stream or a periodic snapshot?
- Where does the 80-column wrap point actually come from?
- Can the frontend (xterm.js/FitAddon/CSS) fix this on its own?
- What's the least-risk way to make the tmux pane as wide as the browser panel needs?
- Is there a more "correct" dynamic approach, and is it worth the added complexity here?

## Current State (Codebase)
- **Capture, not PTY**: `host-server/state.ts::capturePaneTail` and `capturePaneTailRaw` both shell out to `tmux capture-pane -p [-e -S -n]` [S2]. This is a point-in-time text dump of the pane's rendered screen — there is no PTY forwarded to the browser, so nothing in the browser can "ask" the shell to reflow.
- **xterm.js is a pure renderer here**: `LogTail.tsx` creates one `Terminal` + `FitAddon` per agent and repaints it wholesale via `applySnapshot()` → `term.write('\x1bc' + text, cb)` on every SSE/WS push [S3]. `fitAddon.fit()` (on a `ResizeObserver`) only changes xterm's own `cols`/`rows` grid to match its container — it has no channel back to the source of the text.
- **No resize channel exists**: the WS protocol (`terminalWebSocket.ts`) only carries `output`/`ack`/`echo`/`error` server→client and `input` client→server frames [S4]. There's no `resize` message type in either direction today.
- **No window sizing anywhere**: `conductor.sh` and `spawn.sh` create every session/window/pane via `tmux new-session -d`, `new-window`, `split-window` with zero `-x`/`-y` flags and no `default-size`/`window-size` options set [S5].
- **Confirmed live**: on the user's actually-running `conductor` session, `default-size` is tmux's factory default `80x24`, `window-size` is `latest` (also factory default), and all 4 live windows report exactly `80x24` [S6]. This lines up precisely with the screenshot's wrap point.

## Key Findings
- tmux's `window-size` option governs how an *unattached* window is sized: `latest`/`largest`/`smallest` track attached clients (there are none here, so they're moot), while `manual` freezes new windows at whatever `default-size` says, requiring an explicit `resize-window -x -y` to change [S7, S8].
- `resize-window -x <cols> -y <rows>` works on any window regardless of attached clients and is the supported primitive for setting an explicit size [S9].
- This exact failure mode — `capture-pane` baking hard wraps into plain text at the pane's current width — is a known, independently-reported tmux behavior, not something specific to this codebase [S10].
- Because capture is decoupled from rendering, the fix is entirely server-side (tmux invocation), not frontend (xterm/CSS/FitAddon) — no CSS or xterm config change can un-wrap a line that tmux already hard-broke.

## Constraints
- Single-user, fully local system (per `CLAUDE.md`) — no need to design for multiple concurrent remote viewers with genuinely different ideal widths.
- Multiple UI surfaces view the *same* tmux window at different container widths (compact accordion card vs. the wide focused modal in `LogTail.tsx`) — since tmux window size is shared across all viewers of that window, a naive "resize to exactly match whichever client is currently open" approach can thrash between the two surfaces.
- Must not touch `.env` files; any new tuning knob belongs in `conductor.conf` per existing convention (poll interval, patterns, etc. already live there).
- `spawn.sh`'s split-pane layout divides one window's width across N panes — widening the window benefits every pane proportionally, so the fix should apply at the window/session level, not per-pane.

## Solution Comparison

| Criteria | Option A — Static wide default | Option B — Dynamic resize-to-fit |
|---|---|---|
| **Approach** | Set `tmux set-option -g window-size manual` + `default-size <wide>x<tall>` once at session bootstrap (`conductor.sh`/`spawn.sh`), and `resize-window` the already-created first window to match | Frontend sends live `cols`/`rows` (from `FitAddon`) over the existing WS to the host-server, which runs `tmux resize-window -t <target> -x <cols> -y <rows>` on every fit |
| **Pros** | ~4 lines of shell; fixes both scripts; zero new protocol; no risk of resize thrashing between the accordion card and the focused modal; matches the "one canonical wide pane" mental model already implied by fixed-height CSS cards | Pixel-exact match to whatever surface is currently open; adapts automatically to any monitor/zoom/font-size change without picking a magic number |
| **Cons** | Not perfectly exact for the widest possible browser panel — must pick a "wide enough" number (e.g. 240–300 cols) up front | New WS message type + host-server handler; needs a policy for which of several simultaneous viewers "owns" the size (natural fit: only the `focused` WS-connected viewer resizes, matching the existing focus-exclusivity model) |
| **Complexity** | Low | Medium |
| **Dependencies** | None new | None new, but touches both `terminalWebSocket.ts` and `index.ts`'s WS route |
| **Codebase fit** | Drops straight into the existing bootstrap scripts (`conductor.sh`/`spawn.sh`) alongside the other `tmux new-session`/`new-window` calls | Fits the existing `focused`-exclusive WS ownership pattern noted in prior research (`raw/research/focused-terminal-latency-baseline/`) |
| **Maintenance** | Set-and-forget | Ongoing: another resize path to keep correct alongside the existing output/input/ack/echo frames |

## Recommendation

**Start with Option A.** It directly fixes the reported symptom with minimal risk: pick a generously wide fixed pane size (e.g. **260×60**) that comfortably exceeds any realistic browser-panel width at the terminal's 11px monospace font, and freeze it via `window-size manual` so it never silently reverts to `80x24`.

Implementation outline:
1. In `conductor.sh` and `spawn.sh`, right after the first `tmux new-session -d ...` call:
   ```sh
   tmux set-option -g window-size manual
   tmux set-option -g default-size 260x60
   tmux resize-window -t "$SESSION_NAME:$window_name" -x 260 -y 60   # fix the window new-session already created
   ```
   (In `spawn.sh`, target `$SESSION_NAME` directly since it doesn't name windows.)
2. Every subsequent `new-window`/`split-window` call picks up `default-size` automatically once `window-size manual` is set — no per-call-site changes needed.
3. Optionally expose the width/height as tunables in `conductor.conf` (e.g. `PANE_WIDTH`/`PANE_HEIGHT`) alongside the other tuning knobs, defaulting to 260×60, so the value isn't a magic number buried in shell.
4. No frontend change is required for this option — xterm.js will simply stop needing to soft-wrap at 80 cols, since the source text itself will already be laid out at up to 260 cols and xterm's own `FitAddon` will naturally re-wrap *that* to whatever the actual container width is (which is the desired, expected terminal behavior — an xterm.js panel narrower than 260 cols, like the compact accordion card, will still wrap, just at its own real width instead of an artificial 80).

Risks and mitigations:
- **Risk**: some CLI TUI running in a pane renders decorations sized to the full reported width (e.g. very long horizontal rules) that look odd if the user ever attaches a real, narrower terminal to the session. *Mitigation*: 260 cols is a soft ceiling most TUIs (including Claude Code's own UI) handle gracefully; if it ever matters, `resize-window -A` re-syncs to the attached client on demand.
- **Risk**: picking a width that's still too narrow for an unusually large 4K/ultrawide monitor. *Mitigation*: the `conductor.conf` tunable makes this a one-line adjustment rather than a code change.

**Alternative if constraints change**: if the dashboard later needs pixel-exact fill (e.g. as part of a broader "real PTY" migration, or if resize thrashing becomes acceptable because only one focused viewer is ever open at a time), revisit Option B — wire a `resize` WS frame through the already-`focused`-exclusive path in `LogTail.tsx`/`terminalWebSocket.ts`/`index.ts`, gated the same way input already is.

## Next Steps
- `/task-add Widen tmux pane default size (window-size manual + default-size) in conductor.sh and spawn.sh so browser terminal text stops hard-wrapping at 80 columns` — the concrete, low-risk fix from this research.
- If pixel-exact dynamic fill is wanted later, a follow-up task can add a `resize` WS message type per Option B, most naturally scoped as a ROADMAP-015-style follow-on alongside the existing focused-terminal-latency work referenced in `raw/research/focused-terminal-latency-baseline/`.
