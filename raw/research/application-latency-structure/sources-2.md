---
topic: "Observability addendum for application latency structure assessment"
slug: application-latency-structure
researched: 2026-07-04
---

# Primary Sources - Observability Addendum

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::liveUpdateMetrics`; `host-server/index.ts::/api/perf/live-updates` | 2026-07-04 | Current in-memory metrics surface tracks SSE connections, SSE broadcasts, timing summaries, capture timings, and tail request timings. |
| S2 | codebase | `scripts/test-host-performance.mjs` | 2026-07-04 | Current perf guard checks for metric/timing hook presence, not measured runtime latency. |
| S3 | codebase | `host-server/index.ts::Fastify({ logger: false })`; host-server `console.*` call sites | 2026-07-04 | Fastify logging is disabled and server logs are mostly unstructured console statements. |
| S4 | codebase | `scripts/monitor.sh::emit_dispatch_jsonl`; `scripts/README.md` | 2026-07-04 | Monitor logs dispatch records to JSONL with agent, command, state, detection, queue metadata, and pane tail. |
| S5 | codebase | `hooks/lib/write-state.js` | 2026-07-04 | Hooks write best-effort `hooks.jsonl` state transition records and sidecar metadata. |
| S6 | codebase | `scripts/conductor.sh`; `scripts/spawn.sh`; `host-server/index.ts::buildBgStatuses` | 2026-07-04 | Background process output is piped to log files and surfaced through dashboard status metadata. |
| S7 | context7 | `/nodejs/node` - "perf_hooks monitorEventLoopDelay performance.eventLoopUtilization API measure event loop latency" | 2026-07-04 | Node supports event-loop delay histograms and event-loop utilization metrics, including blocking `spawnSync` examples. |
| S8 | context7 | `/fastify/fastify` - "Fastify logging request id pino logger configuration disable request logging serializers" | 2026-07-04 | Fastify can emit structured request logs with request ids, status codes, response times, logger config, serializers, and conditional request logging. |

## Excerpts

### S7 - Node perf_hooks

https://github.com/nodejs/node/blob/main/doc/api/perf_hooks.md

> Use `monitorEventLoopDelay`

> event loop utilization

> blocking `spawnSync`

### S8 - Fastify Logging

https://github.com/fastify/fastify/blob/main/docs/Reference/Server.md

> disable request logging for specific URLs

https://github.com/fastify/fastify/blob/main/docs/Reference/TypeScript.md

> logger: { level: 'info'

https://github.com/fastify/fastify/blob/main/docs/Guides/Delay-Accepting-Requests.md

> "reqId"

> "responseTime"
