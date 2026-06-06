# Roadmap 002: Ngrok-Like Tunnel Daemon for Live Status

> Expose the conductor's local agent-status endpoint over HTTPS via a self-hosted reverse tunnel so a DigitalOcean App Platform static site can display live agent state from any browser.

- **Status**: active
- **Created**: 2026-06-06
- **Last updated**: 2026-06-06
- **Owner**: David Taylor
- **Linked PRD**: —
- **Linked ADRs**: —
- **Tags**: infra, tunnel, dashboard

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
