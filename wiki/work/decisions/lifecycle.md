---
title: Decisions Lifecycle
updated: 2026-09-20
---

# Decisions Lifecycle

Architecture Decision Records. Each file is a **Decision Group** containing one or more `## DM. <title>` decision blocks. ID scheme: **ADR-NNNN** (4-digit, zero-padded) for the group; **ADR-NNNN#DM** for an individual decision (e.g. `ADR-0001#D2`). Filename: `ADR-NNNN-slug.md`. Existing `DEC-NNNN` items keep their IDs (resolved via `aliases:`) until the `npx … update` migration renames them.

Files are **never moved** after creation; per-decision state lives in each block's `status` field. Finished groups are never moved — when all decisions in a group are `accepted`, `deprecated`, or `superseded`, the group stays in place and is listed under **Closed** in [`index.md`](index.md). A group stays listed under **Active** while at least one of its decisions is `proposed`.

## Frontmatter / per-decision schema

Group frontmatter:

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `ADR-NNNN` (legacy `DEC-NNNN`) |
| `title` | yes | decision-group title |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `tags` | yes | umbrella tags for the group |

Per-decision block (`## D1.`, `## D2.` …) metadata:

| Field | Required | Notes |
|-------|----------|-------|
| Status | yes | `proposed \| accepted \| deprecated \| superseded` |
| Date | yes | `YYYY-MM-DD` |
| Deciders | yes | who decided |
| Consulted / Informed | no | E-C-A-D-R inputs |
| Supersedes | no | `ADR-NNNN#DM \| none` |
| Tags | yes | decision-area tags |

## Status transitions

```
proposed ──▶ accepted ──▶ superseded
proposed / accepted ──▶ deprecated
```

- **proposed** — drafted in a Decision Group (`/adr-create`); comparison tables + mermaid flowchart, no commitment.
- **accepted** — finalized per-decision via `/adr-finalize` after an E-C-A-D-R audit. Siblings in the same group are untouched.
- **superseded** — replaced by a later accepted decision; the new block sets `Supersedes:` and the old block is marked `superseded by ADR-NNNN#DM` (legacy `superseded by DEC-NNNN#DM` stays valid). Both blocks updated atomically; old block preserved. Set only by `/adr-finalize`.
- **deprecated** — withdrawn without a successor via `/adr-deprecate`; status-only — the block is preserved with a `> **Deprecated**` callout and the file never moves.
