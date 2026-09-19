---
topic: "accessing the tmux session remotely. I mean, hosting this UI somewhere, Creating a tunnel? not just local network, from external. major consideration: security"
slug: remote-tunnel-access
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Remote access to the tmux-conductor session and dashboard, from outside the local network

> **Recommendation in brief:** Don't build another hosted/relay backend — this project already tried that twice and reverted both times. Put a **WireGuard-based private mesh (Tailscale, or self-hosted WireGuard/Headscale)** in front of the *existing* `host-server`/dashboard and SSH, unchanged. That gets you access "from external" without ever exposing the loopback-only, unauthenticated `host-server` — including its raw, unauthenticated terminal WebSocket — to the public internet. Reach for **Cloudflare Tunnel + Cloudflare Access** only if you need to hand a browser URL to someone who won't install a VPN client; if you go that route, the identity check at the edge is mandatory, not optional, because the origin has no auth of its own.

## Research Questions

1. What is the current security posture of `host-server` and the dashboard (auth, network binding, what an attacker could do if reached)?
2. Has this project already attempted remote/hosted access, and why did that end the way it did?
3. What are the realistic options for reaching the tmux session and dashboard from outside the LAN, and how do they compare on security?
4. What does "remote access to the tmux session" mean concretely — terminal-level (SSH + `tmux attach`) vs. the browser dashboard — and does the answer differ between them?
5. Given the project's history (reverted OAuth relay, abandoned tunnel daemon, "local-only, single-user" refocus), what's the lowest-effort option that doesn't reopen either failure mode?

## Current State (Codebase)

- `host-server/index.ts` binds to `127.0.0.1` by default (`const host = process.env['HOST'] ?? '127.0.0.1'`, `host-server/index.ts:2580`) on port 8788 (env `BACKEND_PORT`/`PORT`). CORS origin defaults to `*` (`host-server/index.ts:50-55`) — permissive, but harmless as long as the port itself isn't reachable from anywhere but localhost. [S1]
- **There is no authentication anywhere in `host-server`** — no session, token, or API-key check on any route (confirmed by exhaustive `search_for_pattern` for `auth|Authorization|token|API_KEY` across `host-server/*.ts`, zero hits). This is a deliberate, documented design point, not an oversight: TASK-058's own audit note says *"the host-server is loopback no-auth, so the relay + better-auth session are the only trust boundary — every gap there is exploitable."* [S2]
- The dashboard's most sensitive surface is a **raw, unauthenticated WebSocket PTY stream**: `GET /agents/:id/terminal/ws` (`host-server/index.ts:1565`, `{ websocket: true }`) streams live terminal I/O for an agent pane, and `POST /agents/:agent/keys` sends literal keystrokes/text directly into that pane (per `CLAUDE.md`'s route table). Together these are equivalent to an unauthenticated web shell: anyone who can reach port 8788 can read and drive an interactive shell on the host. This is the single fact that should drive every decision below. [S1][S3]
- `CLAUDE.md` states the system is "fully local and single-user... no daemon, no Docker, no deployment, no auth" by design — the no-auth posture is a stated architectural constraint, not a gap waiting to be filed as a bug. [S3]

## Key Findings

### This project has already tried remote/hosted access twice, and reverted both times

