---
topic: how would we show a file tree of the proejt ???
slug: project-file-tree
researched: 2026-09-20
---

# Primary Sources — Showing a file tree of the project

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts` — `GET /browse` (~L2165–2194) | 2026-09-20 | Existing dir-only listing: any absolute/`~` path, skips dot-names, no root restriction, returns `{ path, parent, entries }` |
| S2 | codebase | `host-server/index.ts` — `GET /agents/:id/diff` (~L1634–1671) | 2026-09-20 | `worktreePath \|\| workdir` root rule, `isGitRepo` short-circuit, `spawnSync git -C`, 500 KB cap + `truncated` flag |
| S3 | codebase | `host-server/git.ts` — `isGitRepo`, `getGitRoot`, `detectBaseBranch`, `SHELL_SYNC_TIMEOUT_MS` | 2026-09-20 | Reusable git helpers; `getGitRoot` uses `rev-parse --show-toplevel` |
| S4 | codebase | `frontend/src/components/AgentInfoTabs.tsx::AgentInfoTabs` | 2026-09-20 | Hand-built WAI-ARIA tabs; all present tabs' content is rendered every render, only `hidden` toggles; `present` flag omits a tab |
| S5 | codebase | `frontend/src/components/AgentList.tsx` — `tabs: AgentInfoTabDef[]` (~L851–992) | 2026-09-20 | Tab ids `terminal, skills, details, queued-tasks, diff, usage, checkpoints`; `DiffPanel`/`CheckpointList` as agent-scoped panels |
| S6 | codebase | `frontend/package.json` | 2026-09-20 | React 19.2, lucide-react, dnd-kit, xterm, Tailwind 3; no tree/virtualization lib |
| S7 | codebase | `host-server/index.ts` — CORS setup (~L51–55), `HOST` default (~L2846) | 2026-09-20 | `CORS_ORIGIN` defaults to `*`; server binds `127.0.0.1` by default |
| S8 | codebase (local measurement) | `git ls-files \| wc -l`; `git ls-files -co --exclude-standard` timed in repo root | 2026-09-20 | 842 tracked + 75 untracked-unignored files; whole-repo listing in ~0.011 s; top-level counts: wiki 580, raw 132, frontend 70, host-server 39 |
| S9 | context7 | `/lukasbach/headless-tree` — "async data loader lazy loading children on expand with React, and virtualization" | 2026-09-20 | `asyncDataLoaderFeature`, `getChildren`, loading state, virtualization recipe, `expandAll` |
| S10 | context7 | `/jameskerr/react-arborist` — "lazy loading children on toggle, controlled data, custom node renderer, height and rowHeight props" | 2026-09-20 | `Tree` props: `data`, `rowHeight`, `height`, `indent`, `searchTerm`, custom node renderer, `openByDefault`, DnD/rename handlers |
| S11 | context7 | `/websites/trees_software` (`@pierre/trees`) — "React file tree from list of paths, Git status decorations, installation" | 2026-09-20 | `useFileTree({ paths })`, `<FileTree />`, `setGitStatus`, `prepareFileTreeInput`; documented as beta |
| S12 | npm registry (`npm view`) | `react-arborist`; `@pierre/trees` | 2026-09-20 | react-arborist 3.16.0, modified 2026-07-25, peer `react >= 16.14`; @pierre/trees 1.0.0-beta.6, modified 2026-08-22, peer `react ^18.3.1 \|\| ^19.0.0` |
| S13 | web | https://git-scm.com/docs/git-ls-files | 2026-09-20 | Standard exclusions (`.git/info/exclude`, per-dir `.gitignore`, global excludes) apply with the `--others`/`--exclude-standard` flags |
| S14 | web | https://git-scm.com/docs/gitignore | 2026-09-20 | Patterns read from `.gitignore` up to the worktree root; "Git does not follow symbolic links when accessing a .gitignore file in the working tree" |
| S15 | web | https://github.com/pktstorm/headstate/issues/1031 | 2026-09-20 | Anecdotal measurement: `git ls-files` 0.01 s vs. 0.718 s scandir+stat over a 33,574-entry deps dir; recommends index-based listing over readdir |
| S16 | web | https://reactscript.com/best-tree-view/ | 2026-09-20 | Only react-arborist and headless-tree named as virtualized options for 10k+ node trees |
| S17 | web | https://www.reddit.com/r/reactjs/comments/1jzuu9r/headless_tree_is_available_as_beta/ and https://medium.com/@lukasbach/headless-tree-and-the-future-of-react-complex-tree-fc920700e82a | 2026-09-20 | Headless Tree author's claims (successor to react-complex-tree, virtualization optional); a commenter's opinion that react-arborist is painful to customize |

## Excerpts

### S1 — GET /browse
`host-server/index.ts`
> `api.get<{ Querystring: { path?: string } }>('/browse', ...)` … `.filter((e) => e.isDirectory() && !e.name.startsWith('.'))` … `return reply.send({ path: resolved, parent, entries });`

### S2 — GET /agents/:id/diff
`host-server/index.ts`
> `const workdir = entry.worktreePath || entry.workdir;` … `if (!isGitRepo(workdir)) { return reply.send({ diff: null, base: null }); }` … `const MAX_DIFF_BYTES = 500 * 1024;`

### S4 — AgentInfoTabs
`frontend/src/components/AgentInfoTabs.tsx`
> "Every present tab's content is rendered on every render (never conditionally mounted/unmounted) — only the `hidden` attribute toggles which panel is visible."

### S7 — CORS / bind
`host-server/index.ts`
> `const corsOrigin = process.env['CORS_ORIGIN'] || '*';` … `const host = process.env['HOST'] ?? '127.0.0.1';`

### S8 — local measurement (verbatim command output)
> `842` (tracked) / `75` (untracked, not ignored) / `git ls-files -co --exclude-standard > /dev/null  0.00s user 0.00s system 84% cpu 0.011 total`

### S9 — Headless Tree async data loader
https://github.com/lukasbach/headless-tree/blob/main/packages/docs/docs/2-features/03-async-dataloader.mdx
> "Use asyncDataLoaderFeature instead of syncDataLoaderFeature. The getItem and getChildren methods are async and return promises."

### S11 — @pierre/trees
https://trees.software/docs
> "Trees is currently in beta, with public entry points available for React, vanilla, and SSR. Expect potential refinements and minor API changes."

> `const model = useFileTree({ paths: ["src/components/Button.tsx", "src/components/Input.tsx", "src/utils/helpers.ts"] });`

### S13 — git ls-files
https://git-scm.com/docs/git-ls-files
> "Add the standard Git exclusions: .git/info/exclude, .gitignore in each directory, and the user's global exclusion file."

### S14 — gitignore
https://git-scm.com/docs/gitignore
> "Git does not follow symbolic links when accessing a .gitignore file in the working tree."

### S15 — headstate issue #1031
https://github.com/pktstorm/headstate/issues/1031
> "git ls-files, whole repo (ghstat, enc-api, cm-backend, worldmonitor) 0.01s each … scandir + stat over the 33,574-entry deps directory 0.718s"

### S16 — ReactScript
https://reactscript.com/best-tree-view/
> "You must use a library with virtualization support. React Arborist and headless-tree implement this feature. They only render the nodes currently visible in the viewport."

### S17 — Headless Tree (author + community)
https://www.reddit.com/r/reactjs/comments/1jzuu9r/headless_tree_is_available_as_beta/
> "The last tree library I used was React Arborist, which is pretty good but somewhat painful to customize, I had to fork it to achieve what I wanted."

https://medium.com/@lukasbach/headless-tree-and-the-future-of-react-complex-tree-fc920700e82a
> "It would have been possible to implement virtualization as core part of the library, but I also didn't want that since virtualization can be janky in many cases, and forcing it onto every user is also something that I don't think would have made a lot of sense."
