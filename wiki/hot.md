---
title: Hot Cache
updated: 2026-09-18
---

# Hot Cache

Always-read-first summary of what changed most recently in this wiki. Regenerated in full on every wiki write — never appended.

_Last updated: 2026-09-18_

## Key Recent Facts

- **`TASK-0168` created**: a `/wiki-query` on "agent status observability" found 3 wiki pages still describing ROADMAP-019's `logs/transitions.jsonl` work as an open question or in-progress, even though TASK-142/143/144/145 all shipped and archived. Task scopes a Phase 1 wiki correction (`monitor-sh-transition-emit-testability.md`, `transition-observability.md`, `agent-state-determination.md`) followed by a Phase 2 audit reusing existing tooling (`scripts/verify-transitions-jsonl-emit.sh`, `host-server/transitionsLog.test.ts`, `scripts/verify-collect-diagnostics-transitions-bundle.sh`, `scripts/verify-transitions-jsonl-docs.sh`) plus a live `DetectionReason`-mapping cross-check and a pane-text sensitivity spot-check. Real defects → `/bug-file`; clean result → no new file. No dependencies on other active tasks. Next step: `/tackle wiki/work/tasks/TASK-0168-audit-agent-status-observability.md`.
- **`ROADMAP-0023` materialized into `TASK-0169`..`TASK-0178`** (all `todo`, roadmap now has zero inline items): replace the Agents page's Kanban board with a project-grouped sidebar (0169-0171), move the agent detail view into the main content area (0172-0174, selection stays local `expandedAgent` state, no route), move Add Agent/Add Background Process triggers into `NavBar` (0175-0176, builds on TASK-151's modal), relocate `InactiveAgentsPanel` into the sidebar (0177-0178). Dependency chain: 0169 -> 0170 -> 0171; 0169 -> 0172; 0170+0172 -> 0173 -> 0174; 0175 -> 0176; 0170 -> 0177; 0173+0177 -> 0178. Nearly all edit `AgentList.tsx`/`AgentList.test.tsx`, and `AgentsPage.tsx` is touched by 0170/0173/0175/0176/0177 — orchestrator must serialize by file. Deliberate behavior change: TASK-0174 makes Shift+Cmd+Arrow cycle in sidebar visual order. TASK-0173 also re-bases `terminalSizeProbe.ts` from the overlay geometry to the pane geometry. Next step: `/roadmap-next wiki/work/roadmaps/ROADMAP-0023-agents-page-sidebar-layout.md`.
- **`BUG-0011`/`BUG-0012`/`TASK-0166`/`TASK-133` — unchanged**, all still waiting on human input (commit review, host-server investigation, backfill-script go-ahead, `BUG-0001` design decision).

## Recent Changes

- **Created**: `wiki/work/tasks/TASK-0169`..`TASK-0178` (ROADMAP-0023 tasks, slugs in `wiki/work/tasks/index.md`); `wiki/work/tasks/TASK-0168-audit-agent-status-observability.md`.
- **Updated**: `wiki/work/roadmaps/ROADMAP-0023-...` (all 10 inline items replaced with `[[TASK-NNNN: ...]]` links, no checkboxes flipped); `wiki/work/tasks/index.md` (10 new rows); `wiki/log.md` (10 task entries).
- **Updated**: `wiki/work/tasks/index.md` (added TASK-0168 row); `wiki/log.md` (task-creation entry) — the wiki-page corrections and audit itself are TASK-0168's own Phase 1/2 work, not yet performed.
- **Not touched this session, still accurate as of last check**: `wiki/work/roadmaps/ROADMAP-0023-...` and its supporting pages, `BUG-0011`/`BUG-0012`, `TASK-0166` (paused, needs human decision), `TASK-0164`/`UAT-0164`, `TASK-151`/`UAT-151`, `TASK-132`/`UAT-132`, `TASK-0167`/`UAT-0167`, `TASK-162`/`UAT-162`, `TASK-133` (skipped), `BUG-0001` (needs a user decision), `UAT-011` (genuinely untouched, deliberately not run), orchestrator/task-routing research pages, `DEC-0003#D1`/`#D2` (both `proposed`, deliberately left open).
- **Noted, not mine**: this repo's working tree has substantial unrelated uncommitted state from other concurrent agents sharing this live conductor session's workdir — left entirely untouched.

## Active Threads

- **`TASK-0168`**: `todo`, not started — Phase 1 (correct 3 stale wiki pages) must land before Phase 2 (run `scripts/verify-transitions-jsonl-emit.sh`, `host-server/transitionsLog.test.ts`, `scripts/verify-collect-diagnostics-transitions-bundle.sh`, `scripts/verify-transitions-jsonl-docs.sh`, a `DetectionReason` cross-check, and a pane-text spot-check).
- **`ROADMAP-0023`**: `active`, 0/10 items checked, all 10 linked to `TASK-0169`..`TASK-0178` (`todo`). Next step is `/roadmap-next` (Wave 1 candidates: 0169 and 0175, which share no files).
- **Wiki lint follow-ups** (all need a human decision, not another lint pass): update `tasks/lifecycle.md` to document `pending-uat`; decide whether to merge `completed/` into `archive/` across tasks and UAT; verify/ingest the ~10 flagged `raw/research/` topics if still relevant.
- **`BUG-0012`**: `open`, P3 — needs live investigation into host-server's dispatch-triggering condition.
- **`BUG-0011`**: `in-progress`, fix verified — needs a human to review/commit, then `/bug-close`.
- **`TASK-0166`**: `in-progress`, blocked on a human decision to run `scripts/backfill-agent-teams-flag.mjs`.
- **`ROADMAP-0022`**: `active`, all 4 tasks `pending-uat`, all 4 UATs generated. Next step is `/uat-walk` on each (human-judged, UI-heavy).
- **`TASK-133`**: `todo`, skipped — needs a human decision on `BUG-0001`'s unresolved primary-case gap.
- **`TASK-001`**: `pending-uat`, `UAT-001` is `failed` (3/11 pass) — needs a human to rewrite 7 stale-route test Commands and judge 1 live-mutation case.
- **`TASK-011`**: `pending-uat`, `UAT-011` is `pending` and unwalked — needs a human `/uat-walk`, not automation.
- **`TASK-012`**: `pending-uat`, `UAT-012` is `failed` (6/11 pass) — 4 UI cases need human verification.
- **`TASK-0164`**: `pending-uat`, 2/3 cases pass. **`TASK-151`**: `pending-uat`, 2/4 cases pass. **`TASK-132`**: `pending-uat`, 3/4 cases pass. **`TASK-0167`**: `pending-uat`, 8/9 cases pass.
- **`TASK-162`**: `pending-uat`, `UAT-162` generated (3 cases, all human-judged UI).
- **Orchestrator/task-routing research**: two rounds ingested, no task or decision filed yet.
- **`BUG-0001`**: `in-progress`, P1 — awaiting user decision, tracked by `TASK-133`.
- **`DEC-0003#D1`/`#D2`** (remote access): both `proposed` — deliberately left open by design.
