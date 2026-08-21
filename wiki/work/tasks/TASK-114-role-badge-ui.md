---
id: TASK-114
aliases: [TASK-114]
title: "Role badge — colour-coded role badge on the agent card in the dashboard"
status: pending-uat
created: 2026-08-15
updated: 2026-08-15
depends_on: [TASK-111]
blocks: []
parallel_safe_with: [TASK-113, TASK-115]
uat: "[[UAT-114]]"
tags: [frontend, ui, roles, roadmap-010]
---

# TASK-114 — Role badge — colour-coded role badge on the agent card in the dashboard

depends_on::[[TASK-111]]

## Objective

Render a small colour-coded pill showing an agent's role (`frontend`, `backend`, `qa`, `devops`, `security`, `architect`) on both the compact agent card (`AgentItem`) and the detail modal header (`AgentDetailModal`), following the exact visual/structural convention already established by `StatusBadge`/`AgentTypeBadge`/`ProjectBadge` in the same file. `generic` (the default role) renders no badge at all — matching how `AgentTypeBadge` returns `null` for an unrecognized type and `branch` only renders when non-null — so agents nobody has explicitly assigned a specialty to don't get visual noise.

## Approach

`frontend/src/components/AgentList.tsx` already has three badge components with a consistent shape worth mirroring exactly (`StatusBadge` at line 118, `AgentTypeBadge` at line 146, `ProjectBadge` at line 172): a lookup table/function from value → `{ bg, color, dot? }`, rendered as `<span className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ background, color }}>`. `AgentTypeBadge` is the closest precedent for a small closed enum with a fixed palette per value (`claude` → violet, `codex` → teal); this task needs 7 colors, one per non-generic role, chosen to be visually distinct from each other AND from the existing `StatusBadge`/`AgentTypeBadge` palettes already on the same card (busy=blue, idle=green, empty/awaiting=amber, error/stalled=exited=red, claude=violet, codex=teal) so a role badge is never confusable with a status badge at a glance.

Depends on TASK-111 for the `role` field on the `Agent` interface (`AgentList.tsx`) and on the wire (`GET /api/status`'s `worktreePath`/`branch` are the closest precedent for "field TASK-111 adds and this task reads"). No dependency on TASK-112/113 — this task only ever reads `agent.role`, a string, and never touches CLAUDE.md/presets content.

## Steps

### 1. Confirm the dependency landed  <!-- agent: general-purpose -->

- [x] Confirmed live: `role?: string | null` is present on the `Agent` interface at `AgentList.tsx:34`. TASK-111 has landed.

### 2. Add the `RoleBadge` component  <!-- agent: general-purpose -->

- [x] **Design deviation resolving a real tension in the original spec** (flagged explicitly, not silent): the Approach text above modeled `ROLE_CONFIG` on `STATUS_CONFIG`/`AgentTypeBadge`'s inline-hex `style={{}}` idiom, but team-lead's tackle instructions separately required "use the existing centralized Tailwind tokens... rather than hardcoding hex values." Investigation found `tailwind.config.js`'s custom `accent` palette has only 6 entries, 5 already claimed by existing badges — no room for 6 fresh role hues without a config change. Resolved by mirroring `SkillBadge`'s existing precedent in this same file (built-in Tailwind palette utility classes, e.g. `bg-violet-100 text-violet-700`) for color, while keeping `StatusBadge`/`AgentTypeBadge`'s pill *shape* (`rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]`) for structure — satisfies both "match the existing idiom" and "use centralized tokens, not hardcoded hex." `ROLE_CONFIG` added (`AgentList.tsx` ~166-188): `frontend→pink`, `backend→orange`, `qa→cyan`, `devops→indigo`, `security→lime`, `architect→stone`, each `bg-{hue}-100 text-{hue}-700` (className) + a hex dot value (dot span still uses inline `style`, matching `StatusBadge`'s dot mechanism) — none colliding with `STATUS_CONFIG`/`AgentTypeBadge`/`SkillBadge`'s existing blue/green/amber/red/violet/teal.
- [x] `RoleBadge({ role })` added: returns `null` for `role == null`, `role === 'generic'`, or any unrecognized role string (defensive fallback, not just the two documented cases) — renders the pill with a leading dot + role name otherwise. `npx tsc --noEmit` shows one expected/transient `noUnusedLocals` error (`RoleBadge` not yet wired in) — will clear in Step 3.

### 3. Wire it into both card surfaces  <!-- agent: general-purpose -->

- [x] `<RoleBadge role={agent.role} />` inserted into `AgentItem`'s Row 1 (`AgentList.tsx:848`), immediately after `<AgentTypeBadge agent={agent} />`, before `<StatusBadge>`.
- [x] `<RoleBadge role={agent.role} />` inserted into `AgentDetailModal`'s header row (`AgentList.tsx:639`), immediately after `<AgentTypeBadge agent={agent} />`, before `<ContextMeter>` — same relative position as Row 1. `npx tsc --noEmit` and `npm run build` both clean in `frontend/` (prior transient `noUnusedLocals` error now resolved).

### 4. Typecheck  <!-- agent: general-purpose -->

- [x] `npx tsc --noEmit` in `frontend/` — zero errors.
- [x] `npm run build` in `frontend/` — clean build.
- [x] **Addition beyond this outline's literal scope, per team-lead's tackle instructions**: extracted the pure role-resolution logic into `export function resolveRoleBadge(role): { role, className, dot } | null` (guards `null`/`'generic'`/unrecognized-role in one place) and exported `ROLE_CONFIG` itself, so a future Node reference script can exercise this logic directly without a browser — mirroring the machine-verification technique used on sibling UAT-074/076/110. `RoleBadge` is now a thin JSX wrapper around `resolveRoleBadge`. Deliberate deviation from `STATUS_CONFIG`'s precedent (which is *not* exported, only its `getStatusColor` accessor is) — noted rather than silently matched, since the explicit ask here was enumerability of role keys, not consistency with `STATUS_CONFIG`.

## Acceptance Criteria

- [x] An agent with a non-`generic` role shows a colour-coded badge with that role's name on both the compact card and the detail modal header. (Implemented; visual confirmation is human-gated, see below.)
- [x] An agent with `role: 'generic'` or no `role` set shows no role badge — `resolveRoleBadge` returns `null` for both, plus any unrecognized role string.
- [x] Each of the 6 non-generic roles has a visually distinct color (pink/orange/cyan/indigo/lime/stone), none reused from `STATUS_CONFIG`/`AgentTypeBadge`/`SkillBadge`'s existing palette on the same card.
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/`.
- [ ] **Verification is human-gated**: this repo has no frontend test runner (confirmed during UAT-071's generation — no vitest/jest/tsx loader anywhere in `frontend/package.json` or the workspace root), so badge rendering/color/positioning can only be verified visually in a browser, not by an automated check. The UAT for this task should expect mostly `UAT-UI-*` human-walkthrough cases, with only the `agent.role` wire-shape (already covered by TASK-111's own acceptance criteria) and the typecheck/build gate machine-verifiable.

## Dependencies

- **DEPENDS ON [TASK-111](TASK-111-agent-role-column.md)** — needs `agent.role` on the frontend `Agent` type and the live `/api/status` payload.

### Roadmap

Implements ROADMAP-010 Phase 3, item 4 ("Show colour-coded role badge on agent card in the dashboard") — `wiki/work/roadmaps/ROADMAP-010-agent-observability-ux.md`.
