---
title: Bugs Index
updated: 2026-06-11
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — `/power-mode`'s Task-tool sub-agent wait window gets misread as idle, dequeuing the next queued task early · in-progress · P1
- [BUG-0002 — Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt](0002-waiting-status-shows-no-tasks.md) — dashboard badge reads "NO TASKS" instead of "WAITING" while an agent is blocked on `/uat-walk`'s `Verdict? P/F/Fix/Skip` prompt · triaged · P2
- [BUG-0003 — CheckpointList relative timestamps always show 'just now' (ms/seconds unit mismatch)](0003-checkpoint-timestamp-always-just-now.md) — `formatRelativeTimestamp` multiplies an already-millisecond `ts` by 1000, so every checkpoint's relative age always collapses to "just now" · open · —
- [BUG-0004 — Diff panel reads the wrong directory for worktree-backed agents (uses workdir instead of worktreePath)](0004-diff-panel-wrong-directory-worktree-agents.md) — `GET /agents/:id/diff` diffs `entry.workdir` instead of `entry.worktreePath`, so a worktree agent's diff panel silently shows the wrong directory's changes · open · —
- [BUG-0005 — Usage badge squeezes the agent name to invisible width on real card layouts](0005-usage-badge-squeezes-out-agent-name.md) — the 4th non-shrinking Row-1 pill leaves the agent name at 2.4px width on real 3-column card layouts · open · —
- [BUG-0006 — Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race](0006-role-badge-never-renders-sse-omits-role.md) — `role` is present on `buildSnapshot()`/REST `/api/status` but omitted from both SSE `agent-update` payload builders, and a `hasReceivedSSEStateRef` guard discards the correct REST fetch once SSE wins the race · open · —
- [BUG-0007 — AgentDetailModal ignores dark mode (hardcoded bg-white on the outer container)](0007-agent-detail-modal-ignores-dark-mode.md) — `AgentList.tsx:686`'s plain `bg-white` utility class never picks up `.dark` overrides, dragging down every nested section (Details, Log, Skills, Diff, Usage, Checkpoints) · open · —
