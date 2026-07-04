---
id: fastify
title: Fastify
aliases: [Fastify]
updated: 2026-07-04
sources:
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
tags: [tool, backend, http]
---

# Fastify

Fastify is the host-server HTTP framework in tmux-conductor. The latency research highlights two Fastify-relevant points: the server currently disables Fastify logging, and the focused terminal WebSocket route is implemented through Fastify-compatible WebSocket support.

The observability addendum recommends env-gated Fastify/Pino structured request logs with request ids, response times, redaction, and disabled request logging for high-noise health/perf endpoints.

relates_to::[[Host Server]]
relates_to::[[Local Observability]]
