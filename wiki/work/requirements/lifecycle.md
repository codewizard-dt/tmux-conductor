---
title: Requirements Lifecycle
updated: 2026-09-20
---

# Requirements Lifecycle

Requirements (PRDs) capture the problem, personas, user stories, success metrics, and non-goals for a body of work. ID scheme: **PRD-NNNN** (4-digit, zero-padded, globally unique). Filename: `PRD-NNNN-slug.md`. Existing `REQ-NNNN` files keep their names until the `npx … update` migration renames them (the old ID is kept in `aliases:`).

Files are **never moved** after creation; state lives in the `status:` frontmatter field. Finished items are never moved — a terminal item (`retired`) stays in place and is listed under **Closed** in [`index.md`](index.md); `draft` and `approved` requirements are listed under **Active**.

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `PRD-NNNN` (legacy `REQ-NNNN`) |
| `title` | yes | short requirement name |
| `status` | yes | `draft \| approved \| retired` |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `owner` | yes | accountable person/role |
| `stakeholders` | no | consulted/informed list |
| `tags` | no | discovery only |

Approved requirements are locked in substance; changes are made by editing the file directly (existing `## Amendment N` blocks are retained as history; no skill produces them). To supersede, create a new requirement with `/prd-create`, then `/prd-deprecate` the old one.

## Status transitions

```
draft ──▶ approved ──▶ retired
```

- **draft** — under construction (`/prd-create`); edited freely.
- **approved** — completeness-audited and locked (`/prd-finalize`); changes are made by editing the file directly (no amendment skill).
- **retired** — superseded or no longer in force; preserved for history; set via `/prd-deprecate` (status-only; the status keeps the name `retired`).
