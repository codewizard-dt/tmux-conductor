---
topic: "Toast-like messages for agent status changes in the tmux-conductor dashboard; clicking a toast switches the dashboard to that agent"
slug: agent-status-notifications
researched: 2026-09-13
---

# Primary Sources — Toast Messages for Agent Status Changes (update)

> Supplements [sources.md](sources.md) (S1-S11, 2026-08-15) — those citations still support this update's unchanged claims and are not repeated here. New source IDs below are numbered independently (S1-S7) and scoped to this file only.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `mcp__serena__search_for_pattern("NotificationStack\|notification")` against `frontend/src/components/AgentList.tsx` | 2026-09-13 | Zero matches — confirms no toast/notification component has been built since the 08-15 report |
| S2 | codebase | `frontend/tailwind.config.js` (keyframes/animation blocks, L51-72) | 2026-09-13 | `popIn`, `riseIn`, `fadeIn` keyframes already exist and are used elsewhere in the app (`AgentItem` uses `animate-popIn`) |
| S3 | codebase | `frontend/src/lib/api.ts` (`AgentRunState` L253-262, `AgentDisplayStatus` L264) | 2026-09-13 | Full 10-value status union, showing the prior report's 2-status trigger set is a scope choice, not a technical limit |
| S4 | web | https://www.pkgpulse.com/compare/sonner-vs-react-hot-toast | 2026-09-13 | "Sonner leads with 47.2M weekly downloads — roughly 9.7x more. React-hot-toast has 4.8M weekly downloads... Sonner has the smallest gzipped bundle at 9.1 KB" |
| S5 | web | https://fkhadra.github.io/react-toastify/prevent-duplicate/ | 2026-09-13 | "Providing a custom toast id is certainly the most straightforward way to prevent duplicate" — the standard per-source dedup key pattern |
| S6 | web | https://accessibility.build/guides/accessible-notifications | 2026-09-13 | "Put an empty live region into the initial HTML so it is present on page load, and then set or append text into it when an event happens... a toast must never steal focus" |
| S7 | web | https://frontendchecklist.io/rules/accessibility/accessible-notifications | 2026-09-13 | "Implement notifications with role='alert' or role='status', aria-live='polite' or 'assertive'" — confirms the status/polite pairing for non-urgent transitions |

## Excerpts

### S4 — pkgpulse.com, React-hot-toast vs Sonner comparison
> Sonner leads with 47.2M weekly downloads — roughly 9.7x more. React-hot-toast has 4.8M weekly downloads. Higher download counts generally indicate broader community adoption... Sonner has the smallest gzipped bundle at 9.1 KB.

### S6 — accessibility.build, Accessible Notifications & Toasts
> Put an empty live region into the initial HTML so it is present on page load, and then set or append text into it when an event happens. The container is what has to pre-exist; the message is the change the screen reader reacts to.

### S7 — frontendchecklist.io, Make notifications accessible
> Implement notifications with role='alert' or role='status', aria-live='polite' or 'assertive', and adequate display time.
