---
topic: "Direct Input mode reliability in the tmux-conductor dashboard: audit all toggle scenarios where the Interact/Direct Input capture (frontend/src/components/LogTail.tsx, consumed by AgentDetailModal in AgentList.tsx) gains or loses focus — modal open/autofocus, log-expand (\"fullscreen\") double-click toggle, Alt+F shortcut, rename-input autofocus conflict, and any other state transition affecting the captureRef focus/handler wiring — to inform a fix roadmap."
slug: direct-input-mode-focus-reliability
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Direct Input Mode Focus Reliability

> Direct Input's keystroke-capture element (`captureRef` in `LogTail.tsx`) loses or never gains real keyboard focus in several distinct scenarios. The two the user hit (modal-open autofocus, double-click-to-expand) share a root pattern — nothing re-asserts focus onto `captureRef` after an async gate, a state change, or (critically) after xterm.js's own internal mouse-focus binding fires — but they are not the only such scenario. A focused audit of every focus-transition path is warranted before patching individual symptoms.

## Research Questions
1. Where exactly does keyboard focus get placed on/removed from the Direct Input capture element, and by what triggers?
2. Why does autofocus-on-modal-open fail intermittently?
3. Why does double-clicking the terminal (to toggle expand/"fullscreen") break Direct Input?
4. Are there other focus-transition paths in the same component that share the same defect class, so a Phase 0 audit has a known checklist rather than starting blind?
5. Is xterm.js itself a contributing factor, independent of the app's own React state races?

## Current State (Codebase)

Direct Input is implemented entirely in `frontend/src/components/LogTail.tsx`, mounted by `AgentDetailModal` in `frontend/src/components/AgentList.tsx:514-917`.

- **Capture element**: a plain `<div ref={captureRef} tabIndex={interacting ? 0 : -1} onKeyDown={interacting ? handleKeyDown : undefined} onPaste={interacting ? handlePaste : undefined} onBlur={interacting ? handleBlur : undefined} .../>` at `LogTail.tsx:658-664`. **Handlers and focusability only exist while `interacting === true`.** [S1]
- **xterm render target**: a *child* div, `xtermContainerRef`, at `LogTail.tsx:685-689`, with `onClick` (arms Direct Input + focuses `captureRef`, but only wired `when !interacting`) and `onDoubleClick={onToggleExpand}` (always wired). [S1]
- **Terminal instance**: created with `disableStdin: true` (`LogTail.tsx:280`) — intended to make xterm a read-only mirror so all real keystroke capture happens on `captureRef` instead. [S1]
- **Focus-arming effects** (all in `LogTail.tsx`):
  - `interactSignal` effect (`:448-455`) — arms Direct Input from an external signal (banner CTA), via `setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0)`.
  - `defaultInteractArmedRef` one-shot effect (`:462-469`) — same pattern, gated on `loaded && windowPresent` (i.e. after the `/agents/:id/tail` fetch resolves), guarded to fire once per mount.
  - `interacting`-change effect (`:471-474`) — `if (interacting) captureRef.current?.focus()`, re-runs only when the `interacting` boolean itself changes (or `onInteractChange` identity changes), **not** when other props like `expanded`/`logExpanded` change.
