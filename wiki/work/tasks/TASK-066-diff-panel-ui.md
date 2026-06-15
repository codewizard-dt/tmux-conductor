---
id: TASK-066
title: "Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)"
status: todo
created: 2026-06-14
updated: 2026-06-14
depends_on: [TASK-064, TASK-065]
blocks: []
parallel_safe_with: [TASK-062, TASK-063, TASK-067, TASK-068, TASK-069, TASK-070, TASK-071]
uat: ""
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

- [ ] Use `mcp__serena__get_symbols_overview` on `app/frontend/src/components/AgentDetailModal.tsx` (or the equivalent agent detail component) to understand the current layout.
- [ ] Confirm the API client function shape in `app/frontend/src/lib/api.ts`.

### 2. Add the API call  <!-- agent: general-purpose -->

- [ ] In `app/frontend/src/lib/api.ts`, add `fetchAgentDiff(agentId: string): Promise<{ diff: string | null, base: string | null }>`.

### 3. Build DiffPanel  <!-- agent: general-purpose -->

- [ ] Create `app/frontend/src/components/DiffPanel.tsx`.
- [ ] Fetch on mount; show a loading state while fetching.
- [ ] Split the diff string on newlines; for each line, pick a CSS class (`diff-add`, `diff-del`, `diff-hunk`, `diff-ctx`).
- [ ] Render in a `<pre>` with `overflow-y: auto; max-height: 400px`.
- [ ] Show "No changes yet" when the diff is an empty string; render nothing when `diff` is null.
- [ ] Add a "Refresh" button that re-fetches.

### 4. Wire into AgentDetailModal  <!-- agent: general-purpose -->

- [ ] In `AgentDetailModal.tsx`, add a "Changes" section below existing content, rendered only when `agent.branch` is non-null.
- [ ] Render `<DiffPanel agentId={agent.id} />` inside the section.

### 5. Typecheck + build  <!-- agent: general-purpose -->

- [ ] Run `npx tsc --noEmit` in `app/frontend/` — zero errors.
- [ ] Run `npm run build` in `app/frontend/` — clean build.

## Acceptance Criteria

- [ ] "Changes" section appears in the agent detail view only for agents with a non-null `branch`.
- [ ] Diff lines are colour-coded: `+` green, `-` red, `@@` muted, context lines neutral.
- [ ] Diff panel is scrollable and capped at a fixed max-height.
- [ ] "No changes yet" placeholder shown for an empty diff.
- [ ] "Refresh" button re-fetches the diff.
- [ ] `npx tsc --noEmit` and `npm run build` pass cleanly in `app/frontend/`.

## Dependencies

- **DEPENDS ON [TASK-064](TASK-064-diff-endpoint.md)** — `GET /api/agents/:agent/diff` must exist.
- **DEPENDS ON [TASK-065](TASK-065-base-branch-endpoint.md)** — base-branch detection must be wired so the diff is computed correctly.

### Roadmap

Implements ROADMAP-007 Phase 2, item "Render a unified diff panel in the AgentDetailModal (colour-coded additions/deletions)" — `wiki/work/roadmaps/ROADMAP-007-git-workflow.md`.
