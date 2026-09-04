---
title: Bugs Index
updated: 2026-08-26
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — pane-text (footer-hint) fallback disqualified by a live check (global/account-scoped, not per-agent); `~/.claude/jobs/*/state.json` found as a riskier undocumented-internals alternative — awaiting user decision · in-progress · P1
