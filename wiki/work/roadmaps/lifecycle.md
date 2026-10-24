---
title: Roadmaps Lifecycle
updated: 2026-09-20
---

# Roadmaps Lifecycle

Execution-plan roadmaps: a goal, phases, and a hybrid checklist where each item is either a **task link** (`[TASK-NNNN](../tasks/TASK-NNNN-slug.md)`) or an **inline** checkbox item. ID scheme: **ROADMAP-NNNN** (4-digit, zero-padded). Filename: `ROADMAP-NNNN-slug.md`.

Existing `ROADMAP-NNN` files created before 2026-09-13 keep their 3-digit names permanently; only IDs assigned after that date use 4 digits.

Files are **never moved** after creation; state lives in the `status:` frontmatter field. Finished items are never moved — a terminal item (`done`) stays in place and is listed under **Closed** in [`index.md`](index.md); the roadmaps still in progress are listed under **Active**.

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `ROADMAP-NNNN` |
| `title` | yes | roadmap goal |
| `status` | yes | `active \| done` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `owner` | no | accountable person/role |
| `linked_requirements` | no | `PRD-NNNN` (or legacy `REQ-NNNN`) back-links |
| `linked_decisions` | no | `ADR-NNNN` (legacy `DEC-NNNN`) back-links |
| `tags` | no | discovery only |

## Status transitions

```
active ──▶ done
```

- **active** — at least one unchecked item remains. Items are added by editing the roadmap file directly, at creation via `/roadmap-create`, or via `/task-create --roadmap ROADMAP-NNNN` (auto-links a new task); task-linked items auto-check when their task completes.
- **done** — every checklist item is checked. Completion is implicit; flip `status` to `done` when the last box is ticked.
