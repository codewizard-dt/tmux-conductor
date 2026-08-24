---
id: BUG-0006
aliases: [BUG-0006]
title: "Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race"
status: open
severity: high
priority: "—"
created: 2026-08-24
updated: 2026-08-24
reporter: David Taylor
assignee: "—"
tags: "—"
linked_task: "[[TASK-114]]"
---

# BUG-0006 — Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race

## Environment

- OS: macOS (Darwin 25.3.0)
- Browser: Chromium (Playwright)
- App: tmux-conductor dashboard
- Runtime: host-server (Fastify, SSE) + frontend (Vite dev server)
- Config: default `conductor.conf`, no overrides

## Steps to Reproduce

1. Create an agent with a non-generic `role` (e.g. `role: "security"`) via `POST /api/agents`.
2. Confirm `GET /api/status` correctly returns `"role":"security"` for that agent (it does).
3. Open the dashboard and observe the agent's card and its detail modal header.

## Expected Behavior

A colour-coded role badge (`RoleBadge`) renders on both the compact agent card and the detail modal header for any agent with a non-`generic` role, matching what `GET /api/status` reports.

## Actual Behavior

The role badge never appears anywhere on the live dashboard, on either the card or the modal, for any agent — even though the REST `GET /api/status` payload correctly carries the role. Confirmed via a full-page scan of every `span.rounded-pill` on the page: no role text, no role-specific colour classes, no `title="Role: ..."` anywhere.

Root cause (found via source read during live verification, not yet fixed): two compounding issues in `host-server/index.ts` and `frontend/src/components/AgentList.tsx`.

1. **SSE payload omits `role`.** The internal `buildSnapshot()` object (`host-server/index.ts` ~line 2305) correctly includes `role`, and it's correctly served by the REST `GET /api/status` route. But both SSE `agent-update` payload builders — the initial-connect resend (~lines 2168-2184) and the periodic diff-tick broadcast (~lines 2398-2422) — omit the `role` field entirely when constructing the per-agent SSE wire shape.
2. **SSE always wins the initial-load race.** `AgentList.tsx` (~lines 1300-1332) has a `hasReceivedSSEStateRef` guard that discards the initial `/api/status` GET fetch's result entirely once any SSE `agent-update` event arrives first. Because the SSE connect-resend is a synchronous send of already-cached server state, it essentially always wins the race against the `/status` GET's live per-agent `capture-pane` calls. The dashboard's live state therefore ends up built purely from the role-less SSE payload, permanently — the REST fetch's correct `role` value is fetched, then thrown away.

Since every other live-updating agent field presumably goes through the same SSE path, this pattern (missing field on SSE payload + SSE always winning the race) is worth checking for other silently-dropped fields beyond just `role`.

Found during live Playwright-driven verification of UAT-114 (role badge UI) on 2026-08-24.

## Reproducibility

- **Frequency**: always
- **First seen**: 2026-08-24
- **Last seen**: 2026-08-24

## Root Cause Analysis

> _(filled at `/bug-close`)_

## Resolution

> _(filled at `/bug-close`)_

## Related

> [[BUG-0003]], [[BUG-0004]], [[BUG-0005]] — found by the same UAT verification pass on adjacent UI, unrelated code paths
