---
topic: drop-in web-based terminal replacements with full color and cursor support
slug: web-terminal-emulators
researched: 2026-06-22
sources: [./sources.md]
---

# Research: Web-Based Terminal Emulators (Full ANSI Color + Cursor Support)

> **xterm.js** (`@xterm/xterm`) is the definitive choice — it is the package you were thinking of (commonly called "xterm" or "xtermjs"). It is the terminal engine inside VS Code, Hyper, JupyterLab, and Theia, with full VT100/xterm-256color support including ANSI colors, cursor positioning, bold/italic/underline, and scrollback. The integration requires two coordinated changes: (1) adding the `-e` flag to the **display-only** `tmux capture-pane` calls in `host-server/state.ts` so escape sequences are preserved in the streamed text, and (2) replacing `LogTail.tsx`'s plain `<pre>` element with an xterm.js terminal instance that calls `term.write(data)`.

---

## Research Questions

1. What is the package the user was thinking of ("xterminal"/"jterminal")?
2. What alternatives exist to xterm.js for full-color browser terminal emulation?
3. What does the current codebase use for terminal display, and what must change on the backend?
4. Does `tmux capture-pane` preserve ANSI escape sequences by default, and how do you enable it?
5. What is the lightest integration path for React + xterm.js?

---

## Current State (Codebase)

### Frontend — `frontend/src/components/LogTail.tsx`

`LogTail.tsx` renders tmux pane output as plain text inside a dark `<div>` styled with:
```
whitespace-pre-wrap [overflow-wrap:anywhere] bg-[#0b0b0d] p-3 font-mono text-[11px] text-[#e7e8ea]
```
CSS classes `terminal-output` / `terminal-output-focus` are toggled based on focus state. There is no ANSI parsing — escape sequences appear as raw garbage characters.

Output arrives via two SSE event channels:
- `terminal-output` — slow poll (≈2s), all agents
- `terminal-output-focus` — fast poll (≈200ms), focused agent

### Backend — `host-server/state.ts`

Two capture-pane wrappers exist [S1]:

| Function | Flags | Lines | Used for |
|---|---|---|---|
| `capturePaneTail` | `-p` only | last N non-blank | status/mode detection, dispatch log |
| `capturePaneTailRaw` | `-p -S -N` | N lines w/ scrollback | display tail (`/agents/:id/tail` endpoint + SSE) |

**Neither function passes `-e`**, so all ANSI escape sequences are stripped by tmux before the text reaches Node.js [S4].

The plain-text path (`capturePaneTail`) feeds `detectAgentStatus` and `detectAgentMode` — these functions match regex patterns against plain text. They **must not** receive escape sequences or the regex patterns will break.

---

## Key Findings

### F1 — The package is xterm.js [S2, S3]

The package you were thinking of is **xterm.js**, npm package `@xterm/xterm` (v6.0.0). The older `xterm` package (v5.x) is deprecated; all new work uses the `@xterm/` scoped packages. It supports full VT100, xterm-256color, OSC 8 hyperlinks, and all standard cursor escape sequences.

### F2 — tmux capture-pane strips ANSI by default; `-e` enables it [S4, S5]

`tmux capture-pane -e` preserves escape sequences (colors, bold, cursor movement). Without `-e`, tmux renders the pane to a plain-text grid and discards all formatting. This is why the current LogTail shows no color even when the tmux pane itself is colorful.

**Critical constraint**: the `-e` flag must only be added to the **display** capture path (`capturePaneTailRaw`). The **status/detection** path (`capturePaneTail`) must remain plain-text so regex patterns like `BUSY_PATTERN`, `IDLE_PATTERN`, and mode-detection regexes continue to work [S1].

### F3 — xterm.js is not a streaming text appender — it is a stateful terminal [S2]

xterm.js maintains its own internal terminal buffer and cursor. You feed it raw bytes with `term.write(data)` and it interprets escape sequences in real time. You do **not** prepend past output on reconnect by sending a giant string of accumulated lines — instead, you either:
- Keep a rolling buffer of raw (escape-sequence-preserving) bytes on the server and replay them on connect, **or**
- Accept that the terminal starts fresh on each page load and only shows what arrives via SSE going forward (simplest approach for read-only display)

For a **read-only pane viewer** (what LogTail is), the second approach works fine: on mount, fetch the last N lines via `/agents/:id/tail` (needs `-e`), write them into xterm, then stream new SSE lines with `term.write`.

### F4 — React integration [S6, S7]

Two thin wrapper options exist:
- **`react-xtermjs`** (Qovery) — `<XTerm />` component + `useXTerm()` hook; actively maintained; handles addon loading and resize.
- **`@pablo-lion/xterm-react`** — similar, but less used.
- **Raw `useRef` + `useEffect`** — most control, no extra dependency; ~20 lines of React code.

The raw approach is recommended for this codebase since LogTail already has complex prop logic that would need to be threaded through a wrapper component's API.

### F5 — Bundle size [S8]

