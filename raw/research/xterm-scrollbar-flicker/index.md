---
topic: "How to prevent the xterm.js .xterm-viewport scrollbar thumb from flashing/flickering rapidly during frequent live content updates"
slug: xterm-scrollbar-flicker
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Preventing xterm.js scrollbar flicker on frequent live repaints

> LogTail.tsx's live-tail repaint issues a full terminal reset (`\x1bc`) plus a full text rewrite on every SSE/WebSocket update while the user is following the bottom — this is a documented, known xterm.js pattern ("clear screen → full repaint", the exact cause cited in xterm.js issue #5620 and a directly analogous open-source terminal app's issue #144) that repeatedly churns `.xterm-viewport`'s `scrollTop`, retriggering the browser's native "scrollbar visible while scrolling, then fades" animation on every single update. No xterm.js-level fix is available yet in a stable release (the real upstream fix — delaying viewport DOM sync until a synchronized-output block ends — merged as PR #5770 but ships in the still-unreleased 7.0; this repo pins `@xterm/xterm: ^6.0.0`, and npm's stable latest is still 6.0.0). The recommended fix is applicable entirely in this codebase's own `applySnapshot`/follow-mode logic: coalesce/debounce how often a pending live snapshot actually reaches `term.write()` while follow-mode is active, so the DOM churn — and therefore the visual flash — happens at a bounded rate (e.g. once per ~150-250ms) instead of on every individual SSE message.

## Research Questions
- Is xterm.js's scrollbar flicker on frequent `write()`/reset-then-rewrite a known, documented issue?
- What causes it mechanically, and does it affect this specific reset-then-rewrite (`\x1bc` + text) pattern?
- What are the available fixes — library-level (upgrade/config) vs. application-level (debounce, event handling, CSS)?
- Which fix best fits this codebase's existing follow-mode architecture with the least invasive change?

## Current State (Codebase)

- `frontend/src/components/LogTail.tsx` mounts one `@xterm/xterm` (`^6.0.0`) `Terminal` per agent, once per mount (effect deps `[loaded, windowPresent, agentId]`), with `@xterm/addon-fit` for sizing [S1].
- Live updates arrive via WebSocket (`terminalWsRef`, ~line 405-410) and SSE (~line 442-448). Both paths store the latest snapshot in `pendingTextRef.current`, and — only while `followRef.current` is true (user scrolled to the bottom) — immediately call `applySnapshot(text)` [S1].
- `applySnapshot` (~line 220-227): `term.write('\x1bc' + text, callback)`. `\x1bc` is the ANSI **RIS (Full Reset)** escape sequence — it clears the entire buffer/scrollback and resets cursor state before the fresh snapshot is written in the *same* `write()` call [S1].
- A code comment directly above `applySnapshot` (~line 203-205) documents that this single-call reset+write pattern was **already chosen to fix a prior, different flicker bug**: a two-step `term.clear()` then `term.write()` left a blank intermediate frame between the two DOM updates. Combining them into one `write('\x1bc'+text)` call eliminated that *content* flicker [S1].
- A separate guard already exists for the *logical* follow-state: the xterm `'scroll'` event handler ignores scroll events while `writingRef.current` is true (i.e., while our own `applySnapshot` write is in flight) specifically to avoid our own repaint being misread as the user scrolling away from the bottom (~line 321) [S1].
- `global.css` gives `.xterm-viewport` a custom translucent `::-webkit-scrollbar-thumb` (`rgba(255,255,255,0.18)`, `scrollbar-width: thin`) and documents (in an adjacent comment) that xterm's `FitAddon` reserves a fixed 14px for this scrollbar when computing terminal columns, independent of the real OS/browser scrollbar width [S1].
- No debounce/throttle currently exists between "a live update arrived" and "`applySnapshot` runs" — every qualifying SSE/WebSocket message triggers an immediate `term.write()` when the user is at the bottom.

## Key Findings

