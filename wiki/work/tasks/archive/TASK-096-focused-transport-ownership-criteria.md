---
id: TASK-096
title: "focused transport ownership acceptance criteria"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: [TASK-097, TASK-099, TASK-104]
parallel_safe_with: [TASK-095, TASK-098, TASK-100, TASK-102]
uat: "[[UAT-096]]"
tags: [performance, terminal, websocket, roadmap-015]
---

# TASK-096 — focused transport ownership acceptance criteria

## Objective

Define the acceptance contract for focused terminal transport ownership so the dashboard has exactly one focused output owner at a time.

## Approach

Document a backend/frontend contract before implementation: WebSocket owns focused output and input when connected; SSE remains a fallback only when WebSocket is absent or failed; duplicate focused capture must be detectable by tests.

## Steps

### 1. Ground the contract  <!-- agent: general-purpose -->

- [x] Read `wiki/knowledge/concepts/focused-terminal-transport.md`.
- [x] Read `raw/research/application-latency-structure/index.md` sections about focused WebSocket exclusivity.
- [x] Inspect current focused WebSocket and SSE behavior in `host-server/index.ts` and `frontend/src/components/LogTail.tsx`.

<!-- Updated: 2026-07-04 05:53 -->

### 2. Write acceptance criteria  <!-- agent: general-purpose -->

- [x] Update or create a concise wiki concept note that states the focused ownership contract.
- [x] Define acceptable fallback behavior when the WebSocket cannot connect.
- [x] Define evidence required for completion: no concurrent focused SSE subscription while WebSocket is open, no duplicate focused capture loop per pane, and direct input uses WebSocket while connected.

<!-- Updated: 2026-07-04 05:53 -->

### 3. Link downstream tasks  <!-- agent: general-purpose -->

- [x] Update the relevant ROADMAP-015 task notes or task files if the contract changes implementation details. No ROADMAP-015 edit required; the contract is citeable from `wiki/knowledge/concepts/focused-terminal-transport.md`.
- [x] Record the acceptance criteria in `wiki/log.md`. Deferred to final summary per task-owner write scope; shared-doc update needed.

<!-- Updated: 2026-07-04 05:53 -->

## Acceptance Criteria

- [x] The focused transport ownership contract is documented in the wiki.
- [x] The contract names the exact backend/frontend behaviors that prove exclusivity.
- [x] Later ROADMAP-015 transport and regression tasks can cite the criteria.

## Dependencies

None.

### Roadmap

Implements ROADMAP-015 Phase 1, item "Define focused transport ownership acceptance criteria" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.

### Renumbering note

Originally filed as `TASK-085`. Renumbered to `TASK-096` on 2026-07-06 to resolve an ID collision with an unrelated ROADMAP-016 task that was independently assigned the same number the same day. See `wiki/log.md` for the full renumbering record.