- **ROADMAP-005** (June 2026) planned a self-hosted reverse-tunnel daemon (chisel or frp) to expose the status endpoint to a public static site. Zero code was written before it was superseded — the team judged that a separately-hosted tunnel server with SSH-key-level auth and no centralized identity was the wrong trust model. [S4]
- **ROADMAP-002** (June 2026) replaced that with a full hosted architecture: a DigitalOcean App Platform portal (`app/api`) running better-auth (email/password + Google OAuth), device pairing codes, and an **outbound WebSocket relay** so the host-server never had an inbound port. This got to 25/27 checklist items — including a real security-hardening pass (token hashing, rate limiting, 404-not-403 ownership checks, Origin checks, header safelists, body/connection caps — see TASK-058) — before being **fully reverted on 2026-06-22** (commit `ce53273`). Per the project owner, **the reason was severe performance issues**, not a security failure. `app/api/`, `daemon/`, and `deploy/` were deleted; the code survives only on git branch `archive/multi-user-relay`. [S5][S6]
- Following that, **ROADMAP-009 (mobile & remote access)** and the multi-user/cloud direction generally were marked `abandoned` by explicit project-owner decision: *"the multi-user/hosted/cloud direction is no longer on the roadmap — the project is refocusing on localhost-only single-user usage."* [S7]
- **Implication:** the two approaches this project already tried were (a) a bare tunnel with no centralized auth, rejected on security grounds before being built, and (b) a full custom auth+relay stack, built correctly (per its own security audit) but reverted on *performance* grounds. Any new recommendation should avoid rebuilding either — no bespoke relay/proxy layer, and no exposure without an identity check ahead of it.

### The three architecturally distinct options, and how they compare on security

