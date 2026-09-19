---
id: TASK-152
aliases: [TASK-152]
title: "Merge AgentTypeBadge and RoleBadge into one combined header pill in AgentDetailModal"
status: done
created: 2026-09-13
updated: 2026-09-13
depends_on: [TASK-150]
blocks: []
parallel_safe_with: []
uat: "[[UAT-152]]"
tags: [frontend, ux]
---

# TASK-152 — Merge AgentTypeBadge and RoleBadge into one combined header pill in AgentDetailModal

depends_on::[[TASK-150]]

## Objective

`AgentDetailModal`'s header currently renders two separate identity pills back-to-back — `<AgentTypeBadge agent={agent} />` then `<RoleBadge role={agent.role} />` (`frontend/src/components/AgentList.tsx:694-695`) — each with its own background chip, dot, and title tooltip. Per ROADMAP-021 Phase 2 ("one collision-free badge set"), collapse these into a single combined pill in the modal header only, reducing header chip count and visual noise while keeping both pieces of identity information legible.

## Approach

Add a new `AgentIdentityBadge({ agent })` component in `frontend/src/components/AgentList.tsx`, placed near the existing `AgentTypeBadge`/`RoleBadge` definitions (~line 148-208):

- Reuses `inferAgentType(agent)` and `resolveRoleBadge(agent.role)` (both already exported/available in this file) to get the same two pieces of data the separate badges used.
- Renders **one** `<span>` pill: two small dots (type dot, then role dot — same literal hex dot colors the two source components already use, unchanged by this task) followed by `type · role` text (e.g. `claude · frontend`), joined with the same `·` separator already used elsewhere in the header (`AgentList.tsx` uses `·` between other header fragments — grep for the exact character to match existing spacing).
  - If `type` is null (no type inferred) and `role` also resolves to nothing, render nothing (mirror both source components' existing `if (...) return null` behavior).
  - If only one of the two resolves, render a single-dot pill with just that value (don't show a stray `·` with nothing after it).
- Background: use the **type's** token (`--color-badge-type-claude-bg`/`--color-badge-type-codex-bg` from TASK-150, falling back to existing inline values if type is unset) so the pill's base color still communicates "this is a Claude/Codex agent" at a glance; role is conveyed via its own dot color (from TASK-150's new `--role-badge-<role>-bg`/`-text` tokens — use the role's dot hex, not its full bg/text pair, to avoid a two-tone pill) plus the role name in the text.
- Title/tooltip: `Agent type: <type>, Role: <role>` (or just one half if only one resolves) — combine both source components' existing `title` strings.
- Keep `AgentTypeBadge` and `RoleBadge` themselves **unchanged** — `AgentItem` (`AgentList.tsx:953-954`, the grid card) is explicitly **out of scope** for this task and keeps using the two separate badges; only `AgentDetailModal`'s header changes.

## Steps

### 1. Add AgentIdentityBadge component <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.tsx`, add `function AgentIdentityBadge({ agent }: { agent: Agent })` near `AgentTypeBadge`/`RoleBadge` (landed at lines 214-243, re-located via Serena since original ~148-208 estimate had shifted), implementing the merge logic described in Approach: read `inferAgentType(agent)` and `resolveRoleBadge(agent.role)`, render one pill with two dots + `type · role` text, background from the type's token (`--color-badge-type-claude-bg` / `--color-badge-type-codex-bg`, per TASK-150), role dot from the role's dot hex (from `resolveRoleBadge`'s returned `dot`), combined `title`.
- [x] Handle the three degenerate cases explicitly: neither resolves → `return null`; only type resolves → single-dot pill with just the type; only role resolves → single-dot pill with just the role.

<!-- Updated: 2026-09-13 -->

### 2. Wire into AgentDetailModal header <!-- agent: general-purpose -->

- [x] In `AgentDetailModal`, replace the two lines `<AgentTypeBadge agent={agent} />` and `<RoleBadge role={agent.role} />` (re-located via Serena to line 789 after the badge addition shifted numbers) with a single `<AgentIdentityBadge agent={agent} />`.
- [x] Do **not** touch `AgentItem`'s own `<AgentTypeBadge agent={agent} />` / `<RoleBadge role={agent.role} />` pair (confirmed unchanged at lines 1027-1028) — the grid card keeps the two separate badges.

<!-- Updated: 2026-09-13 -->

### 3. Tests <!-- agent: general-purpose -->

- [x] In `frontend/src/components/AgentList.test.tsx`, add tests for `AgentIdentityBadge` (rendered via the full `AgentDetailModal` tree, since the component is module-private like `AgentTypeBadge`/`RoleBadge` — mirrors the file's existing pattern for testing dialog-only badges) covering: both type+role present renders combined text; only type present; only role present; neither present renders nothing. New `describe('AgentIdentityBadge (merged type + role pill, TASK-152 Step 3)')` block, 4 tests.
- [x] Run `npm test` and `npm run typecheck` in `frontend/` — clean (96/96 tests pass across 7 files, zero type errors).

<!-- Updated: 2026-09-13 -->

### 4. Verify <!-- agent: general-purpose -->

- [DEFERRED-TO-UAT] Via `/run` or `make dev`, open an agent's detail modal in both light and dark mode; confirm the header now shows one combined identity pill instead of two separate ones, with both type and role still legible, and the grid view (`AgentItem`) is visually unchanged (still two separate badges there). Runtime/visual verification belongs to the UAT phase per tackle's verification-scope rule; implementation-side static gates (typecheck, unit tests) already passed in Step 3.

<!-- Updated: 2026-09-13 -->

## Notes

- Depends on `TASK-150` because the combined pill's background/dot colors should come from TASK-150's new collision-free tokens (`--role-badge-<role>-*`, `--color-badge-type-codex-*`) rather than the pre-TASK-150 raw Tailwind classes / inline literals — implement TASK-150 first so this task references tokens that actually exist.
- Scoped to `AgentDetailModal`'s header only, per ROADMAP-021 Phase 2's goal — `AgentItem`'s grid-card badges are intentionally left as-is.
