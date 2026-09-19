---
topic: "Toast-like messages for agent status changes in the tmux-conductor dashboard; clicking a toast switches the dashboard to that agent"
slug: agent-status-notifications
researched: 2026-09-13
sources: [./sources-2.md]
---

# Research: Toast Messages for Agent Status Changes (update)

> Builds on [index.md](index.md) (researched 2026-08-15), which already covered this exact mechanism in depth for a narrower trigger set (`awaiting`/`empty` only) and a "focus terminal for input" click action. All of that report's codebase findings (SSE transition-tracking in `AgentList.tsx`, no existing toast component, the `expandedAgent`/`armInteract` click-to-open mechanism, the recommendation to hand-roll rather than adopt a library) still hold verbatim and are not re-derived here — nothing has been implemented since (no `NotificationStack`/toast component exists in `AgentList.tsx` today, confirmed by search). This update covers what's new in this invocation's phrasing: (1) a broader/unspecified trigger scope ("agent status changes" generally, not just waiting/no-tasks), (2) a plain "switch to that agent" click action (ambiguous versus the prior report's "focus for input" assumption), (3) fresh 2026 toast-library data, and (4) accessibility guidance the prior report didn't address.

## Research Questions
- Does anything from the prior research need revising given a month has passed? (No — confirmed unimplemented, findings still accurate.)
- Is the trigger scope in this request ("agent status changes") the same as the prior report's `awaiting`/`empty` pair, or broader?
- What does "switch to that agent" mean precisely, versus the prior report's "open modal + focus terminal for input"?
- Does 2026 toast-library data (Sonner vs. react-hot-toast vs. react-toastify) change the prior "build bespoke" recommendation?
- What accessibility requirements (ARIA live regions, focus handling, dismiss timing) apply to a clickable, non-timed status toast, since the prior report didn't cover this?

## Current State (Codebase) — delta only

- No implementation exists yet: `search_for_pattern` for `NotificationStack|notification` across `frontend/src/components/AgentList.tsx` and `Toast`/`Notification` files returns nothing new since the prior report [S1].
- Two scope-relevant details not previously cited:
  - Tailwind already ships enter/exit-suitable keyframes usable for a toast without new CSS: `popIn` (scale+fade, 0.22s), `riseIn` (translateY+fade, 0.5s), `fadeIn` (0.35s) in `frontend/tailwind.config.js` [S2] — `AgentItem` cards already use `animate-popIn` for their own mount-in, so a toast reusing the same easing/duration would look native to the app rather than importing a different motion language.
  - The full `AgentDisplayStatus` union is `AgentRunState | 'empty' | 'idle-waiting'` where `AgentRunState = 'busy' | 'idle' | 'awaiting' | 'stalled' | 'starting' | 'no-window' | 'exited' | 'error' | 'unknown'` [S3] — i.e. 10 possible display statuses exist today, of which the prior report's recommendation only notifies on 2 (`awaiting`, `empty`). If "agent status changes" in this request means *any* transition (not just those two), the existing `prevStatusRef`/`STATUS_CONFIG` diffing machinery already generalizes to all 10 with no new derivation work — the open question is purely product scope (which transitions warrant a toast), not a technical gap.

## Key Findings (new this round)

- **Toast-library landscape has shifted since the prior report's S11** (which only cited react-toastify): Sonner is now the clear 2026 community default — 47.2M weekly downloads vs. react-hot-toast's 4.8M, smallest gzip bundle (9.1 KB), TypeScript-first, adopted as shadcn/ui's official toast [S4]. This doesn't change the prior recommendation's *conclusion* (bespoke over library) because the reason was never "no good library exists" — it was that this feature isn't a timed, fire-and-forget toast; it's a persistent, click-or-status-exit-dismissed, per-agent-keyed banner, which is a different shape of problem than what any of these libraries (including Sonner) are designed for *(inference — no primary source contradicts the prior report's reasoning)*.
- **Deduplication**: the standard library pattern for "don't show the same toast twice" is a stable per-source `toastId` so a second call replaces/no-ops instead of stacking [S5]. This maps directly onto the prior report's `Map<agentId, {...}>`-keyed notification state (already effectively an id-based dedup key) — confirms the prior report's data structure choice needs no change, just explicit note that keying by `agent.id` *is* the toastId-equivalent dedup mechanism.
- **Accessibility — not covered in the 08-15 report**: a toast must have its live-region container present and empty in the initial markup, with the message text set *after* mount, or screen readers never observe the mutation (a fresh element carrying both the `aria-live` attribute and its text in one paint is not reliably announced) [S6]. `role="status"` + `aria-live="polite"` is the correct pairing for a non-urgent status change (vs. `role="alert"`/`assertive` for something demanding immediate attention) [S7]. A clickable toast must never auto-steal focus on appearance (WCAG 4.1.3: status messages must be announceable without receiving focus) [S6] — i.e. clicking is an opt-in action, not something the toast should force by grabbing keyboard focus when it appears.

## Constraints (additive)

- Any toast container needs one persistent, empty-on-mount `aria-live="polite"` region in the DOM (not one region-per-toast created fresh each time) for screen readers to reliably announce new toasts [S6].
- Whatever the click action does (open modal only, vs. open + arm Direct Input as the prior report assumed), it must not steal keyboard focus merely from the toast *appearing* — only from the user's click [S6].
- Scope decision needed before implementation: does "switch to that agent" mean the plain `onExpand(false)` path (same as clicking an `AgentItem` card) or the prior report's `armInteract: true` (open + focus terminal for input)? These are one line apart in the existing code (`setExpandedAgent({ id: agent.id, armInteract: false | true })`) but change the click's behavior meaningfully.

## Solution Comparison

Unchanged from the prior report — bespoke component vs. Sonner vs. react-hot-toast vs. react-toastify — except the "why not a library" reasoning now also covers Sonner explicitly (see Key Findings above); the conclusion (bespoke) is unchanged.

## Recommendation

Confirms and extends the prior report's recommendation — build a bespoke component inside/near `AgentList.tsx`, keyed by `agent.id`, reusing `prevStatusRef`-style transition tracking and the existing `setExpandedAgent(...)` call for the click action. Two additions to that plan:

1. Use the existing Tailwind `popIn`/`riseIn` keyframes for toast enter animation rather than authoring new CSS, to stay visually consistent with `AgentItem`'s own mount animation [S2].
2. Implement the live region correctly: one static, empty `<div role="status" aria-live="polite" aria-atomic="false">` rendered once at the top of the toast stack, with each toast's text appended into it (or use it as a visually-hidden announcer alongside the visible toast cards) — not a fresh `aria-live` element per toast [S6][S7]. Click handling must fire only on explicit user click, never automatically on toast appearance.

Risks and mitigations: unchanged from the prior report (stale-closure risk in the SSE handler, already-open-modal suppression question, grace-period tuning), plus the two open scope questions below.

Alternative if constraints change: unchanged — reconsider Sonner only if a future need for timed, fire-and-forget confirmations emerges elsewhere in the app.

## Next Steps

- Resolve two scope questions before `/task-add`, since they change the implementation, not just polish:
  1. Trigger set: only `awaiting`/`empty` (per the 08-15 report) or a broader/configurable set of transitions?
  2. Click action: plain "switch to that agent" (`armInteract: false`) or "switch to and focus for input" (`armInteract: true`, the 08-15 report's assumption)?
- Once resolved, `/task-add` can proceed directly from the 08-15 report's implementation outline (still valid), amended with this update's accessibility and animation notes.
