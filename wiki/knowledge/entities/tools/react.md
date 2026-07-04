---
id: react
title: React
aliases: [React, React Strict Mode]
updated: 2026-07-04
sources:
  - ../../../raw/research/application-latency-structure/index.md
tags: [tool, frontend]
---

# React

React powers the dashboard UI. The latency research specifically calls out React Strict Mode because development builds run extra effect setup/cleanup cycles. Components that own sockets, EventSource subscriptions, timers, terminal instances, or focus state must make those effects idempotent.

This is most relevant to relates_to::[[LogTail]], which owns xterm.js setup, focused WebSocket setup, SSE fallback subscription, and direct-input focus behavior.