| | **Private mesh VPN** (Tailscale, or self-hosted WireGuard/Headscale) | **Cloudflare Tunnel + Access** | **Public tunnel with app-level auth** (ngrok, or bare reverse SSH/chisel) |
|---|---|---|---|
| Exposure model | No public exposure at all; devices join a private overlay network over WireGuard, `host-server` stays bound to loopback/tailnet IP | Outbound-only connection from host to Cloudflare edge; **no listening port on the host** even though the app becomes reachable via a public hostname [S9] | Public URL created by an outbound connection to a third-party relay; without an app-level gate this is publicly reachable by URL |
| Who can reach the exposed endpoint | Only devices you explicitly authorize on the tailnet (ACL policy, deny-by-default) [S8] | Only identities that pass Cloudflare Access (SSO/email OTP) — **but this is a separate step people skip**, since the tunnel "already works" without it [S9] | Anyone with the URL, unless you bolt on Basic Auth/OAuth yourself (ngrok's paid tiers add this; free ngrok URLs are open by default) |
| Fits `host-server`'s no-auth-by-design posture | Yes — the trust boundary moves to network admission (tailnet membership), so `host-server` never needs to grow its own auth layer | No, not by itself — Access must terminate in front of the origin; skipping it re-exposes the unauthenticated terminal WebSocket to the public internet | No — same gap; the historical ttyd RCE (CVE-class: unauthenticated WebSocket → arbitrary shell command execution) is the concrete failure mode this maps to [S10] |
| Performance overhead vs. this project's prior relay | WireGuard is kernel-level (Linux) UDP, one hop, no request/response JSON re-framing — categorically lighter than the reverted app-level WS relay/mux, which added an HTTP↔WS reframing hop plus a Postgres-backed auth service | One extra network hop through Cloudflare's edge; no app-level re-framing of your protocol (raw WS/HTTP passthrough) | Comparable to Cloudflare Tunnel network-wise; ngrok free tier has per-session/bandwidth limits |
| Setup effort for this project | Minutes: install Tailscale on the host and on each device you use to connect; `tailscale serve` (tailnet-only) needs no further config; `tailscale funnel` if a specific route must be public | Moderate: create a tunnel, add a DNS route, create a Cloudflare Access application, configure an identity provider (Google/GitHub/email OTP) | Minutes for a raw tunnel, but then you must separately build or bolt on the auth gate — which is exactly the work this project already built and then discarded once |
| Ongoing maintenance | Low — no server to run yourself; Tailscale is a managed control plane, or self-host Headscale if you want zero third-party dependency | Low-moderate — Cloudflare account, DNS, Access policy to maintain | Low for ngrok (paid); non-trivial if self-hosting chisel/frp (this is what ROADMAP-005 already declined to build) |
| Best fit here | **Yes** — matches "single-user, no deployment, no auth" exactly; the identity boundary is *device enrollment*, which is a one-time action per device you own | Only if you need a shareable public URL for someone without a VPN client (e.g. showing the dashboard to a collaborator once) | Not recommended given the terminal-WS finding above, unless paired with real edge auth (in which case it's just a worse version of Cloudflare Tunnel + Access) |

### "Remote access to the tmux session" and "hosting the UI" are two different problems with one shared answer

- **Terminal-level access** (literally `tmux attach` from outside): this is just SSH. It requires no code changes to this project at all — SSH into the host, then `tmux attach -t conductor`. The only question is how SSH itself is reached from outside. Exposing port 22 directly to the internet is the classic target for credential-stuffing/brute-force bots; the standard mitigations are key-only auth, a non-default port, and fail2ban — but the cleaner fix used by the same VPN options above is to **never expose SSH publicly either**, and instead reach it only over the tailnet/mesh. **Tailscale SSH** specifically replaces key management with tailnet-ACL-gated, identity-authenticated SSH (deny-by-default, every session logged) [S8][S11].
- For flaky/roaming connections (phone, hotel wifi, mobile data), **mosh** (UDP-based, survives IP changes and packet loss, gives instant local echo) pairs well with tmux for session persistence — tmux holds the session state, mosh holds the pipe open across network changes [S12]. This is an orthogonal, additive choice, not a replacement for the access-control decision above; mosh does not do authentication, it still rides on an SSH handshake for the initial connection and requires a UDP port range to be reachable (which, again, is simplest to arrange over a private mesh rather than the open internet).
- **Dashboard access** is the harder problem because of the unauthenticated terminal WebSocket finding above — it needs the same "only reachable to authorized devices" property that SSH does, so the same mesh-VPN answer covers both with one piece of infrastructure instead of two.

## Constraints

- `host-server` has **zero built-in auth** and is not designed to grow one cheaply — the project's own prior attempt to put real auth in front of it required a whole second service (`app/api`, better-auth, Postgres) and was reverted for performance reasons. Any recommendation that requires modifying `host-server` itself to add session/token auth is repeating that already-abandoned path.
- The project's explicit current direction is **local-only, single-user** (ROADMAP-009 abandonment note). A recommendation that reintroduces multi-service, multi-user infrastructure (hosted portal, managed Postgres, OAuth) conflicts with that direction unless the user says otherwise.
- `CLAUDE.md`'s temp-file rule (`./tmp/` only) and "never touch `.env`" rule apply to any implementation work that follows from this research — e.g., a Tailscale auth key or Cloudflare tunnel token would go through `.env.example` + a note to the user, never written by Claude into a real `.env`.
- CORS is wide open (`origin: '*'`) today, which is fine only because the port is loopback-only; if `host-server` were ever bound to a non-loopback interface without a mesh/tunnel in front, this would need tightening too.

## Solution Comparison

See the table under **Key Findings** above — it already lays out approach, security fit, performance, effort, and maintenance side by side. Two more narrowly-scoped options for completeness:

| Criteria | Self-hosted WireGuard (no Tailscale account) | Bare reverse SSH tunnel to a VPS |
|---|---|---|
| Approach | Run your own WireGuard server (or Headscale as a self-hosted Tailscale control plane) | `ssh -R` from the host to a VPS you control, exposing the dashboard port through it |
| Pros | No third-party control plane; same WireGuard security properties as Tailscale | Simplest possible tooling (just OpenSSH), full control |
| Cons | You now operate the control-plane/coordination server yourself (key distribution, NAT traversal) — the exact operational burden Tailscale exists to remove | The VPS becomes a new public attack surface if the forwarded port isn't itself gated; no ACL/identity model beyond SSH keys — same class of problem ROADMAP-005 already declined |
| Complexity | Medium | Low to set up, but the security gate you'd need to add back is the same one already discarded in ROADMAP-002 |
| Codebase fit | Good — no `host-server` changes needed | Poor without added auth — recreates the exact "public tunnel with no identity boundary" this report advises against |

## Recommendation

**Recommended approach: Tailscale (managed) as the default; self-hosted Headscale/WireGuard as the no-third-party-dependency variant.**

Why: it is the only option that (1) requires **no code changes** to `host-server` or the dashboard, (2) doesn't reopen either of this project's two already-tried-and-abandoned paths (bare tunnel with no auth; full hosted relay+portal), and (3) matches the project's explicit "local-only, single-user" direction — the "user" in single-user just gets a private, authenticated network path to their own machine instead of a public one.

**Implementation outline:**
1. Install Tailscale on the host machine (`brew install tailscale` on macOS, or the official installer) and sign in with the account/identity provider you want to gate access with.
2. Install Tailscale on whatever device(s) you'll connect from (phone, laptop). No further `host-server` or dashboard config changes needed — it's still bound to loopback/tailnet-local by default; reach it at the host's tailnet IP (`100.x.y.z:4321`) or, cleaner, `tailscale serve` to publish the dashboard's port under a tailnet-only HTTPS hostname (`https://<host>.<tailnet>.ts.net`) without touching this app's code at all.
3. For terminal access, use `tailscale ssh` (or standard SSH bound to the tailnet interface) into the host, then `tmux attach -t <session>`. Add mosh only if you need to work over consistently bad/roaming connections — it stacks on top, not instead of, this.
4. Lock down the tailnet ACL policy to deny-by-default and explicitly allow only the devices/users that should reach this host (Tailscale's default posture already denies everything not explicitly permitted) [S8].
5. Leave `HOST=127.0.0.1` and `CORS_ORIGIN` as-is — don't rebind `host-server` to `0.0.0.0`; if you use `tailscale serve`, Tailscale handles the tailnet-only exposure without requiring the app to listen on a non-loopback interface.
6. If, later, you need to hand the dashboard URL to someone without a VPN client (e.g., a one-off demo), reach for **Cloudflare Tunnel + Cloudflare Access** instead of loosening the Tailscale ACL — but treat the Access identity check as mandatory setup, not optional, given the unauthenticated terminal WebSocket finding.

**Risks and mitigations:**
- *Risk:* someone sets up `tailscale funnel` (public internet) instead of `tailscale serve` (tailnet-only) by mistake, exposing the unauthenticated terminal WS publicly. *Mitigation:* explicitly avoid Funnel for this app; if the dashboard is ever meant to be public, that's the Cloudflare Tunnel + Access path instead, not Funnel.
- *Risk:* Tailscale account compromise (SSO account takeover) becomes a single point of failure for both dashboard and SSH access. *Mitigation:* enable MFA on the identity provider backing Tailscale; this is a much smaller trust surface than the previously-built OAuth+relay stack, and Tailscale itself never sees your traffic content (WireGuard is end-to-end between your devices).
- *Risk:* forgetting this decision six months from now and re-proposing the hosted-relay path a third time. *Mitigation:* this report cross-links ROADMAP-002/005/009 explicitly; `/wiki-ingest` this report so it lands in `wiki/knowledge/` where `/wiki-query` and future `/research` runs will surface it.

**Alternative if constraints change:** if the goal shifts from "I want to reach my own machine" to "multiple people need dashboard access," that's a real multi-user requirement again, and Cloudflare Access (with per-user identity, not a single shared secret) is the more natural fit than trying to make Tailscale's per-account model do multi-tenant auth — but that's a materially different requirement than what was asked here, and should go through `/req-create` rather than being folded into this answer.

## Next Steps

- No code changes are needed for the recommended path — this is an infrastructure/network decision, not an implementation task. If you want it tracked anyway: `/task-add Set up Tailscale (or tailnet-only tailscale serve) for remote dashboard + SSH access to the conductor host` would capture the install/ACL steps as a checklist.
- If you want the Cloudflare Tunnel + Access path evaluated concretely (DNS, Access policy, identity provider choice) before deciding, that's a good scope for a follow-up `/research` pass once you know whether "share with others" is actually a requirement.
- Recommend `/wiki-ingest raw/research/remote-tunnel-access/index.md` (see below) so this reasoning — especially the ROADMAP-002/005/009 history — is easy to find the next time remote access comes up.
