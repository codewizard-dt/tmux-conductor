---
topic: "Direct Input mode reliability in the tmux-conductor dashboard: audit all toggle scenarios where the Interact/Direct Input capture (frontend/src/components/LogTail.tsx, consumed by AgentDetailModal in AgentList.tsx) gains or loses focus — modal open/autofocus, log-expand (\"fullscreen\") double-click toggle, Alt+F shortcut, rename-input autofocus conflict, and any other state transition affecting the captureRef focus/handler wiring — to inform a fix roadmap."
slug: direct-input-mode-focus-reliability
researched: 2026-09-13
---

# Primary Sources — Direct Input Mode Focus Reliability

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `frontend/src/components/LogTail.tsx` (symbols: `LogTail`, `isExpandShortcut`, `handleKeyDown`, `handleBlur`), `frontend/src/components/AgentList.tsx` (symbol: `AgentDetailModal`) | 2026-09-13 | All focus-transition code paths: `captureRef` conditional wiring, arm-on-mount effects, `interacting`-change effect, `xtermContainerRef` click/dblclick wiring, `disableStdin` terminal option, `ResizeObserver`→`fitAddon.fit()`, the duplicate Alt+F handlers, the toggle button's `onMouseDown` guard, and the rename input's `autoFocus`. |
| S2 | context7 | `/xtermjs/xterm.js` — "disableStdin option focus textarea helper element" | 2026-09-13 | Confirms `disableStdin` only gates `CoreService.triggerDataEvent` (blocks data reaching the PTY), and does not affect `MouseService.bindMouse`'s mousedown→`CoreBrowserTerminal.focus()`→`textarea.focus({preventScroll:true})` binding on the always-`tabIndex=0` `xterm-helper-textarea`. |
| S3 | web | https://bobbyhadz.com/blog/disable-text-selection-on-double-click-in-javascript-or-css | 2026-09-13 | Confirms the standard browser mitigation for double-click-triggered text selection/focus side effects is a `mousedown` listener calling `event.preventDefault()` (optionally gated on `event.detail > 1`), consistent with the pattern already used for the Direct Input toggle button in this codebase. |

## Excerpts

### S2 — xterm.js: mousedown wired to internal focus(), independent of disableStdin
https://github.com/xtermjs/xterm.js/blob/master/src/browser/CoreBrowserTerminal.ts
> ```typescript
> this._mouseService.bindMouse({
>     element: this.element!,
>     screenElement: this.screenElement!,
>     document: this._document!,
>     handleTouchScroll: amount => this._viewport?.handleTouchScroll(amount)
> }, disposable => this._register(disposable), () => this.focus());
> ```
> ```typescript
> public focus(): void {
>   if (this.textarea) {
>     this.textarea.focus({ preventScroll: true });
>   }
> }
> ```

https://github.com/xtermjs/xterm.js/blob/master/src/common/services/CoreService.ts
> ```typescript
> public triggerDataEvent(data: string, wasUserInput: boolean = false): void {
>   // Prevents all events to pty process if stdin is disabled
>   if (this._optionsService.rawOptions.disableStdin) {
>     return;
>   }
>   ...
> }
> ```

### S3 — Standard mousedown preventDefault mitigation for double-click side effects
https://bobbyhadz.com/blog/disable-text-selection-on-double-click-in-javascript-or-css
> "You can add a mousedown event listener to an element that checks if the user clicked more than once using event.detail > 1, and then prevent the default action (text selection) with event.preventDefault()."
