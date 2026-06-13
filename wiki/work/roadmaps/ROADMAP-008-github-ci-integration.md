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

## Phase 1: PR Creation

- [ ] Store GitHub personal access token in the daemon credential store alongside the portal device token
- [ ] Add `POST /api/agents/:agent/pr` endpoint that shells out to `gh pr create` in the agent's workdir
- [ ] Add "Open PR" button to the diff review panel in `AgentDetailModal` (depends on ROADMAP-007 Phase 2)
- [ ] Surface the created PR URL in the dashboard and emit it as an SSE event

## Phase 2: CI Automation

- [ ] Add `POST /api/webhooks/github` endpoint that receives `check_run` and `check_suite` CI events
- [ ] Parse the failing branch from the CI payload and match it to the owning agent via the `agents` table
- [ ] Add `CI_FIX_PROMPT` config key to `conductor.conf` as the fix task template
- [ ] Auto-enqueue a fix task to the matched agent when CI fails using the `CI_FIX_PROMPT` template
- [ ] Emit a `ci-fix-dispatched` SSE event and surface a CI status badge on the agent card

## Notes