1. **This is a known, named class of issue, not a novel bug.** A near-identical open-source project (`2code`, an xterm.js-based terminal app) filed an issue titled exactly this: *"scroll jumps to top when running AI CLI tools"*, describing "clear screen → cursor home → full repaint" output sequences as the trigger, and states plainly: **"xterm.js processes these sequences and resets viewportY, forcing scrollTop to the top"** [S2]. This is mechanically identical to `applySnapshot`'s `\x1bc`-prefixed writes.
2. **xterm.js's own issue tracker confirms the mechanism, without an application-level fix.** xterm.js issue #5620 ("Scrollbar abnormal jumping with AI CLI tools") identifies the same root cause — "AI tools use a 'clear screen before full rewrite' output mechanism, frequently triggering scroll events," which get "misinterpreted as user actions, causing incorrect scroll position calculations." The issue was closed with no merged PR and no documented workaround [S3].
3. **The real, complete upstream fix is not yet in a stable release.** `2code`'s own investigation found the actual fix merged into xterm.js as PR #5770, described as delaying "viewport DOM sync until after synchronized output block ends," which "completely eliminates flicker" — but this landed in the **7.0** line. As of this research, npm's published stable `@xterm/xterm` is still `6.0.0`; only `6.1.0-beta.*` prereleases exist beyond it (checked up to `beta.304`) [S4]. This repo pins `^6.0.0`, so it would not pick up a 7.0 release automatically even once one ships, and taking a beta or major-version dependency purely for this fix carries real upgrade risk disproportionate to the problem.
4. **A proven, dependency-free application-level mitigation exists.** The `2code` investigation cites Tabby (a popular xterm.js-based terminal app)'s merged fix (PR #11102): a `pinnedToBottom` flag that uses **wheel/keyboard capture-phase listeners** (not the `'scroll'` event) to detect genuine user-initiated scrolling, rather than reacting to `scroll` events that fire as a side effect of the terminal's own repaint [S2]. `LogTail.tsx` already does a version of this in spirit (`writingRef.current` gates the scroll handler during its own writes), but that only protects the *logical* follow-state — it does nothing to stop the DOM's `scrollTop` from actually churning on every write, which is what drives the *visual* scrollbar-thumb flash regardless of whether the app's own JS reacts to it.
5. **A third option — intercepting/stripping the VT reset sequence before xterm.js processes it — exists but is explicitly weaker.** `2code` notes a "Termdock" approach that intercepts problematic sequences before xterm.js sees them, achieving "roughly 80% effectiveness, though race conditions limit full reliability" [S2]. Not recommended here given a cleaner option (below) is available.

## Constraints

