---
id: TASK-0186
aliases: [TASK-0186]
title: "Record the policy for bg processes with no project: shared, visible and restartable by every agent"
status: trashed
created: 2026-09-19
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: [TASK-0187, TASK-0188, TASK-0189]
uat: ""
tags: [bg-processes, decision, roadmap-0024]
---

# TASK-0186 — Record the policy for bg processes with no project: shared, visible and restartable by every agent

relates_to::[[bg-process-agent-access]]
relates_to::[[background-process-registry]]

> ROADMAP-0024 Phase 1 decision. Documentation-only: no code changes. The later restart-guard, `dev-commands list` and Background-tab items consume this rule.

## Objective

`bg_processes.project_id` is nullable, so some processes belong to no project (legacy rows, plus anything created without a selector). The human decision (2026-09-19): an **unassigned bg process is shared infrastructure** — every agent, in any project or none, can list, tail and restart it. Record that decision and the exact access rule so the Phase 2-3 implementation tasks encode it consistently.

## Approach

**Decision (chosen by the user):** unassigned = visible to and restartable by every agent. Rejected: (a) visible read-only with restart blocked until a human assigns a project (the recommended-but-declined default); (b) hidden from agents entirely.

**Access rule to encode in later tasks:**

| Caller | Process `project_id` | May list/tail | May restart |
|---|---|---|---|
| Agent in project P | `NULL` (unassigned) | yes | yes |
| Agent in project P | `P` | yes | yes |
| Agent in project P | other project Q | no (excluded from default list; only via an explicit all-projects option, read-only) | no |
| Agent with no project | `NULL` | yes | yes |
| Agent with no project | any project | no | no |

Assumptions to confirm during review: the all-projects `list` option is read-only (never grants restart across projects), and an agent with no project may act only on unassigned processes.

## Steps

### 1. Record the decision in ROADMAP-0024 Notes  <!-- agent: general-purpose -->

- [ ] `Read` `wiki/work/roadmaps/ROADMAP-0024-project-bg-process-agent-restart.md`, then `Edit` its `## Notes` section to append a bullet: "Unassigned bg processes (`project_id IS NULL`) are shared: visible and restartable by every agent (decided 2026-09-19, TASK-0186). Access rule table: see TASK-0186 Approach."
  - Re-read the file immediately before editing — TASK-0188 appends its own Notes bullet; do not overwrite it.
  - Do not change any checkbox line in the roadmap.

### 2. Update the concept page  <!-- agent: general-purpose -->

- [ ] `Read` then `Edit` `wiki/knowledge/concepts/background-process-registry.md`: add an "Access policy (2026-09-19)" paragraph before the trailing `relates_to::` lines stating the decision, the access-rule table above, and the rejected alternatives. Bump `updated:`. Work items are not knowledge sources, so do not add this task to the page's `sources:`; cite the decision as plain text only.
  - The page's `confidence: inferred` already fits; leave it unchanged.

### 3. Carry the rule into the consumer tasks' notes  <!-- agent: general-purpose -->

- [ ] Append a note to this task's own `## Notes` section listing the consumers that must implement the rule: the restart guard (ROADMAP-0024 Phase 3 item 1), `dev-commands list` default filtering (Phase 3 item 2), the Background tab data source (Phase 4 item 1). `/roadmap-next` links their `depends_on:` to TASK-0186 when it creates them.

### 4. Log  <!-- agent: general-purpose -->

- [ ] Append a `decision` entry to `wiki/log.md` (`Read` the tail first — parallel sessions append there): "## [YYYY-MM-DD] decision | TASK-0186 unassigned bg processes are shared". One sentence summarizing the rule.

## Notes

