---
id: TASK-087
title: "Vite dev proxy WebSocket support"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: [TASK-086, TASK-094]
parallel_safe_with: [TASK-084, TASK-085, TASK-089, TASK-091]
uat: "[[UAT-087]]"
tags: [frontend, vite, websocket, roadmap-015]
---

# TASK-087 — Vite dev proxy WebSocket support

## Objective

Ensure focused terminal WebSocket connections work reliably through the Vite dev server proxy.

## Approach

Replace any shorthand proxy configuration with an explicit proxy object that sets the backend target, enables WebSocket upgrade proxying, and keeps existing `/api/*` behavior intact.

## Steps

### 1. Inspect proxy config  <!-- agent: general-purpose --> <!-- Updated: 2026-07-04 00:00 -->

- [x] Read `frontend/vite.config.ts`.
- [x] Confirm how `PROXY_TARGET`, `VITE_API_URL`, and `/api/*` are currently handled.

### 2. Enable WebSocket proxying  <!-- agent: general-purpose --> <!-- Updated: 2026-07-04 00:00 -->

- [x] Configure the `/api` proxy with `ws: true`.
- [x] Preserve the current default target of `http://localhost:8788`.
- [x] Avoid changing production API URL behavior.

### 3. Verify  <!-- agent: general-purpose --> <!-- Updated: 2026-07-04 00:00 -->

- [x] Run the frontend typecheck/build gate used by this repo.
- [x] Add or update a static regression check if the repo has a performance or config test for Vite proxy behavior. No Vite proxy-specific static test exists; existing live-update check is EventSource-only.

## Acceptance Criteria

- [x] The Vite dev proxy explicitly enables WebSocket upgrades for `/api`.
- [x] Existing HTTP `/api/*` proxy behavior is unchanged.
- [x] Frontend verification passes.

## Dependencies

None.

### Roadmap

Implements ROADMAP-015 Phase 2, item "Fix Vite dev proxy WebSocket support" — `wiki/work/roadmaps/ROADMAP-015-latency-improvements.md`.
