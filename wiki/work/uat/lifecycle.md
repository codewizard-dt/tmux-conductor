---
title: UAT Lifecycle
updated: 2026-06-11
---

# UAT Lifecycle

User-acceptance test files, one per task. ID scheme: **UAT-NNNN** (4-digit, zero-padded) — the number **mirrors the task it verifies** (`UAT-0014` ↔ `TASK-0014`). Filename: `UAT-NNNN-slug.md`.

Active files are **never moved** after creation; state lives in the `status:` frontmatter field. Terminal items (`passed`, `skipped`, `trashed`) may be moved to [`archive/`](archive/) by `/wiki-archive`. The active set is tracked in [`index.md`](index.md).

## Frontmatter schema

| Key | Required | Notes |
|-----|----------|-------|
| `id` | yes | `UAT-NNNN` |
| `title` | yes | UAT title |
| `status` | yes | `pending \| in-progress \| passed \| failed \| skipped \| trashed` |
| `task` | yes | `TASK-NNNN` back-link to the task under test |
| `created` / `updated` | yes | `YYYY-MM-DD` |
| `tags` | no | discovery only |

The body carries an `implements::[[TASK-NNNN]]` typed link; the task carries a `uat:` frontmatter link back (`../uat/UAT-NNNN-slug.md`).

## Per-test markers

Each test in the file carries a status marker: `[ ]` (not run), `[x]` (pass), `[FAIL: …]`, `[SKIP: …]`.

## Status transitions

```
pending ──▶ in-progress ──▶ passed
                 │              ▲
                 ├──▶ failed ───┘ (rerun after fixes)
pending ──▶ skipped   (/uat-skip — intentional skip, skeleton documents why)
any     ──▶ trashed   (/task-close — task abandoned; reason recorded)
```

- **pending** — created by `/uat-create`; not yet executed.
- **in-progress** — being walked (`/uat-walk`) or run headlessly (`/uat-auto`).
- **passed** — every test `[x]`; the matching task flips to `done`.
- **failed** — one or more `[FAIL: …]` markers after a full run; flips back to `in-progress` on rerun.
- **skipped** — UAT deliberately not run (`/uat-skip`); the file records why.
- **trashed** — terminal; the task was trashed (`/task-close`); reason recorded in the file.

A task reaches **done** only when its UAT is `passed` or `skipped`. See the [tasks lifecycle](../tasks/lifecycle.md).

Screenshots and other binary evidence live in [`screenshots/`](screenshots/) (exempt from page conventions).
