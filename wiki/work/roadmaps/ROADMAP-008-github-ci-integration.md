---
id: ROADMAP-008
title: GitHub & CI integration — PR creation and autonomous CI fix loop
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [github, ci, automation]
---

# Roadmap 008: GitHub & CI integration — PR creation and autonomous CI fix loop

## Goal

Let agents open PRs directly from the dashboard and automatically re-queue fix tasks when CI fails on an agent-owned branch, closing the edit → review → fix loop without leaving the conductor UI.

> **Architecture note (2026-06-13).** The conductor API is now `host-server/` (was `backend/`), native on the host at port **8788**, serving routes under the `/api` prefix. Because PR creation and CI-fix dispatch need host/tmux/workdir access and the SQLite `agents` table, **these endpoints belong on `host-server`, not `app/api`** (`app/api` is the public App-Platform-hosted auth/relay tier and has no host access). For the *hosted* (remote-browser) path, GitHub webhooks and the "Open PR" action reach `host-server` through the **relay** (ROADMAP-002 Phase 4); locally they hit `host-server :8788` directly. This roadmap is about CI for the **agents' own work branches** — distinct from the conductor repo's own `.github/workflows/ci.yml` (typecheck/lint).

## Phase 1: PR Creation

- [ ] Store the GitHub personal access token in the daemon credential store alongside the better-auth device token (see ROADMAP-002 Phase 3 pairing/credentials)
- [ ] Add `POST /api/agents/:agent/pr` endpoint **on host-server** that shells out to `gh pr create` in the agent's workdir
- [ ] Add "Open PR" button to the diff review panel in `AgentDetailModal` in `app/frontend` (depends on ROADMAP-007 Phase 2)
- [ ] Surface the created PR URL in the dashboard and emit it as an SSE event (host-server `/api/events`)

## Phase 2: CI Automation

- [ ] Add `POST /api/webhooks/github` endpoint that receives `check_run` and `check_suite` CI events — on host-server (reached via relay/`app/api` for the hosted path; direct for local)
- [ ] Parse the failing branch from the CI payload and match it to the owning agent via the SQLite `agents` table (host-server)
- [ ] Add `CI_FIX_PROMPT` config key to `conductor.conf` as the fix task template (host-server reads `conductor.conf`)
- [ ] Auto-enqueue a fix task to the matched agent when CI fails using the `CI_FIX_PROMPT` template
- [ ] Emit a `ci-fix-dispatched` SSE event and surface a CI status badge on the agent card

## Notes
