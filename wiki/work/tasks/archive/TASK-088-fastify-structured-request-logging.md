---
id: TASK-088
aliases: [TASK-088]
title: "enable env-gated Fastify structured request logging"
status: done
created: 2026-07-04
updated: 2026-07-04
depends_on: []
blocks: []
parallel_safe_with: [TASK-084, TASK-085, TASK-086, TASK-087, TASK-089, TASK-090, TASK-091, TASK-092, TASK-093]
uat: "[[UAT-088]]"
tags: [observability, logging, fastify, roadmap-016]
---

# TASK-088 — enable env-gated Fastify structured request logging

## Objective

Allow request-level Fastify logs during local debugging without making normal dev output noisy.

## Approach

Gate Fastify's logger behind `FASTIFY_STRUCTURED_LOGS=1` or `FASTIFY_REQUEST_LOGS=1`, with `FASTIFY_LOG_LEVEL` controlling the level.

## Steps

- [x] Update `host-server/index.ts` Fastify construction.
- [x] Document the env flags in `.env.example`.
- [x] Document usage in `wiki/knowledge/concepts/local-observability.md`.

## Acceptance Criteria

- [x] Request logging remains off by default.
- [x] Env flags are documented without storing secrets.

## Verification

- [x] `npm --prefix host-server run typecheck`
- [x] `npm --prefix host-server run lint`

### Roadmap

Implements ROADMAP-016 Phase 3 item "Enable env-gated Fastify structured request logging".
