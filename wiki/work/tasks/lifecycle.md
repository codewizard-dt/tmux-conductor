---
title: Tasks Lifecycle
updated: 2026-09-20
---

# Tasks Lifecycle

Execution-ready task files with `## Steps` checklists. ID scheme: **TASK-NNNN** (4-digit, zero-padded). Filename: `TASK-NNNN-slug.md`. UAT test files mirror task naming (**UAT-NNNN**) and live in the sibling [`../uat/`](../uat/) family.

Existing `TASK-NNN` files created before 2026-09-13 keep their 3-digit names permanently; only IDs assigned after that date use 4 digits.

Active files are **never moved** after creation; state lives in the `status:` frontmatter field. Terminal items (`done`, `trashed`) may be moved to [`archive/`](archive/) by `/wiki-archive`. The active set is tracked in [`index.md`](index.md).

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `TASK-NNNN` |
| `title` | yes | task title |
| `status` | yes | `todo \| in-progress \| pending-uat \| done \| trashed` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `depends_on` | no | `TASK-NNNN` IDs that must finish first |
| `blocks` | no | `TASK-NNNN` IDs this one gates |
| `parallel_safe_with` | no | `TASK-NNNN` IDs safe to run concurrently |
| `uat` | no | link to the matching `../uat/UAT-NNNN-slug.md` |
| `tags` | no | discovery only |

**Dependency fields.** `depends_on`, `blocks`, and `parallel_safe_with` are YAML arrays of `TASK-NNNN` IDs (`[]` when empty) and are the **sole authoritative, machine-read** encoding of task dependencies (per DEC-0001#D4).
Edges should be symmetric: if A lists B in `blocks`, B lists A in `depends_on` — tooling flags asymmetry and never auto-corrects it.
A body `depends_on::[[TASK-NNNN]]` / `blocks::[[TASK-NNNN]]` typed-link line under the H1 is an optional mirror for graph views (Obsidian/Breadcrumbs) and is never read by tooling.
The legacy `> **Depends on**:` blockquote and `## Dependencies` body headings are not part of the schema.

## Status transitions

```
todo ──▶ in-progress ──▶ pending-uat ──▶ done
  │            │              │
  └────────────┴──────────────┴──▶ trashed
```

- **todo** — created by `/task-create`; not yet started.
- **in-progress** — being executed (`/tackle`). `/tackle` runs **static gates only** (typecheck, `bash -n`, lint, unit tests); runtime/E2E verification is the UAT phase.
- **pending-uat** — implementation complete: every `## Steps` checkbox is checked and `/tackle` set this status. Awaiting verification — `/uat-create` if no UAT exists yet, then `/uat-walk` / `/uat-auto`. Still an active state (stays listed in `index.md`).
- **done** — verification finished — its UAT passed (`/uat-walk` / `/uat-auto`) or was explicitly skipped (`/uat-skip`).
- **trashed** — terminal; abandoned via `/task-close` with the reason recorded in the file. The matching UAT is trashed alongside.

A task reaches **done** only when its UAT is all-pass or skipped — see the [UAT lifecycle](../uat/lifecycle.md).
