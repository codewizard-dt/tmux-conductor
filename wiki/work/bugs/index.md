---
title: Bugs Index
updated: 2026-06-11
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — `/power-mode`'s Task-tool sub-agent wait window gets misread as idle, dequeuing the next queued task early · in-progress · P1
- [BUG-0002 — Agent status badge shows 'no tasks' instead of 'waiting' while blocked on a UAT verdict prompt](0002-waiting-status-shows-no-tasks.md) — dashboard badge reads "NO TASKS" instead of "WAITING" while an agent is blocked on `/uat-walk`'s `Verdict? P/F/Fix/Skip` prompt · triaged · P2
