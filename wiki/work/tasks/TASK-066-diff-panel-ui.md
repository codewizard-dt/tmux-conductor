---
id: TASK-066
aliases: [TASK-066]
title: "Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)"
status: pending-uat
created: 2026-06-14
updated: 2026-07-06
depends_on: [TASK-064, TASK-065]
blocks: []
parallel_safe_with: [TASK-062, TASK-063, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071]
uat: "[[UAT-066]]"
tags: [frontend, ui, git, diff, roadmap-007]
---

# TASK-066 — Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)

## Objective

Render a unified diff panel inside the `AgentDetailModal` (or the agent detail view) that fetches from `GET /api/agents/:agent/diff` and displays additions in green and deletions in red, in a monospace block. The panel is only shown when the agent has a branch (non-null).

## Approach

Add a `DiffPanel` component in `app/frontend/src/components/` that:
- Calls `GET /api/agents/:agent/diff` on mount (and on a manual "Refresh" button click).
- Parses the unified diff string line-by-line, colouring lines starting with `+` green, `-` red, `@@` blue/muted, and others neutral.
- Renders in a scrollable `<pre>` with a max-height so it doesn't push the modal out of view.
- Shows a "No changes" placeholder when `diff` is an empty string.
- Shows nothing (or is hidden) when `diff` is `null` (non-git agent).

Wire the component into `AgentDetailModal` under a collapsible "Changes" section, shown only when `agent.branch` is non-null.

Do NOT pull in a third-party diff library — plain string splitting is sufficient.

## Steps

### 1. Read the AgentDetailModal  <!-- agent: general-purpose -->

- [x] Use `mcp__serena__get_symbols_overview` on `app/frontend/src/components/AgentDetailModal.tsx` (or the equivalent agent detail component) to understand the current layout.
- [x] Confirm the API client function shape in `app/frontend/src/lib/api.ts`.

**Findings:** Real paths (differ from task text's `app/frontend/` prefix — actual root is `frontend/`): `AgentDetailModal` is a function defined inside `frontend/src/components/AgentList.tsx` (not a standalone file); API client is `frontend/src/lib/api.ts` (uses `apiFetch` wrapper + `API_BASE`, async/await, throws `Error(body.error ?? \`HTTP ${status}\`)` on non-ok). **Deviation:** `agent.branch` does not exist on the frontend `Agent`/`ApiAgent` types (that's TASK-062's job, `todo`, not a dependency of this task). `GET /agents/:id/diff` already returns `{ diff: null, base: null }` for non-git agents and `{ diff, base, truncated }` otherwise, so DiffPanel will gate its own visibility (and the wrapping "Changes" `<details>`) on the diff-fetch result being non-null rather than on a nonexistent `agent.branch` field — functionally equivalent given the actual dependency chain (TASK-064/065 only).
<!-- Updated: 2026-07-06 -->

### 2. Add the API call  <!-- agent: general-purpose -->

- [x] In `app/frontend/src/lib/api.ts`, add `fetchAgentDiff(agentId: string): Promise<{ diff: string | null, base: string | null }>`.

**Done:** added `export async function fetchAgentDiff(agentId: number): Promise<{ diff: string | null; base: string | null; truncated?: boolean }>` to `frontend/src/lib/api.ts` (inserted after `sendAgentKeys` via Serena `insert_after_symbol`; `agentId` typed `number` to match sibling agent-scoped functions, not `string` as in the task's original stub).
<!-- Updated: 2026-07-06 -->

### 3. Build DiffPanel  <!-- agent: general-purpose -->

- [x] Create `app/frontend/src/components/DiffPanel.tsx`.
- [x] Fetch on mount; show a loading state while fetching.
- [x] Split the diff string on newlines; for each line, pick a CSS class (`diff-add`, `diff-del`, `diff-hunk`, `diff-ctx`).
- [x] Render in a `<pre>` with `overflow-y: auto; max-height: 400px`.
- [x] Show "No changes yet" when the diff is an empty string; render nothing when `diff` is null.
- [x] Add a "Refresh" button that re-fetches.

**Done:** created `frontend/src/components/DiffPanel.tsx` (default export, matching `LogTail.tsx`/`AgentList.tsx` conventions). Uses Tailwind utility classes (`text-accent-green`/`text-accent-red`/`text-accent-blue`/`text-ink`) instead of named CSS classes (no CSS-module/plain-CSS convention in this codebase — Tailwind is the actual pattern; the task text's `diff-add`/`diff-del`/etc. class names were written against an assumed CSS convention that isn't what's actually used). Component owns its own visibility gating (returns `null` when `diff === null && base === null`, i.e. non-git agent) since `agent.branch` doesn't exist on the frontend type yet — see Step 1 deviation note.
<!-- Updated: 2026-07-06 -->

### 4. Wire into AgentDetailModal  <!-- agent: general-purpose -->

- [x] In `AgentDetailModal.tsx`, add a "Changes" section below existing content, rendered only when `agent.branch` is non-null.
- [x] Render `<DiffPanel agentId={agent.id} />` inside the section.

**Done:** wired into `frontend/src/components/AgentList.tsx`'s `AgentDetailModal` — added `import DiffPanel from './DiffPanel'` and `{!logExpanded && <DiffPanel agentId={agent.id} />}` right after the Skills `<details>` block, before `UsageBreakdown` (gated on `!logExpanded` to match the Skills/UsageBreakdown visibility convention, not on `agent.branch` — see Step 1 deviation).
<!-- Updated: 2026-07-06 -->

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [x] Run `npx tsc --noEmit` in `app/frontend/` — zero errors.
- [x] Run `npm run build` in `app/frontend/` — clean build.

**Done:** ran both in `frontend/` (actual path). `npx tsc --noEmit` exit 0, no errors. `npm run build` exit 0, 70 modules transformed; only a pre-existing informational Vite chunk-size warning (>500kB), not an error.
<!-- Updated: 2026-07-06 -->

## Acceptance Criteria

- [x] "Changes" section appears in the agent detail view only for agents with a non-null `branch`. — Implemented via the diff endpoint's own null-ness (`diff === null && base === null`) rather than a frontend `agent.branch` field, which doesn't exist yet (see Step 1 deviation note). Functionally equivalent for the dependency chain this task actually has (TASK-064/065).
- [x] Diff lines are colour-coded: `+` green, `-` red, `@@` muted, context lines neutral.
- [x] Diff panel is scrollable and capped at a fixed max-height.
- [x] "No changes yet" placeholder shown for an empty diff.
- [x] "Refresh" button re-fetches the diff.
- [x] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`. — passes in actual path `frontend/`.

## Dependencies

- **DEPENDS ON [TASK-064](TASK-064-diff-endpoint.md)** — `GET /api/agents/:agent/diff` must exist.
- **DEPENDS ON [TASK-065](TASK-065-base-branch-endpoint.md)** — base-branch detection must be wired so the diff is computed correctly.

### Roadmap

Implements ROADMAP-007 Phase 2, item "Render a unified diff panel in the AgentDetailModal (colour-coded additions/deletions)" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
