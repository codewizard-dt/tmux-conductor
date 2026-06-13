---
id: ROADMAP-005
title: Ngrok-Like Tunnel Daemon for Live Status
status: done
created: 2026-06-06
updated: 2026-06-12
owner: David Taylor
linked_requirements: []
linked_decisions: []
tags: [infra, tunnel, dashboard]
---

# Roadmap 005: Ngrok-Like Tunnel Daemon for Live Status

> Expose the conductor's local agent-status endpoint over HTTPS via a self-hosted reverse tunnel so a DigitalOcean App Platform static site can display live agent state from any browser.

## Superseded

This approach was abandoned in favour of the outbound WebSocket relay architecture in [ROADMAP-002](ROADMAP-002-hosted-portal-oauth-relay-installer.md). The relay design eliminates the need for a separately-hosted tunnel server and an inbound port on the user's machine — the local daemon opens an outbound WSS connection to the portal, and the portal muxes browser requests through it.

The chisel/frp research notes below remain useful background for understanding why the relay approach was chosen instead.

## Goal

A self-hosted reverse tunnel daemon (chisel or frp) runs on a public server; a client daemon on the conductor host keeps a persistent connection that forwards the conductor's local `/status` endpoint to a public HTTPS URL. The DigitalOcean App Platform static site is updated to poll that URL and render real-time per-agent status, with a graceful "conductor offline" fallback when the tunnel is down.

## Phase 1: Foundation

> Select and prove the tunnel tool before writing any daemon code.

- [ ] Evaluate chisel vs frp for this HTTP/status use case and commit to one
- [ ] Provision public server (Droplet or DO App Platform service) to host the tunnel server
- [ ] Deploy tunnel server binary/container and verify it is reachable over HTTPS
- [ ] Smoke-test end-to-end tunnel connectivity (public URL → local port) before daemon work begins

## Phase 2: Daemon

> Implement and integrate the tunnel client as a managed process on the conductor host.

- [ ] Implement tunnel client daemon script on the conductor host
- [ ] Add auto-restart/watchdog so the daemon recovers from crashes without manual intervention
- [ ] Wire daemon into conductor lifecycle (start in `conductor.sh`, stop in `teardown.sh`)
- [ ] Document tunnel client configuration (server URL, local port, auth token) in `conductor.conf` or a dedicated config file

## Phase 3: Static Site Integration

> Wire the DO App Platform static site to consume the tunnel endpoint.

- [ ] Configure CORS on the tunnel server to allow the DO App Platform static site origin
- [ ] Update static site to fetch `/status` from the tunnel's public HTTPS URL
- [ ] Handle tunnel-down state gracefully in the static site UI (show "conductor offline")
- [ ] Document `TUNNEL_URL` env var in the static site deployment config

## Phase 4: Ops & Reliability

> Harden the tunnel for production use and update project documentation.

- [ ] Add a `/health` route to the tunnel server for uptime monitoring
- [ ] Update project docs (CLAUDE.md, root README, `scripts/README.md`) to cover tunnel daemon setup
- [ ] Smoke-test the full path from a static site (portfolio test route → live conductor status)

## Notes

Research (2026-06-06): chisel (Go, WebSocket-over-HTTP, single binary, SSH-secured) is the leading candidate — single binary, works through HTTPS proxies, DO App Platform supports WebSockets for externally-exposed services. frp is more feature-complete but heavier. rathole (Rust) is TCP/UDP only with no HTTP-layer features. bore is too minimal for this use case.

No items were executed before this roadmap was superseded by ROADMAP-002.

## Migration Note

Migrated 2026-06-12 from `.docs/roadmaps/002-ngrok-tunnel-daemon.md` (pre-wiki, was marked `active`). Marked `done` here because the direction was abandoned — items remain unchecked to accurately reflect zero work was done before supersession.
