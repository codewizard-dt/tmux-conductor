---
id: remote-access-security-model
title: "Remote Access Security Model: Network Admission, Not Application Auth"
aliases: [remote access security model, tunnel vs vpn security]
updated: 2026-09-20
sources:
  - ../../raw/research/project-file-tree/index.md
  - ../../raw/research/remote-tunnel-access/index.md
  - ../../raw/research/remote-tunnel-access/sources.md
confidence: inferred
tags: [security, remote-access, networking, architecture]
---

# Remote Access Security Model: Network Admission, Not Application Auth

For a local-first, single-user application whose backend has no built-in authentication (`host-server` — see [[Host Server]]), there are exactly two structurally different ways to make it safely reachable from outside the LAN, and they trade off very differently:

1. **Push the trust boundary into the application** — add sessions/tokens/OAuth to the backend itself, then it's safe to expose an inbound port or run behind a public tunnel. This is what `ROADMAP-002`'s hosted portal + better-auth + WebSocket relay did, correctly (its `TASK-058` security audit verified token hashing, rate limiting, ownership checks, header safelists, Origin checks) — but it required standing up a second service, a managed Postgres database, and an app-level relay/mux, and was reverted after reaching 25/27 checklist items because of severe performance overhead, unrelated to security.
2. **Push the trust boundary into the network** — never let the unauthenticated backend become reachable from anything except devices you've already vetted. A private mesh VPN (Tailscale, or self-hosted WireGuard/Headscale) does this: ACLs are deny-by-default, so only enrolled devices/identities can even open a connection, and the backend needs zero code changes. `ROADMAP-005`'s bare chisel/frp tunnel plan was rejected specifically because it lacked this admission control — a tunnel alone is just a wormhole to whatever's on the other end, and a wormhole plus a fully unauthenticated web terminal (see [[remote-tunnel-access]] on `/agents/:id/terminal/ws`) is functionally an open RCE endpoint, the same class of bug that hit `ttyd` in 2017.

Option 2 is the better fit whenever "single-user, no deployment, no auth" is a standing constraint (as it currently is for this project — see `ROADMAP-009`'s abandonment note under [[Host Server]]/`wiki/log.md`): it reuses a managed or self-hosted control plane instead of building one, and it covers *both* dashboard access and SSH/`tmux attach` with one piece of infrastructure. Cloudflare Tunnel + Cloudflare Access is a hybrid worth naming separately: the tunnel gives outbound-only connectivity (no listening port), but it does **not** supply option 2's admission control by itself — Access has to be configured as a genuinely separate, easy-to-forget step, because "the tunnel already works" without it. Reach for it only when a shareable public URL (not a VPN-gated one) is an actual requirement, and treat the Access step as non-optional given the origin has no auth of its own.

**When option 1 becomes necessary again:** if the requirement shifts from "I want to reach my own machine" to genuine multi-user access (several distinct people, not just several of your own devices), a mesh VPN's per-account model stops being a natural fit and some form of per-user identity in front of the app (Cloudflare Access with real per-user policy, or rebuilding the auth layer) becomes the right tool again — that's a different requirement and should go through its own decision process rather than defaulting back into a full relay rebuild.

**Adjacent, distinct threat (2026-09-20):** all of the above is about *network* reachability. Even with the port bound to loopback and no remote access at all, a wildcard CORS origin lets any web page in the user's own browser read the host-server's responses — see [[local-server-cors-wildcard-exposure]]. A mesh VPN does not address it; restricting `CORS_ORIGIN` does.

**Decision**: [[ADR-0003-remote-access-and-trust-boundary|ADR-0003#D2: where the trust boundary lives]] records this choice formally — `proposed`, outcome left open pending `/decision-finalize`.

relates_to::[[remote-tunnel-access]]
relates_to::[[Host Server]]
informs::[[ADR-0003-remote-access-and-trust-boundary]]
