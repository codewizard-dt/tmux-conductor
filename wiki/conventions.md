---
title: Wiki Conventions
updated: 2026-06-11
---

# Wiki Conventions

The rules that govern every page in this wiki. They exist so the knowledge base stays navigable as it grows, and so the heavier overlays (confidence scoring, knowledge lifecycle, hybrid search, A-Mem-style link discovery) can be added **later as zero-migration add-ons**. Markdown + YAML frontmatter is forward-compatible by nature: unknown frontmatter keys and unknown `key::[[link]]` annotations are ignored until something is taught to read them.

Two of these conventions are cheap now and expensive to retrofit later — **atomic pages** and **stable IDs**. The rest can be adopted incrementally.

---

## 1. Atomic pages

**One concept, entity, or artifact per file.** When a page starts covering two things, split it and link the halves. Do not let monolithic pages form.

Why this is the one expensive-to-defer rule: typed links, Maps of Content, supersession, and any future Zettelkasten/A-Mem-style link graph all assume one-idea-per-note granularity. Splitting fat pages later means re-homing every inbound link and every frontmatter attribute. Enforcing atomicity now costs nothing.

## 2. Stable IDs & aliases

Reference pages by a **stable identity**, not a raw file path — so links survive reorganization.

- **Work families** carry an ID in frontmatter and filename: `REQ-NNN`, `DEC-NNNN` (per-decision `#DM`), `ROADMAP-NNN`, `TASK-NNN`, `UAT-NNN`, `BUG-NNNN`.
- **Knowledge pages** carry an `id` (kebab-case slug) plus an `aliases:` list of alternative names. Link by title/alias (`[[Karpathy]]`) rather than by path; the alias makes the reference durable even if the file moves.

## 3. Typed links

Plain `[[wikilinks]]` are always valid. When a link has a *meaning*, annotate it inline so the graph is semantically navigable:

```
implements::[[REQ-012]]
supersedes::[[DEC-0003#D2]]
derived_from::[[sources/karpathy-llm-wiki]]
```

**Vocabulary:** `derived_from`, `supersedes`, `superseded_by`, `implements`, `uses`, `depends_on`, `contradicts`, `relates_to`, `caused`, `fixed`.

This convention is **declared now but not backfilled** — use it on new and touched pages going forward; a future `/wiki-lint` pass can backfill the back-catalogue. Cost of starting now is zero; it just avoids accumulating a fresh pile of meaning-less links.

## 4. Frontmatter namespace

Every page has YAML frontmatter. **Base keys (used now):**

| Key | Applies to | Notes |
|-----|-----------|-------|
| `id` | all | stable slug or family ID (REQ-/DEC-/TASK-/BUG-/ROADMAP-) |
| `title` | all | human-readable title |
| `status` | work families | per the family's [lifecycle](#); see each `lifecycle.md` |
| `created` / `updated` | all | ISO dates (`YYYY-MM-DD`) |
| `tags` | all | flat list, discovery only — not primary structure |
| `aliases` | knowledge | alternative names for durable linking (item 2) |
| `sources` | knowledge | back-links to the `raw/` source(s) a page derives from |

**Reserved keys (declared, optional — populated later by overlays, safe to ignore until then):**

`confidence`, `tier`, `last_verified`, `supersedes`, `superseded_by`, `scope`.

Adopting the corresponding behavior later is a frontmatter backfill via lint — never a structural rewrite. Keep these names consistent if you use them early.

---

## Navigation: Maps of Content, not deep folders

[index.md](index.md) is the home Map of Content. Keep folders **shallow** — the link graph and the index carry the structure, not nesting. Status lives in frontmatter so it is greppable / Dataview-queryable without moving files. Tags are signals for discovery, not a replacement for links.

**Per-family active indexes.** Each `wiki/work/<family>/` carries an `index.md` listing **only its active items** (see each family's `lifecycle.md` for the active status set). When an item leaves the active set, its line is deleted from the family index — the file itself stays put until explicitly archived. Knowledge pages are listed in the home index; work items only in their family index (the home index links to the family indexes).

## The two-domain rule

Keep the two organizing laws separate — do not file a stateful artifact under `knowledge/` or a timeless synthesis under `work/`.

- **`knowledge/`** — timeless, descriptive, **link-organized**. Files are revised in place as understanding evolves; there is no `status`. Sub-trees: `sources/`, `concepts/`, `entities/{people,organisations,tools,components}/`.
- **`work/`** — stateful, **status-organized** lifecycle artifacts. Active files are **never moved** after creation; state lives in the `status:` field; each family has a `lifecycle.md` defining its schema and valid transitions, an `index.md` listing only active items, and an `archive/` subdirectory for terminal items. Sub-trees: `requirements/`, `decisions/`, `roadmaps/`, `tasks/`, `uat/`, `bugs/`.

Cross-domain links are encouraged and carry meaning — e.g. a decision `derived_from::` a source, a task `implements::` a requirement.

---

## 5. Archiving terminal items

Work item files are **permanent while active**. Once a file reaches a terminal status (`done`, `trashed`, `closed`, `passed`, `skipped`, `retired`, `wontfix`, `duplicate`, `cannot-reproduce`, or all decisions `accepted`/`superseded`), it **may** be moved to `<family>/archive/` by `/wiki-archive` to keep the family directory navigable.

**Why this is safe:** all links must use stable IDs (`[[TASK-023]]`, `[[BUG-0014]]`), not raw relative paths. Moving a file to `archive/TASK-023.md` changes only its storage location — the ID is unchanged. `/wiki-archive` updates `archive/index.md` and logs the operation.

Archiving is a periodic **maintenance operation**, not part of the close/done workflow. Run `/wiki-archive [family]` when a family directory grows unwieldy.

**`archive/index.md`** — each family's `archive/` carries its own index listing archived items with their final status and archive date. This file is **append-only**: archived items never move again.

## 6. Log rotation

`wiki/log.md` is append-only. When it grows past **~500 lines**, rotate it with `/wiki-rotate-log`:

1. Rename `wiki/log.md` → `wiki/log-<timestamp>.md`, where `<timestamp>` is `YYYY_MM_DD_HHMMSS` (to the second, so filenames never collide across rotations)
2. Create a fresh `wiki/log.md` with an archive-pointer header: `> Archives: [2026_06_14_153012](log-2026_06_14_153012.md) · [2025_12_31_092455](log-2025_12_31_092455.md)`
3. Continue appending to the new `log.md`

**Never truncate** — content always moves to a timestamped file, never deleted.

**Index growth:** `wiki/index.md` stays lean because work items are **never listed individually** in the home index — they appear only in their family `index.md`. The home index links to `wiki/work/<family>/index.md` per family, not to individual items.
