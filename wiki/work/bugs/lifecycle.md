---
title: Bugs Lifecycle
updated: 2026-06-11
---

# Bugs Lifecycle

Bug reports with reproduction, impact, root-cause, and resolution. ID scheme: **BUG-NNNN** (4-digit, zero-padded, globally unique). Filename: `BUG-NNNN-slug.md`.

Active files are **never moved** after creation; state lives in the `status:` frontmatter field. Terminal items (`closed`, `wontfix`, `duplicate`, `cannot-reproduce`) may be moved to [`archive/`](archive/) by `/wiki-archive`. The active set is tracked in [`index.md`](index.md).

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `BUG-NNNN` |
| `title` | yes | short slug/summary |
| `status` | yes | `open \| triaged \| in-progress \| closed \| wontfix \| duplicate \| cannot-reproduce` |
| `severity` | yes | `critical \| high \| medium \| low` |
| `priority` | yes | `P0 \| P1 \| P2 \| P3` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `reporter` | yes | who filed it |
| `assignee` | no | `unassigned` until triage |
| `tags` | no | discovery only |

Closing requires a Root Cause Analysis, a fix commit, and a regression test (`/bug-close` gate).

## Status transitions

```
open ──▶ triaged ──▶ in-progress ──▶ closed
                 └──▶ wontfix | duplicate | cannot-reproduce
```

- **open** — filed (`/bug-file`); required-on-report fields present.
- **triaged** — priority/severity/assignee set (`/bug-triage`); decision to fix, defer, or reject.
- **in-progress** — actively being fixed.
- **closed** — fixed and verified (`/bug-close`): root cause + fix commit + regression test recorded.
- **wontfix / duplicate / cannot-reproduce** — terminal rejections; reason recorded in the body.
