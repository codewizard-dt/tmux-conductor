---
id: remote-tunnel-access
title: "Remote Access to the tmux-conductor Session and Dashboard"
aliases: [remote-tunnel-access, remote access research]
updated: 2026-09-13
sources:
  - ../../raw/research/remote-tunnel-access/index.md
  - ../../raw/research/remote-tunnel-access/sources.md
confidence: extracted
tags: [security, remote-access, networking, host-server]
---

# Remote Access to the tmux-conductor Session and Dashboard

Research answering "how do I reach the tmux session / dashboard from outside the local network, securely?" **`host-server` has no built-in authentication anywhere** — deliberately, per `CLAUDE.md`'s "fully local and single-user... no auth" design — and binds to `127.0.0.1` by default. Its most dangerous surface for remote exposure is a raw, unauthenticated `GET /agents/:id/terminal/ws` WebSocket PTY stream plus `POST /agents/:agent/keys`, which together are equivalent to an unauthenticated web shell if the port is ever reachable from outside localhost. The historical ttyd unauthenticated-RCE advisory (2017, WebSocket callback handler) is the concrete precedent for what goes wrong when a web terminal ships without an auth gate.

**This project already tried remote/hosted access twice and reverted both times.** `ROADMAP-005` (chisel/frp reverse-tunnel daemon) was superseded before any code was written, rejected for having no centralized identity boundary. `ROADMAP-002` then built a full hosted portal (DigitalOcean App Platform, better-auth, Postgres) with an outbound WebSocket relay so `host-server` never needed an inbound port — it reached 25/27 checklist items, including a real security-hardening audit (`TASK-058`: token hashing, rate limiting, 404-not-403 ownership, Origin checks, header safelists), before being **fully reverted on 2026-06-22 for severe performance issues**, not a security failure. The project owner then explicitly abandoned the whole multi-user/hosted/cloud direction (`ROADMAP-009` and others), refocusing on **local-only, single-user** usage.

Given that history, the recommendation is to avoid rebuilding either failure mode: no bare tunnel with no auth, and no bespoke relay/portal stack. Instead, put a **private mesh VPN (Tailscale, or self-hosted WireGuard/Headscale)** in front of the unmodified `host-server` and SSH — the trust boundary becomes device enrollment on the tailnet (deny-by-default ACLs) rather than anything `host-server` itself has to implement. `Cloudflare Tunnel + Cloudflare Access` is the fallback when a shareable public URL is needed without installing a VPN client, but the Access identity check is mandatory given the origin's total lack of auth — skipping it (a commonly-made mistake) republishes the unauthenticated terminal WebSocket to the whole internet. Terminal-level access (`tmux attach`) needs no code changes at all; it's just SSH, ideally reached the same way (Tailscale SSH) rather than exposed on the open internet, with `mosh` layered on top only for roaming/high-latency links.

**Decision**: [[DEC-0003-remote-access-and-trust-boundary|DEC-0003#D1: mechanism for reaching the conductor remotely]] and [[DEC-0003-remote-access-and-trust-boundary|DEC-0003#D2: where the trust boundary lives]] — both `proposed`, outcomes deliberately left open pending `/decision-finalize`.

uses::[[Fastify]]
relates_to::[[Remote Access Security Model]]
relates_to::[[Host Server]]
informs::[[DEC-0003-remote-access-and-trust-boundary]]
