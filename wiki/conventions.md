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

**Per-family active indexes.** Each `wiki/work/<family>/` carries an `index.md` listing **only its active items** (see each family's `lifecycle.md` for the active status set). When an item leaves the active set, its line is deleted from the family index — the file itself never moves. Knowledge pages are listed in the home index; work items only in their family index (the home index links to the family indexes).

## The two-domain rule

Keep the two organizing laws separate — do not file a stateful artifact under `knowledge/` or a timeless synthesis under `work/`.

- **`knowledge/`** — timeless, descriptive, **link-organized**. Files are revised in place as understanding evolves; there is no `status`. Sub-trees: `sources/`, `concepts/`, `entities/{people,organisations,tools,components}/`.
- **`work/`** — stateful, **status-organized** lifecycle artifacts. Files are **never moved** after creation; state lives in the `status:` field; each family has a `lifecycle.md` defining its schema and valid transitions, and an `index.md` listing only active items. Sub-trees: `requirements/`, `decisions/`, `roadmaps/`, `tasks/`, `uat/`, `bugs/`.

Cross-domain links are encouraged and carry meaning — e.g. a decision `derived_from::` a source, a task `implements::` a requirement.