`@xterm/xterm` core (v6): ~340 KB minified, ~100 KB gzipped. Addons are tree-shaken separately:
- `@xterm/addon-fit` — auto-resize to container (~5 KB)
- `@xterm/addon-webgl` — WebGL2 renderer for high-performance output (~60 KB, optional)
- `@xterm/addon-canvas` — Canvas 2D fallback (~40 KB, optional)

The default DOM renderer requires no addon and is fine for the typical 200-line pane display in this app.

---

## Constraints

1. **Pattern-matching paths must stay plain-text**: `capturePaneTail` (used in `detectAgentStatus`, `detectAgentMode`, dispatch log) must NOT get `-e` — only the display/tail path gets it.
2. **SSE payload is text**: The `terminal-output` / `terminal-output-focus` SSE events stream the text as a string; xterm.js's `term.write()` accepts strings, so no serialization change is needed.
3. **Existing dark theme colors**: LogTail's dark styling (`bg-[#0b0b0d]`, `text-[#e7e8ea]`) should be passed as xterm.js `ITheme` options so the colors match.
4. **LogTail is also used in interact mode** with a text input; that input path (`POST /agents/:id/keys`) stays unchanged — xterm.js is read-only display only (no pty).
5. **Copy-paste UX changes**: xterm.js renders to a canvas/DOM grid, not HTML text. Selection and copy still work but look different from a native `<pre>` element.

---

## Solution Comparison

| Criteria | xterm.js (`@xterm/xterm`) | hterm (Google) | ansi-to-html + `<pre>` |
|---|---|---|---|
| **Cursor support** | Full (VT100, xterm-256color) | Full | None |
| **Color support** | Full 256+truecolor | 256 color | 256 color only |
| **Maintenance** | Active (v6, 2024) | Stale (last release 2020) | Active |
| **React integration** | Easy (raw useRef or wrapper) | Manual DOM | Easy |
| **Bundle size** | ~100 KB gz | ~150 KB gz | ~5 KB gz |
| **Scrollback** | Built-in | Built-in | Manual |
| **VS Code uses it** | Yes | No | No |
| **Complexity** | Medium | High | Low — but no cursor |

---

## Recommendation

**Use `@xterm/xterm` v6 with `@xterm/addon-fit`.** It is the clear default: VS Code ships it, it has 486+ npm dependents, full ANSI + cursor support, and TypeScript types included.

### Implementation outline

**Step 1 — Backend: add `-e` to display-only capture**

In `host-server/state.ts`, modify `capturePaneTailRaw` to add `-e` to the `capture-pane` args:
```ts
// Before: ['capture-pane', '-t', ..., '-p', '-S', `-${n}`]
// After:  ['capture-pane', '-t', ..., '-p', '-e', '-S', `-${n}`]
```
Do **not** change `capturePaneTail` (used for status/mode detection).

Also add `-e` to the `tailPollLoop` / `tailPollLoopFocus` calls in `host-server/index.ts` if they call `capturePaneTailRaw` (verify via `search_for_pattern`).

**Step 2 — Frontend: install xterm.js**
```bash
npm install @xterm/xterm @xterm/addon-fit
```

**Step 3 — Frontend: replace LogTail's text container**

Replace the `<div className="... whitespace-pre-wrap ...">` with a `<div ref={termRef} />` and, in a `useEffect`:
```ts
const term = new Terminal({
  theme: { background: '#0b0b0d', foreground: '#e7e8ea', cursor: '#e7e8ea' },
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 11,
  lineHeight: 1.3,
  scrollback: 1000,
  convertEol: true,   // important: tmux output uses \n not \r\n
  disableStdin: true, // read-only display
})
const fitAddon = new FitAddon()
term.loadAddon(fitAddon)
term.open(termRef.current)
fitAddon.fit()
```

Then on SSE events: `term.write(payload.text)` instead of appending to string state.

On initial mount: fetch `/agents/:id/tail?lines=200`, write the response text into `term.write()`.

**Step 4 — Handle resize**

Add a `ResizeObserver` on the container div and call `fitAddon.fit()` on resize.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Status-detection regexes break from stray `-e` | Only add `-e` to `capturePaneTailRaw`; `capturePaneTail` stays plain |
| xterm.js writes are non-idempotent (can't re-replay partial buffers) | Fetch full tail on mount; accept SSE-only updates after that |
| Copy-paste UX change surprises users | xterm.js has native selection/copy; behavior is familiar from VS Code |
| `convertEol: true` needed | tmux outputs `\n`; xterm.js needs `\r\n` unless this option is set |

---

## Next Steps

- `/task-add` — Replace LogTail text rendering with xterm.js (backend `-e` flag + frontend xterm.js component)
- Verify: does `tailPollLoop` in `host-server/index.ts` call `capturePaneTailRaw` or a separate inline `spawnSync`? If inline, that call also needs `-e`.
- Consider whether the `/agents/:id/tail` HTTP endpoint (used for initial mount hydration) already uses `capturePaneTailRaw`; if so, adding `-e` there covers both the HTTP and SSE paths automatically.
