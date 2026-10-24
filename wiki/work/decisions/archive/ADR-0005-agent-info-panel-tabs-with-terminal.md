---
id: ADR-0005
aliases: [ADR-0005, DEC-0005]
title: "AgentDetailModal Agent-Info Panel: Tabs (Reversing ADR-0002#D1), Adding a Terminal Tab"
created: 2026-09-13
updated: 2026-09-13
tags: [frontend, ux, accessibility]
---

# ADR-0005: AgentDetailModal Agent-Info Panel: Tabs (Reversing ADR-0002#D1), Adding a Terminal Tab

> Single-decision group reopening `ROADMAP-021` Phase 4 item 1. `ADR-0002#D1` (2026-09-13, same day) resolved this question **no-go on tabs** based on a UX-fit/accessibility-cost analysis. The product owner (David Taylor) has since given an explicit, unambiguous direction reversing that call: tabs are wanted after all, with one additional tab — **Terminal** — not considered by `ADR-0002`'s analysis at all.

- **File created**: 2026-09-13
- **Last updated**: 2026-09-13
- **Tags (group)**: frontend, ux, accessibility

## Shared Context

This decision was made directly from explicit owner direction, not a fresh Socratic `/decision-create` session — the choice itself (tabs: yes) is not in question. What this record adds beyond a bare status flip is the one genuinely new architectural consequence the owner's phrasing introduces: **"Terminal becomes one of the tabs"** was confirmed explicitly (over the alternative of adding a Terminal tab as a secondary view while keeping today's always-visible live terminal untouched). That means `LogTail` — currently always-rendered, always-visible, the modal's primary interactive surface per `TASK-131`'s terminal-first redesign — moves from "always on screen" to "on screen only when the Terminal tab is selected." That is a bigger change than `ADR-0002` evaluated (which was scoped only to Skills/Diff/Usage/Checkpoints, never the terminal), so this decision documents that consequence explicitly rather than treating it as a footnote.

---

## D1. Consolidate Skills/Diff/Usage/Checkpoints/Terminal into one tabbed panel (reverses `ADR-0002#D1`)

- **Status**: accepted
- **Date**: 2026-09-13
- **Deciders**: David Taylor
- **Supersedes**: [[ADR-0002#D1]] (no-go on tabs, accepted 2026-09-13, same day)
- **Tags**: frontend, ux, accessibility

### Context (decision-specific)

`ADR-0002#D1`'s analysis (content shape, accessibility-implementation cost, no existing tab primitive, conditionally-absent panels) is not being disputed as *wrong* — it was a reasonable read of the tradeoffs at the time. The owner's later direction simply weighs the tradeoffs differently now that the actual shape of the ask is broader (5 tabs including the terminal, not 4 info-only panels) and the owner has stated a clear preference. Per this project's decisions lifecycle, an accepted decision is reversed by a new accepted decision that supersedes it, not by editing the old one in place — `ADR-0002#D1`'s file is left fully intact with only its `Status` field and a supersession note added.

### Decision Outcome

**Chosen option**: Build one hand-built WAI-ARIA tabbed panel (per `[[accessible-tabs-pattern]]` — `role="tablist"`/`role="tab"`/`role="tabpanel"`, roving-tabindex Left/Right/Home/End, `aria-selected`/`aria-controls`) with **five** tabs, in this order: **Terminal, Skills, Diff, Usage, Checkpoints**.

- **Terminal** hosts the existing `LogTail` component (`frontend/src/components/AgentList.tsx`, `uses::[[log-tail]]`) exactly as it renders today — Direct Input, Live/History toggle, `⌥F`/double-click fullscreen — but only when this tab is active. It is the **default-active tab on modal open**, preserving today's "terminal is what you see first" behavior for the common case.
- Skills/Diff/Usage/Checkpoints keep their existing conditional-absence behavior (`DiffPanel`/`UsageBreakdown` return `null`, `CheckpointList` only mounts for worktree agents) — a tab whose panel would be empty/absent is **not rendered in the tab strip at all**, not shown disabled. This preserves the one thing `ADR-0002#D1` flagged tabs handle worse than accordions (conditionally-absent content) by simply not building a tab for absent content, rather than inventing new empty-state UI.
- `ADR-0002#D1`'s per-panel-count-at-a-glance concern (accordions show every present panel's summary line simultaneously) is accepted as a real, known cost of this reversal — tabs necessarily hide that. No mitigation is prescribed here; if it proves painful in practice, that is exactly the kind of feedback that would motivate a future `ADR-0006`.

### Consequences

| Type | Consequence |
|------|-------------|
| ✅ Positive | Matches the owner's explicit, current preference; one consistent navigation model (tabs) instead of a five-way mix of "always visible" + "four independent accordions" |
| ⚠️ Negative | The live terminal (and Direct Input) is no longer always visible — a user on the Skills/Diff/Usage/Checkpoints tab cannot see the agent's live output without switching back to Terminal. This did not exist as a cost in `ADR-0002`'s scope (which never touched the terminal) and is the main net-new risk this decision accepts. |
| ⚠️ Negative | `TASK-131`'s "Direct Input default-on every mount" behavior and the notification/CTA `armInteract`/`interactSignal` auto-focus mechanism (`agent-detail-modal.md`) both assumed the terminal was always on screen; the implementing task must make opening the modal via a needs-attention/toast click also switch the active tab to Terminal, or Direct Input's auto-focus will fire on a hidden, inactive tab panel. |
| ⚠️ Negative | Real, ongoing hand-built ARIA-tablist accessibility surface (roving tabindex, arrow-key nav) that `ADR-0002#D1` weighed against and found not worth it for 4 info-only panels — accepted here as the cost of the owner's now-broader ask |
| 🔁 Follow-up | Implementation tracked as a new task under `ROADMAP-021` (see roadmap Phase 5); must preserve `LogTail`'s xterm-instance persistence (hidden via CSS class while its tab is inactive, never unmounted/recreated — same pattern already used for the Live/History toggle, `relates_to::[[log-tail]]`) so switching tabs never drops terminal output or an active Direct Input session |

### Links

- Related decisions: [[ADR-0002#D1]] (superseded by this decision)
- Supersedes: [[ADR-0002#D1]]
- Source: explicit owner direction (this session, 2026-09-13), building on `[[accessible-tabs-pattern]]` and `[[tabbed-agent-info-consolidation]]`
- Roadmap: `wiki/work/roadmaps/ROADMAP-021-agent-modal-simplification.md` (Phase 4 item 1, reopened; new Phase 5 tracks implementation)
- **Source task(s)**: [[TASK-157]] — implemented 2026-09-13 — decision fully implemented 2026-09-13
