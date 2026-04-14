# Task Lifecycle

How task and UAT files move through the project, and which slash command performs each move.

---

## Directory Layout

```
.docs/tasks/                .docs/uat/
├── active/                 ├── pending/
├── completed/              ├── completed/
└── trashed/                ├── skipped/
                            ├── trashed/
                            └── screenshots/   (temporary)
```

Tasks and UATs share a `<NNN>-<slug>` identifier so they sort and cross-reference naturally (e.g. task `5-positions.md` ↔ UAT `5-positions.uat.md`).

---

## Happy Path

```
/add-task        /tackle        /uat-generator      /uat-walkthrough (all complete)
   │                │                  │                    │
   ▼                ▼                  ▼                    ▼
active/          active/            active/             completed/
                                    pending/            completed/
```

**Key point:** `/tackle` does **not** move the task file. The task stays in `active/` through implementation and UAT generation. It only moves to `completed/` when all UAT tests are resolved — every test is either passed (`[x] Pass`) or skipped (`[SKIP: ...]`), with no `[FAIL]` or `[FIXING]` markers remaining (or when `/uat-skip` is used).

---

## Command → File Movement

| Command | Task file | UAT file | Notes |
|---------|-----------|----------|-------|
| `/add-task` | **creates** in `active/` | — | Numbers scanned across `active/` + `completed/` |
| `/update-task` | — | — | Rewrites task in place |
| `/tackle` | — | — | Implementation only; no moves |
| `/uat-generator` | — | **creates** in `pending/` | Appends UAT cross-link to task file |
| `/uat-walkthrough` (all complete) | `active/` → `completed/` | `pending/` → `completed/` | Complete = all tests `[x] Pass` or `[SKIP]`, no `[FAIL]`/`[FIXING]`; updates cross-links; deletes screenshots; runs `/update-docs` |
| `/uat-walkthrough` (any fail / abort) | — | — | Stays in place; screenshots kept for debugging |
| `/uat-skip` | `active/` → `completed/` | `pending/` → `skipped/`, or **creates** skeleton in `skipped/` | Deletes screenshots; updates cross-links |
| `/trash-task` | `active/` or `completed/` → `trashed/` | any location → `trashed/` | Updates references in indexes and cross-linked files |
| `/update-docs` | — | — | Refreshes doc state and checkboxes; no file moves |

---

## Naming Convention

```
<NNN>-<short-slug>.md          # task file
<NNN>-<short-slug>.uat.md      # matching UAT file
```

- `<NNN>`: zero-padded sequential integer, unique across `active/` and `completed/`
- `<short-slug>`: lowercase, hyphen-separated, 2–4 words

The shared `<NNN>-<short-slug>` is what every command uses to find the matching task ↔ UAT pair when moving files.

---

## See Also

- [`.docs/tasks/active/README.md`](../tasks/active/README.md) — task file structure spec
- [`.docs/guides/mcp-tools.md`](./mcp-tools.md) — MCP tool reference used by all task commands
