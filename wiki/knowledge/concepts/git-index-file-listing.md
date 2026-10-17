---
id: git-index-file-listing
title: Listing a Repo's Files from the Git Index (git ls-files) Instead of Walking the Filesystem
aliases: [git ls-files file list, index-based file listing]
updated: 2026-09-20
sources:
  - ../../raw/research/project-file-tree/index.md
  - ../../raw/research/project-file-tree/sources.md
confidence: extracted
tags: [git, file-tree, host-server, performance]
---

# Listing a Repo's Files from the Git Index

When the goal is "show the files in this repo", ask git rather than re-deriving ignore rules from a `readdir` walk. `git ls-files --cached --others --exclude-standard` lists tracked plus untracked-but-not-ignored files and applies `.git/info/exclude`, every `.gitignore` up to the worktree root, and the user's global excludes file. In this repo it lists 842 tracked + 75 untracked files in ~0.011 s; one community measurement found index-based listing ~50× faster than a filesystem walk on a repo with a 33k-entry dependency directory (single anecdotal source, consistent with the local number).

**Side benefits.** Ignored secrets (`.env`) and bulky directories (`node_modules`, `logs/`, `data/`, `tmp/`, `worktrees/`) are excluded for free. One call returns a flat path list; the client builds the nesting.

**Caveats** (inference from git's documented flags — not exercised at runtime): `-c` reports index entries even when the file was deleted in the working tree, so subtract with `--deleted` or an existence check; directories are never emitted, so empty directories don't appear and nesting is derived from path prefixes; git does not follow symlinks when reading `.gitignore`. A non-git workdir needs a bounded `readdir` fallback (depth and entry caps, skip `.git`/`node_modules`, a `truncated` flag — the same cap-and-flag pattern as `GET /agents/:id/diff`).

Worktree-backed agents must be listed from `worktreePath`, not `workdir`, per `relates_to::[[agent-worktree-lifecycle]]`.

derived_from::[[project-file-tree]]
relates_to::[[Host Server]]
