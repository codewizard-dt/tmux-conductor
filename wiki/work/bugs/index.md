---
title: Bugs Index
updated: 2026-08-26
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — `/power-mode`'s Task-tool sub-agent wait window gets misread as idle, dequeuing the next queued task early · in-progress · P1
- [BUG-0006 — Role badge never renders — SSE agent-update payloads omit role, and SSE always wins the initial-load race](0006-role-badge-never-renders-sse-omits-role.md) — fixed (`role` added to both SSE builders), left in-progress pending a regression test (needs an SSE-stream test, unlike BUG-0004/0010's plain-HTTP fix) · in-progress · —
