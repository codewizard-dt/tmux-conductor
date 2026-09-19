---
topic: "How to prevent the xterm.js .xterm-viewport scrollbar thumb from flashing/flickering rapidly during frequent live content updates"
slug: xterm-scrollbar-flicker
researched: 2026-09-13
---

# Primary Sources — Preventing xterm.js scrollbar flicker on frequent live repaints

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/LogTail.tsx` (lines ~156, 180-227, 285-343, 400-450); `frontend/src/styles/global.css` (lines ~150-208); `frontend/package.json` (`@xterm/xterm`, `@xterm/addon-fit` deps) | 2026-09-13 | Confirmed the exact repaint mechanism (`\x1bc` RIS reset + full text write in `applySnapshot`), the existing `writingRef`-gated scroll-ignore guard, the prior content-flicker fix documented in a code comment, and the custom `.xterm-viewport` scrollbar CSS |
| S2 | web | https://github.com/AkaraChen/2code/issues/144 | 2026-09-13 | Confirmed this is a known class of issue in xterm.js-based terminal apps generally ("clear screen → full repaint" causing `viewportY` reset); enumerated three concrete mitigation strategies (Tabby's `pinnedToBottom` capture-phase flag, xterm.js 7.0's PR #5770 native fix, Termdock's ~80%-effective VT-sequence interception) |
| S3 | web | https://github.com/xtermjs/xterm.js/issues/5620 | 2026-09-13 | Upstream xterm.js issue confirming the same root cause ("clear screen before full rewrite... frequently triggering scroll events" misinterpreted as user actions); closed with no merged fix or workaround documented on the issue itself |
| S4 | web (npm registry) | `npm view @xterm/xterm versions` / `npm view @xterm/xterm version` (run 2026-09-13) | 2026-09-13 | Confirmed stable-latest `@xterm/xterm` is still `6.0.0` (matching this repo's pinned `^6.0.0`); only `6.1.0-beta.1` through `6.1.0-beta.304` exist beyond it — the 7.0 line carrying PR #5770's real fix is not yet stable |

## Excerpts

### S2 — 2code issue #144 (via WebFetch summary)
https://github.com/AkaraChen/2code/issues/144
> "AI tools use a 'clear screen before full rewrite' output mechanism, frequently triggering scroll events." … "xterm.js processes these sequences and resets viewportY, forcing scrollTop to the top."
> Tabby's merged PR #11102: "Introduces a `pinnedToBottom` flag. Uses wheel/keyboard capture phase to exclusively unpin."
> xterm.js 7.0 (PR #5770, merged upstream): "Delays viewport DOM sync until after synchronized output block ends. Completely eliminates flicker."
> Termdock's VT-sequence interception: "roughly 80% effective, though race conditions limit full reliability."

### S3 — xterm.js issue #5620 (via WebFetch summary)
https://github.com/xtermjs/xterm.js/issues/5620
> "AI tools use a 'clear screen before full rewrite' output mechanism, frequently triggering scroll events." … "scroll events triggered by screen clearing are misinterpreted as user actions, causing incorrect scroll position calculations."
> Issue closed, labeled `type/question`, with "No branches or pull requests" — no merged fix or documented application-level workaround on the issue itself.

### S4 — npm registry query
Command: `npm view @xterm/xterm versions --json` / `npm view @xterm/xterm version` (executed 2026-09-13)
> Latest stable: `6.0.0`. Highest listed version overall: `6.1.0-beta.304` (prerelease channel only — no `7.0.0` or `6.1.0` stable release exists yet).
