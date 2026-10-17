---
id: file-tree-ui-library-options
title: React File-Tree Component Options (Headless Tree, react-arborist, @pierre/trees, Hand-Rolled)
aliases: [tree view library comparison, file tree component options]
updated: 2026-09-20
sources:
  - ../../raw/research/project-file-tree/index.md
  - ../../raw/research/project-file-tree/sources.md
confidence: extracted
tags: [frontend, react, file-tree, dependencies]
---

# React File-Tree Component Options

`frontend/package.json` has no tree or virtualization dependency (React 19, react-router, lucide-react, dnd-kit, xterm, Tailwind 3). For a repo of ~900 collapsed-by-default paths, **virtualization is unnecessary**; the real value a library adds is accessible keyboard navigation (roving focus, expand/collapse keys, type-ahead), which is the fiddly part of the WAI-ARIA `tree` role — the repo already hand-builds the *tabs* pattern (`relates_to::[[accessible-tabs-pattern]]`).

| Option | Shape | Notes |
|--------|-------|-------|
| `[[headless-tree]]` (recommended) | Headless — we render rows with Tailwind; sync or async data loader; optional virtualization | No forced virtualization; `asyncDataLoaderFeature` for lazy children. npm version and React 19 peer range **not verified** |
| `[[react-arborist]]` (fallback) | Batteries-included, virtualized, custom node renderer, search | v3.16.0, peer `react >= 16.14`; ships drag/rename/create handlers we don't need; one commenter reports it is painful to customize |
| `[[pierre-trees]]` | Path-first: feed it a `paths: string[]`, built-in Git-status decorations | Input shape matches `git ls-files` exactly, but `1.0.0-beta.6` — API may change |
| Hand-rolled | ~60-line nested `<ul role="tree">` | Zero deps; you own ARIA and keyboard work |

Keep the chosen library behind one component (`FilesPanel`) so swapping it touches a single file. Library-choice sources are mostly vendor docs plus community opinion, so treat the ranking as a judgement call rather than a measured result.

derived_from::[[project-file-tree]]
uses::[[git-index-file-listing]]
