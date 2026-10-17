---
id: headless-tree
title: Headless Tree
aliases: [headless-tree, "@headless-tree/react", "@headless-tree/core"]
updated: 2026-09-20
sources:
  - ../../../raw/research/project-file-tree/index.md
tags: [tool, frontend, react, file-tree]
---

# Headless Tree

Framework-agnostic, headless tree library by the author of react-complex-tree (its stated successor): it supplies state, keyboard navigation, search, drag features and an optional async data loader, while the consumer renders the rows (here, with Tailwind). `asyncDataLoaderFeature` marks items and children as loading; virtualization is a documented recipe rather than forced core behavior. Recommended candidate for the Files tab in `[[project-file-tree]]`.

**Unverified:** its current npm version and React 19 peer range — the npm query was blocked during research; check at install time. See `[[file-tree-ui-library-options]]`.

relates_to::[[file-tree-ui-library-options]]
relates_to::[[react-arborist]]
relates_to::[[React]]
