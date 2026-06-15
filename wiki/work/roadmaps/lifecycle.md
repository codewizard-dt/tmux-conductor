---
title: Roadmaps Lifecycle
updated: 2026-06-11
---

# Roadmaps Lifecycle

Execution-plan roadmaps: a goal, phases, and a hybrid checklist where each item is either a **task link** (`[TASK-NNN](../tasks/TASK-NNN-slug.md)`) or an **inline** checkbox item. ID scheme: **ROADMAP-NNN** (3-digit, zero-padded). Filename: `ROADMAP-NNN-slug.md`.

Active files are **never moved** after creation; state lives in the `status:` frontmatter field. Terminal items (`done`) may be moved to [`archive/`](archive/) by `/wiki-archive`. The active set is tracked in [`index.md`](index.md).

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `ROADMAP-NNN` |
| `title` | yes | roadmap goal |
| `status` | yes | `active \| done` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `owner` | no | accountable person/role |
| `linked_requirements` | no | `REQ-NNN` back-links |
| `linked_decisions` | no | `DEC-NNNN` back-links |
| `tags` | no | discovery only |

## Status transitions

```
active ──▶ done
```

- **active** — at least one unchecked item remains. Items are added with `/roadmap-add`; task-linked items auto-check when their task completes.
- **done** — every checklist item is checked. Completion is implicit; flip `status` to `done` when the last box is ticked.
