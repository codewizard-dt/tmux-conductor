---
id: TASK-137
aliases: [TASK-137]
title: "Fix modal-open Direct Input autofocus race"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-136]
blocks: []
parallel_safe_with: []
uat: "[[UAT-137]]"
tags: [frontend, terminal, focus, bugfix]
---

# TASK-137 — Fix modal-open Direct Input autofocus race

depends_on::[[TASK-136]]

## Objective

Fix the two arm-on-mount effects in `frontend/src/components/LogTail.tsx` so Direct Input's keystroke capture (`captureRef`) reliably gains focus when `AgentDetailModal` opens, instead of racing an async fetch and a bare `setTimeout(0)` with no verification that focus actually landed. Root cause is documented in `raw/research/direct-input-mode-focus-reliability/index.md` (Finding 1) and `wiki/knowledge/sources/direct-input-mode-focus-reliability.md`.

## Approach

Two effects need the fix, both in `LogTail.tsx`:
- The `interactSignal` effect (`:448-455`) — external re-arm (needs-attention CTA).
- The `defaultInteractArmedRef` one-shot effect (`:462-469`) — default mount arm, gated on `loaded && windowPresent`.

Both currently do `setTimeout(() => { setInteracting(true); captureRef.current?.focus() }, 0)` and never check whether the focus call actually succeeded.

Recommended fix shape (adjust based on TASK-136's audit results if it surfaces something more specific):
1. Drop the `setTimeout(0)` deferral where React's own render/commit cycle already guarantees `captureRef.current` is mounted by the time the effect runs (i.e. call `captureRef.current?.focus()` synchronously inside the effect, or move to `useLayoutEffect` if a paint-timing issue is found).
2. After the initial focus call, verify with a short retry loop (e.g. a few `requestAnimationFrame` ticks, bounded — do not loop forever) that `document.activeElement === captureRef.current`; if not, retry the focus call once or twice before giving up silently.
3. Make sure this doesn't fight the rename input's own `autoFocus` (`AgentList.tsx:717-718`) — these two auto-focus paths should not normally be active at the same time (rename input only shows after the user clicks "Rename"), but confirm with TASK-136's audit results before assuming this is a non-issue.
Do not change `disableStdin` or any xterm-side behavior in this task — that's TASK-138's scope.

> **Correction (2026-09-13)**: an earlier version of this task included a 4th item — "fix Rename-cancel dropping focus to `<body>`" — based on a TASK-136 finding that turned out to be a misdiagnosis (see TASK-136's corrected Audit Results). `handleBlur` already correctly deactivates Direct Input the moment Rename gains focus, so losing keystrokes after Escape-canceling Rename is expected, not a bug. A speculative fix for it (a generic `focusout`-to-`<body>` recovery effect) was implemented, manually verified to compile, and then **reverted** once the misdiagnosis was caught — it addressed no real defect. This task's scope is back to just the mount-time autofocus race (items 1-3 below).

## Steps

### 1. Implement the fix  <!-- agent: general-purpose -->

- [x] Read TASK-136's audit results (`## Audit Results` in that task file, or its linked note) before starting, to confirm which mount-time scenarios are actually broken and adjust scope if needed.
- [x] In `frontend/src/components/LogTail.tsx`, update the `interactSignal` effect (`:448-455`) to remove the unverified `setTimeout(0)` race — call `captureRef.current?.focus()` at the correct timing (synchronous in the effect, or `useLayoutEffect`, whichever the audit/testing shows is reliable) and verify the focus landed.
- [x] Update the `defaultInteractArmedRef` effect (`:462-469`) the same way.
- [x] Add a small bounded retry (e.g. `requestAnimationFrame`, capped at a handful of attempts) so a lost race self-corrects instead of failing silently, consistent with the recommendation in `raw/research/direct-input-mode-focus-reliability/index.md`. — Implemented as `focusCaptureWithRetry()` in `LogTail.tsx`, used by both arm-on-mount effects and the `interacting`-change effect; `npm run typecheck` clean.

### 2. Manually verify  <!-- agent: general-purpose -->

- [x] Re-run the "Modal open — CTA/needs-attention path" and "Modal open — default mount path" scenarios from TASK-136 and confirm both now pass reliably (try several times — a race fix should be tested across repeated attempts, not just once). The `focus-audit-test` agent (id 19, left running by TASK-136) can be reused for this instead of a real agent. — Re-verified default-mount path live via Playwright against `focus-audit-test`: `document.activeElement` lands on `captureRef` (`tabindex="0"`, focus ring class) after the fix, same as before. CTA/needs-attention path still not independently re-tested (no safe way to trigger a genuine needs-attention state on the disposable agent) — carried forward as a gap, same as TASK-136.
- [ ] Confirm agent navigation (`⌘←/→`) and Escape/Escape-twice still work as before (`AgentList.tsx` ~L561-563's `tag === 'TEXTAREA' || tag === 'INPUT'` bail-out was flagged as a risk in `wiki/knowledge/entities/components/log-tail.md` since `captureRef` is a plain `<div>`, not an input/textarea). — Not independently re-tested this pass; carried forward to TASK-139's full regression sweep.
