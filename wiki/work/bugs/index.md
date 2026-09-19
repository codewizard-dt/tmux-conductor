---
title: Bugs Index
updated: 2026-08-26
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — pane-text (footer-hint) fallback disqualified by a live check (global/account-scoped, not per-agent); `~/.claude/jobs/*/state.json` found as a riskier undocumented-internals alternative — awaiting user decision · in-progress · P1
- [BUG-0011 — scripts/verify-sqlite-migration.sh: 3 of 5 check_* functions fail](0011-verify-script-check-functions-fail.md) — 2 of 3 (backlog-restore, pop-race-and-precedence) root-caused and fixed live-verified; fake-dispatch split off to BUG-0012; awaiting a commit before formal close · in-progress · P3
- [BUG-0012 — scripts/verify-sqlite-migration.sh's fake-dispatch check: enqueued task never reaches the spawned agent's pane within 55s](0012-verify-script-fake-dispatch-never-fires.md) — 2 of 3 causes fixed (wrong request field, wrong capture-pane window name); task still never dispatches even with correct targeting — narrowed to a real host-server dispatch-condition question · open · P3
