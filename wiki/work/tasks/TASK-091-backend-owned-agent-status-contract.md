---
id: TASK-091
title: "backend-owned agent status contract"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: [TASK-092]
parallel_safe_with: [TASK-084, TASK-085, TASK-087, TASK-089]
uat: "[[UAT-091]]"
tags: [host-server, frontend, state, roadmap-015]
---

# TASK-091 — backend-owned agent status contract

## Objective

Define a backend-owned agent status contract so the dashboard consumes explicit status fields instead of re-deriving lifecycle meaning.

## Approach

Document and type the status payload emitted by the host-server. The backend should own `status`, evidence, state age, window/pane liveness, and active task semantics. The frontend should render from that payload without duplicating backend classification rules.

## Steps

### 1. Inspect status production and consumption  <!-- agent: general-purpose -->

- [x] Inspect `host-server/state.ts` status detection outputs.
- [x] Inspect `host-server/index.ts` status snapshot shape.
- [x] Inspect frontend API types and components that render agent status badges, active task, waiting/stalled labels, or liveness.

### 2. Define contract  <!-- agent: general-purpose -->

- [x] Add or update TypeScript types for the backend status payload.
- [x] Document status values and evidence fields in the wiki or local docs.
- [x] Include status values for idle, busy, awaiting/waiting, stalled, no-window, and exited if currently supported.

### 3. Preserve backend semantics  <!-- agent: general-purpose -->

- [x] Ensure `getActiveTask` or equivalent backend output remains authoritative for busy/awaiting/stalled agents.
- [x] Avoid moving hook-state regex logic into the frontend.

## Acceptance Criteria

- [x] Backend status values and evidence fields are documented.
- [x] Backend/frontend TypeScript types express the contract.
- [x] No new frontend status inference is introduced.

## Dependencies

None.

### Roadmap

Implements ROADMAP-015 Phase 4, item "Define a backend-owned agent status contract" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
