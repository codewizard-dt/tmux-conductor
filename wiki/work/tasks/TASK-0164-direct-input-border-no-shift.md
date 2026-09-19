---
id: TASK-0164
aliases: [TASK-0164]
title: "Make the Direct Input terminal border permanent (color-only state change, no layout shift)"
status: pending-uat
created: 2026-09-13
updated: 2026-09-13
depends_on: []
blocks: []
parallel_safe_with: [TASK-149, TASK-0163]
uat: "[[UAT-0164]]"
tags: [frontend, terminal, styling]
---

# TASK-0164 — Make the Direct Input terminal border permanent (color-only state change, no layout shift)

## Objective

`frontend/src/components/LogTail.tsx`'s Direct Input terminal wrapper div currently switches between a plain 1px `border` (idle state) and a 3px box-shadow `ring` (interacting/drag-over states), producing a small layout shift every time Direct Input is toggled on or off. Replace this with a single, always-present border whose width/rounding/overflow never change — only its color swaps between states (light gray when idle, the existing amber accent when interacting, the existing blue accent when drag-hovering a file).

## Approach

Target: `frontend/src/components/LogTail.tsx`, the wrapper `<div ref={captureRef} ...>` around line 669-681 (line numbers approximate, locate via Serena — this exact JSX block, not a duplicate elsewhere in the file):

```jsx
className={`relative border bg-[#0b0b0d] ${fillContainer ? 'flex flex-col flex-1 min-h-0 ' : ''}${dragOver
  ? 'overflow-hidden rounded-[10px] border-accent-blue outline-none ring-[3px] ring-accent-blue'
  : interacting
    ? 'overflow-hidden rounded-[10px] border-[#e0901a] outline-none ring-[3px] ring-[#e0901a]'
    : 'rounded-[10px] border-line outline-none'}${viewMode === 'history' ? ' hidden' : ''}`}
```

Replace with a structure where `overflow-hidden`, `rounded-[10px]`, `outline-none`, and the border width are identical (unconditional) across all three states, and only the border color class varies:

```jsx
className={`relative overflow-hidden rounded-[10px] border-2 outline-none bg-[#0b0b0d] ${fillContainer ? 'flex flex-col flex-1 min-h-0 ' : ''}${dragOver
  ? 'border-accent-blue'
  : interacting
    ? 'border-[#e0901a]'
    : 'border-line'}${viewMode === 'history' ? ' hidden' : ''}`}
```

(`border-2` is a starting point for "permanent, clearly visible" width — adjust to whatever renders cleanly; the requirement is that the exact same width/rounding/overflow classes apply in all three branches, only the color token differs. Do not reintroduce any `ring-*` utility or any class that is present in one branch but absent in another, since any such asymmetry is what causes the shift.)

