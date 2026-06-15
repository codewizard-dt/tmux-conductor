---
title: Requirements Lifecycle
updated: 2026-06-11
---

# Requirements Lifecycle

Requirements (PRDs) capture the problem, personas, user stories, success metrics, and non-goals for a body of work. ID scheme: **REQ-NNN** (3-digit, zero-padded, globally unique). Filename: `REQ-NNN-slug.md`.

Active files are **never moved** after creation; state lives in the `status:` frontmatter field. Terminal items (`retired`) may be moved to [`archive/`](archive/) by `/wiki-archive`. The active set is tracked in [`index.md`](index.md).

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `REQ-NNN` |
| `title` | yes | short requirement name |
| `status` | yes | `draft \| approved \| retired` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `owner` | yes | accountable person/role |
| `stakeholders` | no | consulted/informed list |
| `tags` | no | discovery only |

Approved requirements are amended via append-only `## Amendment N` blocks, never edited in place.

## Status transitions

```
draft ──▶ approved ──▶ retired
```

- **draft** — under construction (`/req-create`); edited freely.
- **approved** — completeness-audited and locked (`/req-finalize`); changes are append-only amendments (`/req-update`).
- **retired** — superseded or no longer in force; preserved for history.
