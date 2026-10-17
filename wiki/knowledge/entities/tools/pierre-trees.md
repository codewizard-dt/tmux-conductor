---
id: pierre-trees
title: "@pierre/trees"
aliases: [pierre-trees, "@pierre/trees", Trees by The Pierre Computer Co.]
updated: 2026-09-20
sources:
  - ../../../raw/research/project-file-tree/index.md
tags: [tool, frontend, react, file-tree]
---

# @pierre/trees

Path-first file-tree library for React, vanilla JS and SSR: `useFileTree({ paths })` plus `<FileTree />`, with search, rename, drag-and-drop, built-in Git-status decorations (`setGitStatus`) and `prepareFileTreeInput` for large lists. Version `1.0.0-beta.6` (npm modified 2026-08-22), peer `react ^18.3.1 || ^19.0.0`; its docs say it is **beta** and "expect potential refinements and minor API changes". Its input shape matches the `git ls-files` payload in `[[git-index-file-listing]]` exactly, but beta status makes it a maintenance risk; it becomes the lowest-code option if it reaches a stable 1.0. See `[[file-tree-ui-library-options]]`.

relates_to::[[file-tree-ui-library-options]]
relates_to::[[project-file-tree]]
