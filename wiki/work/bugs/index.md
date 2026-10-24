---
title: Bugs Index
updated: 2026-09-20
---

# Bugs — Active Items

Lists **only active** bugs (`open`, `triaged`, `in-progress`). When a bug leaves the active set (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`), delete its line here — the file itself never moves; status lives in its frontmatter. See the [lifecycle](lifecycle.md).

Entry format: `- [BUG-NNNN — Title](BUG-NNNN-slug.md) — one-line summary · status · P0–P3`

- [BUG-0001 — Main agent falsely marked idle while waiting on a background sub-agent (Task tool), causing premature task dequeue](0001-false-idle-during-subagent-wait.md) — fresh repro 2026-09-19; correlator found (transcript `continued-in` records link an agent's session to its spawned `~/.claude/jobs/*` background jobs); user approved polling `~/.claude/jobs/*/state.json` — filed as TASK-0184 · in-progress · P1
- [BUG-0011 — scripts/verify-sqlite-migration.sh: 3 of 5 check_* functions fail](0011-verify-script-check-functions-fail.md) — 2 of 3 (backlog-restore, pop-race-and-precedence) root-caused and fixed live-verified; fake-dispatch split off to BUG-0012; awaiting a commit before formal close · in-progress · P3
- [BUG-0012 — scripts/verify-sqlite-migration.sh's fake-dispatch check: enqueued task never reaches the spawned agent's pane within 55s](0012-verify-script-fake-dispatch-never-fires.md) — 2 of 3 causes fixed (wrong request field, wrong capture-pane window name); task still never dispatches even with correct targeting — narrowed to a real host-server dispatch-condition question · triaged · P3
- [BUG-0013 — Agent shown as 'waiting for input' while still thinking (mismatched status transition)](0013-agent-marked-waiting-while-thinking.md) — dashboard badge intermittently flips to "waiting" mid-turn while the pane shows the agent still working; trigger not yet identified, root-caused 2026-09-20: monitor.sh writes `awaiting` without a BUSY_PATTERN guard and AWAITING_PATTERN's `?`/`>` alternatives match any of the last 8 lines (178/329 awaiting transitions had no dialog); false awaiting also blocks queue dispatch · in-progress · P0
- [BUG-0014 — Dashboard Interact terminal shows repeated blocks of agent output](0014-dashboard-terminal-repeated-output-blocks.md) — same agent output blocks repeat many times, interleaved with cut-off fragments, usually after leaving an agent and returning; trigger not pinned down · open · —
