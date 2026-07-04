---
id: application-latency-structure
title: Application Latency Structure
aliases: [Application Latency Structure Research]
updated: 2026-07-04
sources:
  - ../../raw/research/application-latency-structure/index.md
tags: [performance, latency, terminal, websocket, sse]
---

# Application Latency Structure

This source assesses tmux-conductor's whole application structure from a latency perspective. Its central claim is that **the main latency risk is synchronous tmux work sharing the host-server event loop with HTTP, SSE, and WebSocket handling**. The dashboard has improved since earlier performance work: it now has shared EventSource plumbing, live-update metrics, xterm.js rendering, and a focused terminal WebSocket. But the focused terminal path can still do duplicate work because focused WebSocket output and focused SSE output may both capture the same pane.

The recommended transport split is clear: keep SSE for one-way dashboard state, and make WebSocket the exclusive focused terminal input/output path when connected. The source also recommends coalescing focused WebSocket snapshots, adding explicit Vite WebSocket proxy support, turning hot tmux operations async or serializing them through a worker, and making live-update intervals/capture depths runtime-configurable.

The source also links UI instability to React effect lifecycles and focus ownership. `LogTail` owns xterm setup, focus registration, WebSocket setup, SSE fallback, and direct-input focus behavior; under React Strict Mode those effects must be idempotent. It also recommends simplifying agent-state determination into one backend-owned status contract with reason, age, and evidence fields.

relates_to::[[Dashboard Live-Update Performance Budgets]]
relates_to::[[Dashboard Performance Benchmarking]]
relates_to::[[Focused Terminal Transport]]
relates_to::[[Agent State Determination]]
relates_to::[[LogTail]]
