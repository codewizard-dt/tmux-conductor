---
id: ROADMAP-012
title: Cloud session persistence — keep agents running when the local host goes offline
status: active
created: 2026-06-13
updated: 2026-06-13
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [cloud, persistence, resilience]
---

# Roadmap 012: Cloud session persistence — keep agents running when the local host goes offline

## Goal

Keep agents running and accessible even when the local host machine sleeps or loses connectivity, by optionally handing off agent sessions to a cloud-hosted runner with minimal user friction. Depends on ROADMAP-002 relay infrastructure for the portal-side routing layer.

## Phase 1: Design & Evaluation

- [ ] Evaluate cloud execution options: DigitalOcean Droplet, App Platform worker, Fly.io (compare cost, cold-start latency, tmux support)
- [ ] Design agent handoff protocol: local daemon detects impending offline state, signals portal, portal provisions cloud runner
- [ ] Define daemon heartbeat interval and offline threshold that triggers auto-migration
- [ ] Document security model: which credentials are replicated to the cloud runner and how they are isolated

## Phase 2: Implementation

- [ ] Implement cloud agent runner: Docker container with tmux and the conductor daemon, provisioned on-demand via provider API
- [ ] Add `POST /api/agents/:agent/migrate` to the daemon that hands off a running session to the cloud runner
- [ ] Update the portal relay to route requests to the cloud runner when the local daemon heartbeat goes stale
- [ ] Add a visual indicator on the agent card when a session is running in cloud mode vs local mode

## Notes
