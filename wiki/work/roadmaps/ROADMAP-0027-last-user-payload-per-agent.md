---
id: ROADMAP-0027
title: Show Each Agent's Last User-Written Payload (Persisted per Agent, Top Strip and Sidebar Card)
aliases: [ROADMAP-0027]
status: active
created: 2026-09-20
updated: 2026-09-20
owner: David Taylor
derived_from: [terminal-typed-command-persistence, last-user-message-capture, hook-authoritative-last-prompt, keystroke-stream-command-reconstruction]
linked_requirements: []
linked_decisions: []
tags: [agents, dashboard, hooks]
---

# Roadmap 0027: Show Each Agent's Last User-Written Payload (Persisted per Agent, Top Strip and Sidebar Card)

## Goal

Give every agent a retained "last message": the most recent user-written payload, whether typed into the Direct Input terminal, submitted through the Add Task box, or dispatched from the queue. When every box is checked, that payload is captured exactly from Claude Code's `UserPromptSubmit` hook, delivered to the dashboard over SSE, and stored per agent in `localStorage`. It replaces `activeTask` in the strip at the top of the agent detail pane and in every sidebar agent card (full width, truncated, full text on hover), and it survives a page reload.

## Phase 1: Verify & Decide

- [x] [[TASK-0219: Dump and record UserPromptSubmit payloads for typed, slash, multi-line, Up-recalled and dispatched prompts]]
- [x] [[TASK-0220: Decide the last-payload storage rules (ordering, length cap, multi-line display, secrets)]]

## Phase 2: Capture

- [ ] [[TASK-0221: Persist the submitted prompt as last_prompt in the hook sidecar merge, with a hook test]]
- [ ] [[TASK-0222: Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate]]
- [ ] [[TASK-0223: Record Add Task box submissions in the per-agent last-payload store at submit time]]

## Phase 3: Store & Display

- [ ] [[TASK-0224: Add a lib/lastPayload.ts per-agent localStorage store with tests]]
- [ ] [[TASK-0225: Mirror incoming lastPrompt SSE values into the per-agent store, newest timestamp wins]]
- [ ] [[TASK-0226: Replace activeTask with the last payload in the detail-pane strip]]
- [ ] [[TASK-0227: Replace activeTask with the last payload in the sidebar agent card (full width, truncated)]]
- [ ] [[TASK-0228: Clear an agent's stored last payload when the agent is deleted, and verify clones keep separate payloads]]

## Phase 4: Verify

- [ ] [[TASK-0229: Verify the last-payload round trip: hermetic hook and suite script, plus a human live recipe (install-hooks, restart, type, Enter, reload)]]
- [ ] [[TASK-0230: Run UAT for typed, Add Task and queue-dispatched last payloads plus the no-payload empty state]]

## Notes

- **Capture choice (confirmed 2026-09-20):** hook → SSE → localStorage. The hook value is exact (history recall, Tab, paste, multi-line, queue dispatch); localStorage is the per-agent store the browser mirrors it into. A keystroke-mirror fallback for hook-less agents (e.g. Aider) is **out of scope** here; without a hook those agents show no payload except Add Task submissions.
- **Inputs counted (confirmed):** Direct Input messages, Add Task box submissions and queue-dispatched commands. The hook cannot tell typed from dispatched, so "last message" may be a dispatched task; a `dispatch.jsonl` correlation to label the source is a possible follow-up, not a roadmap item.
- **Display (confirmed):** the payload replaces `activeTask` in both places, and "top of the page" means the existing strip in the agent detail pane (`AgentList.tsx` ~L1141); the sidebar card line is ~L1249. `activeTask` stays in the API and status contract; only its display use is replaced.
- **Slash commands are unverified:** whether `UserPromptSubmit` fires for a typed `/command` (a separate `UserPromptExpansion` event exists for them) is settled by the Phase 1 dump. If it does not fire, add a `UserPromptExpansion` registration to the same script rather than a new mechanism.
- **Sequencing:** `TASK-0200` (Add Task box moves into the terminal bar) and `TASK-0201` (collapsible sidebar rail) both edit `AgentList.tsx`, as do the two display items here. Sequence them, do not parallelize. The 48px rail from `TASK-0201` shows no text, so it needs no change.
- **Supersedes** the localStorage-first, keystroke-mirror plan in `raw/research/terminal-typed-command-persistence/index.md` for hook-capable agents.
- Research: `raw/research/last-user-message-capture/index.md` (builds on `raw/research/terminal-typed-command-persistence/index.md`).
