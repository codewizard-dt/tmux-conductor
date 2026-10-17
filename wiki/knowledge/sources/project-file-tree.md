---
id: project-file-tree
title: Showing a File Tree of the Project
aliases: [project-file-tree, file tree, Files tab, repo file explorer]
updated: 2026-09-20
sources:
  - ../../../raw/research/project-file-tree/index.md
  - ../../../raw/research/project-file-tree/sources.md
confidence: extracted
tags: [frontend, host-server, file-tree, git, security]
---

# Showing a File Tree of the Project

The research read "a file tree of the project" as a browsable repo explorer for an agent's working directory, and found **no file-listing route exists today**: `GET /browse` returns one level of *directories only* for the folder picker, accepts any absolute path with no root restriction, and cannot be reused as-is. The agent-scoped `GET /agents/:id/diff` route is the model to copy — it picks `entry.worktreePath || entry.workdir`, short-circuits on `!isGitRepo`, shells out via `spawnSync git -C`, and caps output with a `truncated` flag. The UI slot is the `tabs` array in `AgentList.tsx` (`terminal | skills | details | queued-tasks | diff | usage | checkpoints`), where a `files` tab would sit beside `diff`.

**Recommendation: source the list from git, render it with a small headless tree library, ship names only.** A new `GET /agents/:id/files` returns a flat `paths` list from `git ls-files -co --exclude-standard -z` (measured ~11 ms for this repo's 842 tracked + 75 untracked files; honors `.gitignore`, so `node_modules`, `logs/`, `data/` and `.env` never appear), with a bounded `readdir` fallback for non-git workdirs. The client derives the directory nesting from path prefixes. See `uses::[[git-index-file-listing]]` and `uses::[[file-tree-ui-library-options]]` (recommended `@headless-tree/*`, fallback `react-arborist`; `@pierre/trees` is still beta).

**Two constraints matter more than the tree itself.** (1) `AgentInfoTabs` mounts *every* present tab's content on every render and only toggles `hidden`, so a fetching panel must gate its request on the active tab id. (2) The host-server binds `127.0.0.1` but defaults CORS to `*`, so any page open in the user's browser can read its responses; a names-only list is a marginal increase over `/browse`, but **serving file contents is not** — that needs restricted CORS, a realpath-jailed route and a deny-list first (`relates_to::[[local-server-cors-wildcard-exposure]]`). File preview is therefore a separate follow-up task/decision.

relates_to::[[Host Server]]
relates_to::[[AgentDetailModal]]
relates_to::[[accessible-tabs-pattern]]
relates_to::[[agent-worktree-lifecycle]]
relates_to::[[headless-tree]]
relates_to::[[react-arborist]]
relates_to::[[pierre-trees]]
