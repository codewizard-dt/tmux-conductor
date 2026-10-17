---
id: dispatch-clear-first-enter-race
title: "Why a project-scoped task dispatch doesn't submit (/clear + task text concatenated, unsent)"
updated: 2026-09-19
sources:
  - ../../raw/research/dispatch-clear-first-enter-race/index.md
confidence: extracted
tags: [dispatch, tmux, host-server, bug, reliability]
---

# Why a project-scoped task dispatch doesn't submit

The user reported a live incident: a queued command's text appeared typed into an agent's terminal but was never submitted, and (for a project-scoped task specifically) the `/clear` command and the task command ended up concatenated on one line, both sitting ready for Enter but never sent.

Investigation found two independent, compounding causes. **First**, `host-server/state.ts::sendTextToPane` — the sole function that types a dispatched task's command into a tmux pane — sends literal text then `Enter` via two synchronous `spawnSync` calls with **zero delay** between them, unlike `scripts/dispatch.sh`'s equivalent, which has an explicit `sleep 0.3` commented `# let the UI render before submitting`. **Second**, `index.ts::dispatchTaskToAgent`'s `opts.clearFirst` — set only when a popped task's `kind === 'project'` — chains *two* such sends back-to-back (`/clear`, then the real command) with no gap between them either, exactly reproducing the reported symptom for project-scoped tasks specifically (agent-scoped tasks never hit `clearFirst`, so they only risk the single-send version of the race).

`sendDirectInput` (the Direct Input `/keys` route) independently discovered and partially fixed this same class of race — but only for its multiline paste-buffer path (`await sleep(300)` gated on `multiline`); the single-line case, identical in shape to task dispatch, has no protection anywhere in the codebase.

Real `logs/dispatch.jsonl` records from this environment corroborate a **second**, already-tracked, compounding bug: the same agent received a second task dispatch while its own background sub-agents from the first `/tackle` dispatch were still actively running — this is **BUG-0001** (`in-progress`, tracked by `TASK-133`), whose file already documents that its sentinel-gate fix does not protect a background sub-agent that never calls `agent_needs_input`.

**Recommendation**: add a render-settle delay (300ms, matching this codebase's own `sendDirectInput` precedent) between the literal-text send and the `Enter` send in `sendTextToPane`, and verify the `clearFirst` chain gets the same protection between its two calls. File as a new bug — this is a distinct, independently-reproducible mechanism, separate from BUG-0001.

derived_from::[[dispatch-clear-first-enter-race raw report|../../../raw/research/dispatch-clear-first-enter-race/index.md]]
relates_to::[[tmux-send-keys-render-delay-race]]
relates_to::[[host-server]]
relates_to::[[idle-detection-vs-async-background-work]]
resolved_by::[[TASK-0185]]