- No `@xterm/xterm` major/beta version bump — the only complete fix (PR #5770) isn't in a stable release, and this repo pins `^6.0.0`.
- Any fix should not regress the two things `followRef`/`writingRef` already protect: (a) the "no blank intermediate frame" content-flicker fix from the prior reset+write consolidation, and (b) correct follow-state tracking (auto-scroll while at the bottom, hold position while scrolled up).
- Scrollback/history correctness must be preserved — this is a read-only terminal mirror; whatever fix is applied must still eventually show the true latest state, just not necessarily on every single message the instant it arrives.

## Solution Comparison

| Criteria | A. Debounce/coalesce `applySnapshot` calls | B. Wait for xterm.js 7.0 stable + upgrade | C. Tabby-style capture-phase `pinnedToBottom` |
|----------|------|------|------|
| **Approach** | Rate-limit how often a pending live snapshot actually reaches `term.write()` while following (e.g. trailing-edge debounce, ~150-250ms) | Upgrade `@xterm/xterm` once 7.0 ships stable, relying on PR #5770's native fix | Replace `'scroll'`-event-based follow-state tracking with wheel/keydown capture-phase listeners that set an "unpin" flag only on genuine user input |
| **Pros** | Fully in-house, no new deps, directly reduces DOM-churn *frequency* (the actual driver of visible flashing), consistent with the existing reset+write consolidation this codebase already did for a prior flicker bug | Root-cause fix, "completely eliminates flicker" per source, removes the underlying churn entirely | More robust follow-state detection long-term; doesn't rely on the write path at all |
| **Cons** | Doesn't eliminate the underlying scrollTop churn, only throttles it — some residual flash may remain at the debounce boundary | Not available in a stable release; major-version risk; timeline outside this project's control | Does **not** address the root cause — `LogTail.tsx` already ignores `'scroll'` events during its own writes (`writingRef.current` guard), so this class of fix mainly matters for apps that *don't* already have that guard; here it would be redundant work solving a problem this codebase already half-solved differently, without touching the actual scrollTop-churn frequency |
| **Complexity** | Low — one `useRef`/`setTimeout` (or a small debounce helper) wrapping the existing `applySnapshot` call sites | Low code change, but blocked on an external release | Medium — new event-listener plumbing, capture-phase semantics, must not regress the existing `writingRef` guard |
| **Dependencies** | None | `@xterm/xterm` major bump (eventually) | None |
| **Codebase fit** | High — extends the exact mechanism (`applySnapshot`, `followRef`/`writingRef`) already in place | High once available, zero effort beyond the version bump | Medium — would need to coexist with or replace the existing `writingRef`-gated scroll handler, redundant with work already done |
| **Maintenance** | Self-contained, no external tracking needed | Requires watching xterm.js releases and re-testing on upgrade | Ongoing: another scroll-detection mechanism to maintain alongside the existing one |

## Recommendation

**Recommended approach: A — debounce/coalesce the live-update repaint while in follow-mode.**

This is the only option that (a) requires no dependency changes, (b) is achievable entirely within `LogTail.tsx`'s existing structure, and (c) directly targets the actual driver of the symptom — repaint *frequency* — rather than working around effects of it. It's also philosophically consistent with this file's own history: the existing `\x1bc`+write consolidation was already a "reduce the number of distinct DOM mutations" fix for a different flicker symptom: this is the same class of fix applied to the update-frequency dimension instead of the two-call-vs-one-call dimension.

### Implementation outline

1. In `LogTail.tsx`, wrap the two `applySnapshot(text)` call sites that fire on **live** updates (WebSocket ~line 408, SSE ~line 446 — **not** the initial-mount snapshot application at ~line 331, which should stay immediate) with a trailing-edge debounce: store the latest pending text (already done via `pendingTextRef`) and only actually invoke `applySnapshot` after a short quiet window (~150-250ms) since the last live message, using a `useRef<ReturnType<typeof setTimeout> | null>` timer scoped per-mount and cleared in the existing cleanup effect.
2. Keep the "catch-up on return to bottom" path (~line 325-327, `if (atBottom && pendingTextRef.current !== null ...)`) applying immediately/undebounced — that's a single user-triggered transition, not a repaint storm, and immediacy there is desirable (no reason to add lag when the user just scrolled back down).
3. Tune the debounce window empirically against real dispatch traffic (start at ~200ms — frequent enough to feel "live," infrequent enough to meaningfully cut DOM-churn count during bursts) rather than guessing a single "correct" value up front.
4. No CSS changes are needed or recommended — the flashing scrollbar is a symptom of DOM churn, not a stylable transition; suppressing it via CSS trickery (e.g., forcing `overflow: hidden` briefly) would fight the browser's own scrollbar rendering and risks worse visual artifacts than the debounce fix.

### Risks and mitigations

- **Perceived latency**: a 150-250ms debounce is below typical human-perceptible "instant" thresholds for a log tail (unlike, say, keystroke echo, which `LogTail.tsx` handles on a separate low-latency path already) — should not read as laggy. Mitigate by keeping the window short and measuring against `recordFocusedLatencySample`'s existing instrumentation if regressions are suspected.
- **Missed intermediate frames**: since each write is a full-snapshot rewrite (not incremental), coalescing two rapid updates into one simply means the intermediate state is skipped — the final state is always eventually shown. No data loss, only reduced repaint granularity while at the bottom.
- **Debounce timer leak across unmount/agent switch**: must clear the pending timeout in the same cleanup path that already disposes the terminal (~line 337-342) to avoid a stray `applySnapshot` firing against a disposed/replaced `Terminal` instance.

### Alternative if constraints change

If `@xterm/xterm` 7.0 ships stable and this project later takes that major-version upgrade for other reasons, re-evaluate whether the debounce is still needed — PR #5770's native synchronized-output viewport-sync fix may make it unnecessary, or the debounce may simply become a harmless, redundant safety margin worth keeping regardless (a fully-instant repaint every 200ms is still a "live" feel).

## Next Steps

- `/task-add Debounce LogTail.tsx's live-update repaint (applySnapshot) to ~150-250ms while in follow-mode, to stop the .xterm-viewport scrollbar from flashing on every SSE/WebSocket message` — small, self-contained, no new dependencies.
- Not recommended right now: filing a task to track the xterm.js 7.0 upgrade purely for this issue — the debounce fix is expected to resolve the user-visible symptom on its own; revisit only if a future unrelated reason to upgrade xterm.js arises.