`border-line` (idle/gray) and `border-[#e0901a]` (interacting/amber) are both already-established tokens used elsewhere in this same component (the amber matches the "Direct Input — keys go to…" banner and the toggle button's active state a few lines below); `border-accent-blue` already matches the existing drag-over treatment. No new colors need to be invented.

Also check the inner `xtermContainerRef` div a few lines below (~line 694-696), which has its own conditional `rounded-[10px]` toggle (`${interacting ? '' : 'rounded-[10px]'}`) — if this also contributes a visible shift (e.g. corner-radius mismatch against the now-permanent outer border), make it unconditional (`rounded-[10px]` always applied there too, matching the outer border's radius in every state) rather than leaving it conditional.

## Steps

### 1. Update the wrapper div's className <!-- agent: general-purpose -->

- [x] In `frontend/src/components/LogTail.tsx`, locate the `<div ref={captureRef} ...>` wrapper's `className` template literal (the block quoted in Approach above, currently using `border` + conditional `ring-[3px]`).
- [x] Replace it so `overflow-hidden`, `rounded-[10px]`, `outline-none`, and a single consistent border-width utility (e.g. `border-2`) are unconditional, and only the border color class (`border-line` / `border-[#e0901a]` / `border-accent-blue`) depends on `dragOver`/`interacting` state, per the Approach code block.
- [x] Check the inner `xtermContainerRef` div's className a few lines below for its own conditional `rounded-[10px]` toggle; if present, make it unconditional to match the now-always-rounded outer border, unless doing so visibly breaks the terminal content clipping (verify visually before deciding).

<!-- Updated: 2026-09-17 -->
<!-- Outer captureRef div (lines 704-716): overflow-hidden/rounded-[10px]/outline-none/border-2 now unconditional, only border color varies (border-accent-blue/border-[#e0901a]/border-line), no ring-* remains. Checked surrounding padding for 1px-border assumptions — none found, border-2 doesn't clash. Inner xtermContainerRef div (line 729-731) had its own `${interacting ? '' : 'rounded-[10px]'}` toggle — made unconditional too. Flagged judgment call: when interacting, an amber header sits above this div; rounding its top corners now may expose a small background sliver, but the outer/inner backgrounds are the same color (#0b0b0d) so it should be visually invisible — worth a quick look during UAT to confirm no seam. tsc --noEmit clean. -->

### 2. Visual verification <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Using Playwright, open a live agent's Direct Input terminal in the dashboard (http://localhost:4321, restart `make dev` first if the dev server isn't already running) and take a screenshot in the idle (not-interacting) state, then click to toggle Direct Input on and take another screenshot. Confirm via the screenshots (or by reading computed `getBoundingClientRect()` of the wrapper div before/after toggling) that its position/size does not change between the two states — only the border color changes.
- [DEFERRED-TO-UAT] Also verify the drag-over state still shows a distinct blue border by dragging a file over the terminal (or, if that's awkward to simulate, at minimum confirm the `dragOver` class branch still compiles/renders with `border-accent-blue` via a quick manual state check — do not skip verifying this branch entirely).
- [x] Run `cd frontend && npx tsc --noEmit` to confirm no type errors.

<!-- Updated: 2026-09-17 -->
<!-- Runtime/browser verification (Playwright screenshots, drag-over simulation) is out of tackle's static-gates-only scope; deferred to UAT (/uat-generate + /uat-walk) — this also specifically avoids driving Playwright against this environment's live conductor session per this session's established caution around real agent panes, though toggling Direct Input alone (no keystrokes sent) would be lower-risk than that concern; still deferred to a human for visual judgment given the flagged rounding-corner uncertainty from step 1. tsc --noEmit already confirmed clean in step 1's own dispatch, re-confirmed here. -->

### 3. Tests <!-- agent: general-purpose -->

- [x] Check `frontend/src/components/LogTail.test.tsx` for any existing test asserting on the wrapper div's className or border classes (search via Serena); update if one exists to match the new unconditional structure. If none exists, this step is a no-op — do not invent a new test purely for a className string unless the file already has a convention of doing so for this component.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean.

<!-- Updated: 2026-09-17 -->
<!-- Searched LogTail.test.tsx (search_for_pattern + get_symbols_overview) — no existing test asserts on the wrapper div's className/border/ring classes (only formatChunkTs, mapKey, and paste-event-handling test blocks exist). No-op per the step's own instruction. npm test: 155/155 pass, 9 files. npm run typecheck: clean. -->

## Notes

- Filed directly by user request (not part of `ROADMAP-0022`) — a cosmetic follow-up noticed while working on that roadmap's terminal modifier-key/clipboard fixes, but scoped independently since it's a pure styling change with no relation to key-mapping or clipboard logic.
- User's own words: "make the border permanent, and we will just change the color when direct input mode is turned on. If it's not on, it'll be like a light gray color. If it is on, it'll be the current color." — confirmed via `AskUserQuestion` that `border-line` (gray) / existing amber `#e0901a` (current "on" color) is the right color pairing, reusing tokens already in this file rather than inventing new ones.
- `parallel_safe_with: [TASK-149, TASK-0163]` — both already implemented and merged into `LogTail.tsx` before this task was filed; this task edits a disjoint JSX region (the wrapper div's className, not `mapKey()` or `handlePaste()`), so no risk of collision even if any of that other work were still in flight.
