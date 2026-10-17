---
id: local-server-cors-wildcard-exposure
title: Localhost Server with CORS `*` — Cross-Origin Reads from Any Open Web Page
aliases: [CORS wildcard exposure, localhost CORS star]
updated: 2026-09-20
sources:
  - ../../raw/research/project-file-tree/index.md
  - ../../raw/research/project-file-tree/sources.md
confidence: inferred
tags: [security, host-server, cors, file-tree]
---

# Localhost Server with CORS `*`

The host-server binds `127.0.0.1` by default (`HOST` env) but sets the CORS origin to `process.env.CORS_ORIGIN || '*'`. Binding to loopback keeps other machines out; it does **not** keep out web pages running in the user's own browser. With a wildcard origin, any page the user visits can issue cross-origin `GET`s to `localhost:8788` and read the responses.

**Why it matters for new endpoints.** `GET /browse` already exposes directory names this way, and a names-only file list (see `[[project-file-tree]]`) is a marginal increase. **Serving file contents would not be**: it would let any visited page read source code and any tracked secret. Before adding a content route: restrict `CORS_ORIGIN` to the dashboard origin(s), `realpath`-jail any client-supplied path to the agent's root (defeating symlink escapes), cap size, sniff binary, and deny-list `.env*`/key files even when tracked. No existing path-jail helper was found in `host-server` (absence-of-match evidence, not proven exhaustive).

This is the browser-origin threat, distinct from the network-admission model in `[[remote-access-security-model]]`, which assumes the port is reachable from other machines. Everything here is inference from reading the CORS setup, not a demonstrated exploit.

derived_from::[[project-file-tree]]
relates_to::[[remote-access-security-model]]
relates_to::[[Host Server]]
