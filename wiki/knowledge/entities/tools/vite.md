---
id: vite
title: Vite
aliases: [Vite]
updated: 2026-07-04
sources:
  - ../../../raw/research/application-latency-structure/index.md
tags: [tool, frontend, dev-server]
---

# Vite

Vite runs the local dashboard dev server and proxies `/api` traffic to the host-server. The latency research found that the proxy still uses string shorthand while the focused terminal WebSocket resolves through `/api` when `API_BASE` is unset.

The recommended fix is to use an explicit object proxy with WebSocket support (`ws: true`) so focused terminal WebSocket connections are reliable through the Vite dev server.

relates_to::[[Focused Terminal Transport]]
