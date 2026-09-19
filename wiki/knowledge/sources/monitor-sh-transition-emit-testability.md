---
id: monitor-sh-transition-emit-testability
title: "Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic"
aliases: [monitor.sh transition testability]
source: ../../raw/research/monitor-sh-transition-emit-testability/index.md
researched: 2026-09-13
updated: 2026-09-18
tags: [monitor, bash, testing, observability, roadmap-019]
---

# Testing strategy for monitor.sh's emit_transition_jsonl / transition-diff logic

Source: [raw/research/monitor-sh-transition-emit-testability/index.md](../../raw/research/monitor-sh-transition-emit-testability/index.md)

**Status: resolved and shipped.** Scoped question raised while running `/uat-generate` on TASK-144 (which added `emit_transition_jsonl()` and per-agent transition-diff tracking to `scripts/monitor.sh`'s poll loop): how to write a repeatable unit test for this bash logic, given `monitor.sh` cannot be `source`d in isolation — it calls `load_agents`/`load_bg` (needs a live `CONDUCTOR_DB`) at top level and ends in an unconditional `while true` poll loop, and `conductor.conf`'s `LOG_DIR`/`STATE_DIR`/`POLL_INTERVAL` are hardcoded unconditional assignments that survive `source` regardless of pre-exported overrides.

## What was built

[`scripts/verify-transitions-jsonl-emit.sh`](../../../scripts/verify-transitions-jsonl-emit.sh) implements the recommended resolution: it extracts `emit_transition_jsonl`, `pane_tail_json`, and `emit_dispatch_jsonl` verbatim out of the live `scripts/monitor.sh` file (a quote-aware brace-depth scan, not a naive `}`-at-column-0 boundary, since `emit_transition_jsonl`'s body embeds a Python dict literal whose closing brace sits at column 0) into a throwaway harness with a stubbed `tmux`. It exercises:

- JSON shape of a normal transition (agent/from/to/reason/stateFileAgeS/paneTail/ts)
- null-handling for empty `from`, empty `to`, and empty `stateFileAgeS` fields
- write-failure resilience — a missing parent directory for `TRANSITION_LOG` never aborts the caller
- a regression guard that `emit_dispatch_jsonl` (dispatch.jsonl) stays untouched, with no `TRANSITION_LOG`/from-to-reason leakage
- the poll loop's `PREV_TRANSITION_STATE` diff-guard, grep-extracted from the live file and exercised in isolation against constructed unset/empty/value states

Verified live on 2026-09-18: `bash scripts/verify-transitions-jsonl-emit.sh` passes all 10 checks.

On the TS side, [`host-server/transitionsLog.test.ts`](../../../host-server/transitionsLog.test.ts) covers the equivalent `appendTransitionLog` logic in `host-server/index.ts` — using the same "assert against the raw source text" precedent as `sseRolePayloadParity.test.ts`/`rolePresets.test.ts`/`perfBudgets.test.ts` (index.ts can't be imported directly in a unit test since it has top-level side effects: opens the DB, registers Fastify plugins, starts listening). It checks the `appendTransitionLog` write shape, that it never throws, that `pollAndDiff` calls it right after the existing `status_transition` observability event without touching that event's original 4-field shape, and that the `reason`/`matchedPattern`/`tail15` side-channel never leaks into the public `Snapshot` shape serialized to SSE clients. Verified live on 2026-09-18: `node --test host-server/transitionsLog.test.ts` passes all 7 tests.

## Why neither existing precedent transferred directly (historical context)

The repo's two prior "test a live script" precedents (`scripts/verify-task-pop-soft-flip.sh`, `scripts/verify-teardown-window-mapping.sh`) both work by testing a side-effect-free library file or a *terminating* script with overridable paths — neither has monitor.sh's "infinite loop + hardcoded real paths" combination, so neither pattern transferred directly. This is why the resolution above extracts the argument-driven functions into a harness rather than (a) running the real script end-to-end against a live tmux session — which would need real `POLL_INTERVAL`-scale sleeps and writes into the real `./logs` tree — or (b) adding a `BASH_SOURCE`-guarded testability seam to `monitor.sh` itself, an out-of-scope production change for a UAT-generation pass.

relates_to::[[Observability for Agent Status Transitions]]
relates_to::[[detectAgentStatus Return-Site to DetectionReason Mapping]]
