---
id: node-js
title: Node.js
aliases: [Node, Node.js]
updated: 2026-07-04
sources:
  - ../../../raw/research/application-latency-structure/index.md
  - ../../../raw/research/application-latency-structure/index-2.md
tags: [tool, runtime, backend]
---

# Node.js

Node.js is the runtime for the host-server and Claude hook scripts. The latency research identifies Node event-loop blocking as a central risk because the host-server uses synchronous child-process calls for tmux operations.

The observability addendum recommends using Node `perf_hooks` to expose event-loop delay and event-loop utilization in `/api/perf/live-updates`, making terminal stalls measurable.

relates_to::[[Host Server]]
relates_to::[[Local Observability]]