- **Expand ("fullscreen") toggle**: `onToggleExpand` is owned by the parent (`AgentList.tsx:855`, `setLogExpanded`), reachable via (a) double-click on `xtermContainerRef` (`LogTail.tsx:688`), (b) an in-component Alt/Option+F shortcut inside `handleKeyDown` (`LogTail.tsx:487-492`, `isExpandShortcut` at `:12-13`), and (c) a **duplicate** document-level Alt+F handler in `AgentDetailModal` itself (`AgentList.tsx:572-577`, `isLogExpandShortcut`). The duplicate is guarded correctly today (LogTail's local handler calls `e.stopPropagation()` at `:490` before the event can reach the document listener while `interacting` is true), but it is dead weight and a latent trap if that ordering ever changes.
- Toggling `logExpanded` does **not** change `interacting` and does **not** remount `LogTail` (`key={agent.id}` is stable) — so the focus-arming effect at `:471-474` never re-fires from an expand toggle, and no other code re-asserts focus after `onToggleExpand()` runs. [S1]
- The one place in the file that *is* defended against native browser focus-stealing is the "Direct Input" toggle **button** itself: `onMouseDown={(e) => { e.preventDefault() }}` immediately before its `onClick` (`LogTail.tsx:753-755`) — proving the author already knew mousedown-driven focus theft was a risk, but this guard was **not** applied to `xtermContainerRef`.

## Key Findings

1. **The modal-open autofocus race is a data/timer race, not a browser quirk.** Both arming effects defer the actual `.focus()` call behind (a) an async `fetch` completing (`loaded && windowPresent`) and (b) an additional `setTimeout(..., 0)`, with no verification afterward that focus actually landed and no retry if it didn't (`LogTail.tsx:448-469`). [S1] Anything the user does in that window (click the rename input, which has its own `autoFocus` at `AgentList.tsx:717-718`; click elsewhere in the still-rendering modal) wins, and is never corrected.

2. **xterm.js itself grabs focus on every mousedown into the terminal, independent of `disableStdin`.** `disableStdin` only gates `CoreService.triggerDataEvent` — i.e. it stops keystroke *data* from reaching the PTY/`onData` listeners — it does **not** disable xterm's mouse binding. `CoreBrowserTerminal.open()` wires `MouseService.bindMouse(..., () => this.focus())`, and that focus callback is invoked from the mousedown handler; `CoreBrowserTerminal.focus()` calls `this.textarea.focus({ preventScroll: true })` on xterm's own internal `xterm-helper-textarea`, which is created with `tabIndex = 0` unconditionally. [S2] This textarea is a sibling DOM node xterm manages inside the container the app renders into (`xtermContainerRef`), and it is unaffected by `disableStdin`.

3. **This is the real mechanism behind the double-click/"expand" breakage, and it is broader than double-click.** `xtermContainerRef`'s `onClick` (which re-asserts `captureRef.current?.focus()`) is only wired **when `!interacting`** (`LogTail.tsx:687`). Once Direct Input is already active (`interacting === true`), that onClick handler is `undefined` — so any subsequent mousedown anywhere inside the terminal area (single click, the first *or* second click of a double-click, a click-drag) fires xterm's internal mousedown → `CoreBrowserTerminal.focus()` → steals focus onto the hidden, `disableStdin`-blocked helper textarea, and nothing in the app ever calls `captureRef.current?.focus()` to take it back. The user's report singled out double-click-to-expand because that's the interaction they use most inside an active session, but the same defect fires for a plain single click on the terminal while already interacting. [S1] [S2]

4. **The "why does it also break on fullscreen" framing is a red herring for a Fullscreen-API bug** — there is no `requestFullscreen`/native Fullscreen API usage anywhere in the frontend; "fullscreen" here is the app's own `logExpanded` CSS-only layout toggle (`AgentList.tsx:543`, `:792`, `:843`, `:853`). No DOM remount occurs on toggle, ruling out ref-invalidation as the cause — the resize is real (`ResizeObserver` → `fitAddon.fit()` → `term.resize()` at `LogTail.tsx:323-324`) but is a red herring for the focus loss; the mousedown-into-xterm mechanism in Finding 3 is sufficient on its own and fires before any resize occurs.

5. **Native double-click word-selection can independently contribute** for browsers/OSes where an unguarded `mousedown` (`event.detail > 1`) triggers text-selection side effects; the standard mitigation is `mousedown` → `event.preventDefault()`, which the codebase already applies to the Direct Input toggle button but not to `xtermContainerRef`. [S3] This is likely a secondary, browser-dependent contributor layered on top of Finding 3, not the primary cause.

## Constraints

- `disableStdin: true` is intentional (read-only xterm mirror) and must be preserved — the fix must work *with* xterm's internal focus behavior, not by re-enabling stdin.
- `captureRef`'s handlers being conditionally attached only when `interacting` is presumably intentional (avoids stray keydown handling while the user isn't in Direct Input mode) — a fix should not make `captureRef` capture keys when Direct Input is off.
- `LogTail` is reused in more than one context (`interactSignal`/`onInteractChange`/`onCloseModal`/`onToggleExpand` are all optional props), so any fix must degrade gracefully where a prop (e.g. `onToggleExpand`) is absent.
- No test coverage currently exercises focus behavior in this file (not confirmed exhaustively, but no test file for `LogTail` focus paths was found in this pass) — a fix should come with at least a manual verification checklist per the Phase 0 audit, if not automated tests.

## Recommendation

The underlying defect class is: **every path that can move focus away from `captureRef` while `interacting === true` needs a corresponding path that moves it back**, and the two the user found are not exhaustive. Recommended fix shape (implementation left to the task/roadmap, not detailed here per this skill's scope):

1. **Phase 0 — audit every focus-transition path** before touching code: enumerate every place `interacting` can flip, every mousedown/click target inside the modal, and every `.focus()`/`.blur()` call site across `LogTail.tsx` and `AgentList.tsx`, and manually reproduce each to record which are broken today (not just the two reported). Findings 1-5 above give a concrete starting checklist:
   - Modal open (fetch-gated autofocus race)
   - `interactSignal` external re-arm (banner CTA) — same race pattern as modal open
   - Single click on terminal while `interacting` already true (Finding 3 — likely broken today, unreported)
   - Double-click / Alt+F expand toggle while interacting (reported)
   - Collapse (expand → un-expand) while interacting — same missing re-focus code path
   - Rename-input autofocus vs. Direct Input autofocus if both can be triggered close together
   - Any drag-and-drop or paste interaction that touches focus
2. **Fix xterm's focus theft directly**: attach a capturing-phase or native `mousedown` handler on `xtermContainerRef` (or on the terminal's own `element`) that calls `e.preventDefault()`/re-focuses `captureRef` after xterm's handler runs, so xterm's internal `.focus()` call on `xterm-helper-textarea` never wins while `interacting` is true — mirroring the pattern already used for the toggle button (`LogTail.tsx:754`).
3. **Fix the arm-on-mount race**: switch the initial focus-arming effects to `useLayoutEffect`, drop the `setTimeout(0)` deferral where possible, and add a short verification/retry (e.g. `requestAnimationFrame` loop checking `document.activeElement === captureRef.current`) so a lost race self-corrects instead of failing silently.
4. **Re-assert focus after any state change that can steal it while interacting is true** — most directly, after `onToggleExpand()` fires (both directions), and generally anywhere `interacting` should remain true across a re-render.

## Next Steps

- `/roadmap-create` — this research directly informs a roadmap whose Phase 0 is the audit above and later phases are the fix passes; this is already in progress in the parent conversation.
- Once the audit's findings are in hand, `/task-add --roadmap ROADMAP-NNN <description>` for each concrete fix that falls out of it (do not pre-file tasks off this report alone — the audit may surface additional broken paths not yet enumerated here).
