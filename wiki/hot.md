---
title: Hot Cache
updated: 2026-09-20
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-09-20_

## Key Recent Facts

- **New finding — `UserPromptSubmit` is NOT a human-only signal** (`raw/research/differentiate-actual-user-input/`, ingested). A finished background agent's `<task-notification>` block arrives at the hook as `prompt`, so `TASK-0221`'s `last_prompt` (implemented, `pending-uat`) has no filter and would store that XML as "the last message". `TASK-0219` never tested injected messages. Recommended: prefix guard in the hook now; server-side classifier using Claude's transcript `origin.kind === "human"` (join `prompt_id`↔`promptId`, **unverified**); conductor `dispatch.jsonl` correlation to label `dispatch`; store a `kind`; run an isolated spike first (also: peer messages, queued prompts, Up-recall, image paste). Measured on this session's transcript: typed = `human/typed`, slash = `human/null`, 48 peer messages = `null/null` (allow-list, don't deny-list).
- **`ROADMAP-0027` (last user payload per agent) is paused mid-run, 2/12 ticked** (`TASK-0219`, `TASK-0220` done). Implemented and `pending-uat` (UAT partly run, manual/live cases fail-closed, nothing force-closed): `0221` hook, `0222` server, `0223` Add Task capture, `0224` store, `0225` SSE mirror, `0226` strip, `0227` card, `0228` clear-on-delete. `0229` (round-trip script) and its UAT-gens were paused in flight; `0230` not started. Hook is inert until a human re-runs `install-hooks.sh` (installed copy is the old version) and restarts agents.
- **Audit findings (ROADMAP-0027):** agent **rename** renames the tmux window and `<win>.state` but not `<win>.meta.json`, and the running agent keeps its old `CONDUCTOR_AGENT_NAME` → `lastPrompt` goes missing until restart; SQLite id reuse confirmed (`agents.id INTEGER PRIMARY KEY`, no `AUTOINCREMENT`), so `TASK-0228`'s sweep is right; `~/.claude/settings.json` grew 1 byte at a spike agent's TUI launch (cause unknown, not touched); `hooks/on-stop-failure.js` writes `error`, CLAUDE.md says `idle`; the running host-server had not hot-reloaded `lastPrompt` at first but had by the `UAT-0222` rerun. A hermetic live round trip (isolated host-server + private tmux + Playwright) is feasible per `scripts/verify-bg-link-retired.sh`.
- **`BUG-0013` is the top priority (P0, in-progress), fix task `TASK-0231`:** `monitor.sh` writes `awaiting` without a `BUSY_PATTERN` guard, `state.ts` has no busy check on the state-file branch, and `AWAITING_PATTERN`'s `?`/`>` alternatives match any of the last 8 lines. Deploy needs a host-server restart and a `monitor` window restart.
- **`ROADMAP-0026`** (orchestrator role, 0/26): lifecycle + queue-only enqueue; DB is at schema v11, so its role-enum migration must claim the next free version. **`ROADMAP-0025`** (worktree on any agent) materialized as `TASK-0209`..`0218`.

## Recent Changes

- **Task added**: `TASK-0232` (todo) — preselect the active agent's project in the Add Agent modal (`lib/activeAgent.ts` store, `AddAgentForm` `defaultProjectId`); depends on `TASK-0173`/`0175`; touches `AgentList.tsx` minimally, so sequence it with the other `AgentList.tsx` work.
- **Created**: `wiki/knowledge/sources/differentiate-actual-user-input.md`; concept `user-input-provenance-classification.md`; `raw/research/differentiate-actual-user-input/`; earlier `TASK-0219`-`0230`, `ROADMAP-0027`, `UAT-0221`/`0222`/`0223`/`0224`/`0225`/`0226`.
- **Updated**: `hook-authoritative-last-prompt.md` and `last-user-message-capture.md` (contradiction callouts, `confidence: ambiguous`), `claude-code-hooks.md`, `wiki/index.md`, `wiki/log.md`.
- **Noted, not mine**: substantial unrelated uncommitted state from concurrent agents sharing this workdir (bg-restart/worktree edits in `AgentList.tsx` and `BackgroundProcessesTab.tsx`) — left untouched.

## Active Threads

- **Decide the plan change for ROADMAP-0027 before resuming agents:** file a follow-up for the hook prefix guard (same files as `TASK-0221`, add a case to `UAT-0221`/`0230` and to `TASK-0229`'s script), an isolated spike, the `promptOrigin.ts` classifier + `kind` on `lastPrompt` (snapshot and both SSE builders), and a frontend badge; `0225`-`0227` should then carry `kind`. Paused agents (`uatgen-0227`, `uatauto-0226`, `uatgen-0228`, `tackle-0229`) are idle awaiting the orchestrator.
- **Still to run:** `UAT-0222` manual cases, `UAT-0225` (fix stale INT-001/INT-002 wording: `TASK-0228` added `clearLastPayload`/`sweepOrphanedLastPayloads`), `UAT-0226`/`0227`/`0228` auto-runs, `TASK-0229`, `TASK-0230`. `TASK-0224`/`0223`/`0221` need human `/uat-walk` for their manual cases.
- **Next: `/tackle wiki/work/tasks/TASK-0231-fix-false-awaiting-busy-guard-and-pattern-tightening.md`** — edits `scripts/monitor.sh`, `host-server/state.ts`, `conductor.conf`; do not run it concurrently with anything touching those files (`TASK-133`).
- **Sequence all `AgentList.tsx` work, don't parallelize:** ROADMAP-0025, `TASK-0200`, `TASK-0201`, ROADMAP-0026's role badge, ROADMAP-0027's remaining display work.
- **`BUG-0001`** in-progress P1; **`BUG-0011`** fix verified, needs a human commit then `/bug-close`; **`BUG-0012`** triaged P3. **`ROADMAP-0024`**: bg restart/liveness/cooldown tasks in flight. **`ROADMAP-0023`**: check for `pending-uat` stragglers.
- **`TASK-0166`**: blocked on human go-ahead for `scripts/backfill-agent-teams-flag.mjs`. **`DEC-0003#D1`/`#D2`**: accepted 2026-09-20 (Tailscale via `tailscale serve`; network admission only, no in-app auth) and archived; ROADMAP-0026 no longer has an outstanding decision.
