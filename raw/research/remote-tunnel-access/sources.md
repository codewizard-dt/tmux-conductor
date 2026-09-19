---
topic: "accessing the tmux session remotely. I mean, hosting this UI somewhere, Creating a tunnel? not just local network, from external. major consideration: security"
slug: remote-tunnel-access
researched: 2026-09-13
---

# Primary Sources — Remote access to the tmux-conductor session and dashboard

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts:50-55,2579-2580` | 2026-09-13 | `host` defaults to `127.0.0.1`; CORS origin defaults to `'*'` |
| S2 | codebase | `wiki/work/tasks/completed/TASK-058-security-hardening-logs-heartbeat.md:19` | 2026-09-13 | Explicit statement that `host-server` is "loopback no-auth" by design; relay/session was the only trust boundary in the (now-reverted) hosted architecture |
| S3 | codebase | `host-server/index.ts:1565`; `CLAUDE.md` route table | 2026-09-13 | `GET /agents/:id/terminal/ws` websocket route with no auth check found anywhere in `host-server/*.ts`; `CLAUDE.md`'s route table documents `POST /agents/:agent/keys` as direct keystroke injection; `CLAUDE.md` states the system is "fully local and single-user...no auth" by design |
| S4 | codebase | `wiki/work/roadmaps/archive/ROADMAP-005-ngrok-tunnel-daemon.md` | 2026-09-13 | Chisel/frp reverse-tunnel plan for public dashboard access; superseded before any code was written; explicitly rejected in favor of a design with centralized auth |
| S5 | codebase | `wiki/work/roadmaps/archive/ROADMAP-002-hosted-portal-oauth-relay-installer.md:16` | 2026-09-13 | Hosted portal + better-auth + outbound WSS relay reached 25/27 items then was fully reverted 2026-06-22 (commit `ce53273`) "because performance issues were too severe"; code survives on branch `archive/multi-user-relay` |
| S6 | codebase | `wiki/work/tasks/completed/TASK-058-security-hardening-logs-heartbeat.md:47-121` | 2026-09-13 | Detailed security-checklist audit (token hashing, rate limiting, ownership 404s, Origin checks, header safelists, body/connection caps) that was implemented for the relay before it was reverted — evidence the security work was done correctly and reverted for unrelated (performance) reasons |
| S7 | codebase | `wiki/log-2026_08_15_173301.md:559` | 2026-09-13 | Project-owner decision: "the multi-user/hosted/cloud direction is no longer on the roadmap — the project is refocusing on localhost-only single-user usage," abandoning ROADMAP-008/009/011/012 |
| S8 | web | https://tailscale.com/docs/features/access-control | 2026-09-13 | Tailscale ACL policy is deny-by-default; only devices/users explicitly permitted in the tailnet policy file can communicate |
| S9 | web | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/ ; https://medium.com/@paperkite_hq/cloudflare-tunnels-zero-trust-access-to-your-self-hosted-services-7ce3dc67a5a5 | 2026-09-13 | Cloudflare Tunnel is outbound-only (no listening port on origin); Access adds an identity-based login check at the edge and is a separate, commonly-skipped step from just standing up the tunnel |
| S10 | web | https://research.nccgroup.com/2017/09/08/technical-advisory-remote-shell-commands-execution-in-ttyd/ | 2026-09-13 | Historical concrete precedent: ttyd (web terminal over WebSocket) had a critical unauthenticated-RCE vulnerability in its WebSocket callback handling (versions ≤1.3.0) — the same class of risk as exposing `host-server`'s unauthenticated terminal WebSocket publicly |
| S11 | web | https://tailscale.com/blog/tailscale-ssh ; https://tailscale.com/docs/reference/ssh-over-tailscale | 2026-09-13 | Tailscale SSH authenticates via the identity provider and authorizes via tailnet ACLs instead of managed SSH keys; every session is logged; high-risk connections can require re-authentication |
| S12 | web | https://mosh.org/ ; https://hoop.dev/blog/mosh-and-tmux-uninterrupted-remote-terminal-sessions | 2026-09-13 | Mosh is a UDP-based SSH replacement that survives roaming/packet loss and gives instant local echo; commonly paired with tmux (mosh = connectivity/roaming, tmux = session persistence); requires UDP reachability and an initial SSH handshake, so it's additive to, not a replacement for, the access-control decision |

## Excerpts

### S5 — ROADMAP-002 (archived), reversion note
`wiki/work/roadmaps/archive/ROADMAP-002-hosted-portal-oauth-relay-installer.md`
> **ABANDONED (2026-07-06).** This roadmap reached 25/27 checked by 2026-06-14, but the entire implementation was reverted six days later in commit `ce53273` (2026-06-22, "Simplify to local-only architecture: remove daemon, app services, deployment configs; move frontend to root") — `app/api/`, `app/frontend/`, `daemon/`, and `deploy/` were all deleted and the frontend moved back to repo-root `frontend/`. Per the project owner: the hosted-portal/relay architecture was reverted because **performance issues were too severe**.

### S2 — TASK-058, trust-boundary framing
`wiki/work/tasks/completed/TASK-058-security-hardening-logs-heartbeat.md:19`
> This hardens the hosted relay trust boundary: the host-server is loopback no-auth, so the relay + better-auth session are the only trust boundary — every gap there is exploitable.

### S7 — wiki log, local-only refocus decision
`wiki/log-2026_08_15_173301.md:559`
> Per the project owner, the multi-user/hosted/cloud direction is no longer on the roadmap — the project is refocusing on localhost-only single-user usage. Flipped ROADMAP-008 (GitHub & CI integration), 009 (mobile & remote access), 011 (multi-user team accounts), and 012 (cloud session persistence) to `abandoned` with explanatory banners...

### S9 — Cloudflare Access as the commonly-skipped step
https://medium.com/@paperkite_hq/cloudflare-tunnels-zero-trust-access-to-your-self-hosted-services-7ce3dc67a5a5
> Cloudflare Access sits in front of your tunnel and forces authentication before any request reaches your origin, and this is the step people skip most often because the tunnel "already works" without it.

### S10 — ttyd unauthenticated RCE precedent
https://research.nccgroup.com/2017/09/08/technical-advisory-remote-shell-commands-execution-in-ttyd/
> ttyd is a cross-platform tool for sharing a terminal over the web... may allow remote attackers to execute shell commands on a victim's system, bypassing the authentication checks in place... within the callback_tty method (LWS_CALLBACK_RECEIVE handler).

### S8 — Tailscale ACL deny-by-default
https://tailscale.com/docs/features/access-control
> By default, all connections between devices in your Tailscale network (known as a tailnet) are denied unless explicitly permitted through your tailnet policy file.

### S12 — mosh + tmux division of labor
https://hoop.dev/blog/mosh-and-tmux-uninterrupted-remote-terminal-sessions
> Mosh handles connectivity — roaming, reconnection, latency. Tmux handles session persistence — windows, panes, detach/reattach.
