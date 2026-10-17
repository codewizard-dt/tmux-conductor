---
topic: how would we show a file tree of the proejt ???
slug: project-file-tree
researched: 2026-09-20
sources: [./sources.md]
---

# Research: Showing a file tree of the project

> Add a **Files** tab to the agent detail view (next to Diff / Checkpoints) that renders the agent's working tree (`worktreePath || workdir`). Back it with one new host-server route that returns a **flat list of paths from `git ls-files -co --exclude-standard`** (git is the authority on "what is in the repo", ~11 ms here, and it automatically hides `node_modules`, `.env`, and other ignored files), with a bounded `readdir` fallback for non-git workdirs. Render it client-side with a small headless tree library (recommended: `@headless-tree/*`; fallback: `react-arborist`). Ship v1 as **names only**; file-content preview is a separate step because the server's default CORS policy is `*`.

## Research Questions

1. What does the codebase already have that a file tree can build on (routes, git helpers, UI slots)?
2. Where should the tree live in the UI, and what does the tab system constrain?
3. Where should the file list come from — `readdir` walk vs. `git ls-files`?
4. Build the tree component by hand, or use a library — and which one?
5. What are the security implications for this server (path traversal, CORS, secrets)?

> Interpretation note: "file tree of the project" is read as a browsable repo explorer for an agent's working directory / a project's `workdir`. It is not read as an ASCII `tree` dump in docs. If the latter was meant, the answer is a one-liner (`git ls-files | tree --fromfile`), see [S13]/[S14] for the git side.

## Current State (Codebase)

- **A directory-listing route already exists, but it is not a file tree.** `GET /browse?path=` (`host-server/index.ts`, ~L2165) returns one level of **directories only**, skipping dot-names, for the folder picker. It accepts any absolute path or `~`, with no root restriction [S1]. It cannot be reused as-is (no files, no scoping, no gitignore awareness), but it defines the response idiom (`{ path, parent, entries }`) [S1].
- **Agent-scoped git routes already show the right root-resolution pattern.** `GET /agents/:id/diff` picks `entry.worktreePath || entry.workdir`, short-circuits with a null payload when `!isGitRepo(workdir)`, shells out with `spawnSync('git', ['-C', workdir, ...])`, and caps output at 500 KB with a `truncated` flag [S2]. `host-server/git.ts` already exports `isGitRepo`, `getGitRoot`, `detectBaseBranch`, `SHELL_SYNC_TIMEOUT_MS` [S3]. A files route would copy this shape.
- **The UI slot is obvious.** The agent detail view is a `AgentInfoTabs` strip with tabs `terminal | skills | details | queued-tasks | diff | usage | checkpoints`, defined as an array in `AgentList.tsx` (~L851–992) [S5]. `diff` and `checkpoints` are agent-scoped panels that are conditionally `present` — the same mechanism a `files` tab would use [S4][S5].
- **Tab-panel constraint that matters:** `AgentInfoTabs` renders *every present tab's content on every render* and only toggles `hidden`, so a panel that fetches on mount fetches as soon as the detail view opens, not when its tab is selected [S4]. `DiffPanel` already lives with this. For the tree, gate the fetch on the active tab id (already held in `AgentList` state) to avoid pointless requests.
- **Frontend deps are lean:** React 19, react-router, lucide-react (has folder/file icons), dnd-kit, xterm, Tailwind 3. No tree/virtualization library present [S6].
- **Repo scale:** 842 tracked + 75 untracked-unignored files; `git ls-files -co --exclude-standard` finished in ~0.011 s [S8]. A whole-repo flat list is ~tens of KB — small enough to ship in one response and not virtualize.

## Key Findings

1. **Use git as the source of the file list when the workdir is a git repo.** `git ls-files` with `--cached --others --exclude-standard` lists tracked plus untracked-but-not-ignored files and honors `.gitignore`, `.git/info/exclude`, and the global excludes file [S13]. This removes the need to re-implement ignore rules and to special-case `node_modules`, `logs/`, `data/`, `tmp/`, `worktrees/` (all present at this repo's root) [S8]. One community measurement found index-based listing ~50× faster than a filesystem walk on a repo with a 33k-entry deps dir *(single anecdotal source, but consistent with the local 11 ms measurement)* [S15][S8].
2. **Side benefit: secrets stay out.** `.env` is gitignored here, so `--exclude-standard` never emits it — consistent with the project rule that `.env` is never read/exposed (CLAUDE.md). A raw `readdir` walk would list it. *(Inference from `.gitignore` handling in [S13]; verify `.env` is in this repo's `.gitignore` when implementing.)*
3. **Caveats of the git approach** — *(inference, no primary source beyond git's documented flags)*: `-c` reports index entries even if the file was deleted in the working tree (needs `--deleted` subtraction or an existence check); directories are not emitted, so the client derives them from path prefixes (this also means empty directories never appear); git does not follow symlinks when reading `.gitignore` [S14]; and a worktree agent lists its own worktree, which is what we want.
4. **Non-git workdirs need a fallback.** `isGitRepo` already exists [S3]; when false, do a bounded `readdir` walk (depth cap, entry cap, hard-coded skip list `.git`, `node_modules`) and return `truncated: true` if capped — the same cap-and-flag pattern as the diff route [S2].
5. **Library landscape (all three verified against Context7 docs).**
   - **react-arborist** 3.16.0 (npm modified 2026-07-25): full tree component, virtualized, keyboard nav, search (`searchTerm`), custom node renderer, `rowHeight`/`height`/`indent` props; peer `react >= 16.14` [S10][S12]. Ships drag-and-drop/rename/create handlers we don't need. A Reddit commenter reports it is "somewhat painful to customize" and forked it [S17] *(opinion)*.
   - **Headless Tree** (`@headless-tree/*`): framework-agnostic, headless (we render rows with Tailwind), `asyncDataLoaderFeature` for lazy children, documented virtualization recipe, `expandAll`, search, keyboard navigation [S9]. Author states it is the successor to react-complex-tree with better performance and no forced virtualization [S17]. *Not verified:* current npm version and React 19 peer range (the npm query was blocked by a local hook); check at install time.
   - **@pierre/trees** 1.0.0-beta.6 (npm modified 2026-08-22): path-first model — feed it a `paths: string[]` list; built-in Git status decorations, search, `prepareFileTreeInput` for large lists; peer `react ^18.3.1 || ^19.0.0`; explicitly **beta**, API may change [S11][S12]. Its input shape matches the `git ls-files` payload exactly, but beta status and Context7 "Low" reputation make it a risk for a dashboard we maintain alone.
6. **Roll-your-own is viable but costs a11y work.** For ~900 collapsed-by-default paths, virtualization is unnecessary [S8]. The repo already hand-builds a WAI-ARIA tabs widget [S4], so a hand-built ARIA `tree` role is consistent in style, but roving focus, type-ahead, and expand/collapse keys are the fiddly part a headless library gives for free [S9].
7. **Security posture of this server matters more than the tree itself.** Fastify binds `127.0.0.1` by default (`HOST` env) but CORS origin defaults to `*` (`CORS_ORIGIN` env) [S7]. Any web page open in the user's browser can therefore make cross-origin GETs to `localhost:8788` and read the responses. `/browse` already exposes directory names this way [S1]. A names-only file list is a marginal increase; **serving file contents is not** — it would let any visited page read source code and any tracked secret. Also, a route that takes a relative `path` must resolve it and verify it is within the agent's root (with `realpath` to defeat symlink escapes) — *(inference; no existing path-jail helper was found in `host-server`)*.

## Constraints

- Host-server is Fastify + synchronous `spawnSync` git helpers with `SHELL_SYNC_TIMEOUT_MS`; new git calls should use the same helpers and timeout [S2][S3].
- Agents can share a workdir, and worktree-backed agents must use `worktreePath` — the route must be **agent-scoped** (`/agents/:id/files`), not workdir-scoped by client input (project memory: agents-share-workdir; [S2] shows the `worktreePath || workdir` rule).
- Every tab's content mounts up-front [S4]; heavy panels must self-gate.
- CLAUDE.md: `.env` must never be read/exposed; the Serena/`Read` rules apply to implementation work, not to the endpoint design.
- Frontend deps are deliberately minimal [S6]; any new dependency needs justification.
- Dev servers hot-reload and concurrent agents edit files (project memory), so the tree is a snapshot — it needs a manual refresh and/or a cheap re-fetch on tab activation.

## Solution Comparison

| Criteria | A. `git ls-files` flat list + headless lib | B. Lazy per-directory `readdir` (extend `/browse`) | C. `@pierre/trees` with `git ls-files` paths |
|----------|-----------------------------------------|---------------------------------------------------|----------------------------------------------|
| **Approach** | One call returns all paths; client builds the tree | Fetch one directory level on each expand | Same payload as A, rendered by a path-first beta library |
| **Pros** | Respects `.gitignore` for free; ~11 ms; hides `.env`/`node_modules`; one request; trivial caching | Works for any folder, git or not; scales to huge trees | Least glue code; Git status decorations built in |
| **Cons** | Git-only (needs fallback); no empty dirs; deleted-file caveat | Must re-implement ignore rules; many round-trips; lists `.env` unless filtered | Beta API; low-reputation docs; new dep with churn risk |
| **Complexity** | Low–Medium | Medium | Low |
| **Dependencies** | 1 (headless-tree) or 0 (hand-rolled) | 0–1 | 1 (beta) |
| **Codebase fit** | High — mirrors `/agents/:id/diff` + `isGitRepo` | Medium — extends `/browse` idiom but that route is unscoped | High for data shape, medium for maintenance |
| **Maintenance** | Low | Medium (ignore rules drift) | Medium–High until 1.0 |

## Recommendation

**Option A.** Concretely:

1. **Server** — `GET /agents/:id/files` in `host-server/index.ts` beside `/agents/:id/diff`:
   - Resolve root = `entry.worktreePath || entry.workdir`; 404 for unknown agent; `{ paths: null }` if root missing.
   - If `isGitRepo(root)`: `git -C root ls-files -co --exclude-standard -z`, split on `\0`, drop entries that no longer exist, cap at N (e.g. 20k) and set `truncated`.
   - Else: bounded `readdir` walk with depth/entry caps and skip list; same `{ paths, truncated }` shape.
   - Return `{ root, paths, truncated }`. Put the git/walk logic in `host-server/git.ts` (or a new `fileTree.ts`) with unit tests alongside `git.test.ts`.
2. **Client** — `frontend/src/components/FilesPanel.tsx`; `fetchAgentFiles(agentId)` in `lib/api.ts` next to `fetchAgentDiff`; register a `files` entry in the `tabs` array in `AgentList.tsx` (after `diff`). Build a nested structure from the flat paths (directories first, then alpha), collapsed by default, folder/file icons from `lucide-react`, a refresh button, and a filter box. Only fetch when `activeTab === 'files'`.
3. **Library** — try `@headless-tree/react` with the sync data loader over the derived structure (no virtualization needed at this scale; add the documented virtualization recipe only if a workdir exceeds a few thousand visible rows) [S9]. If its React 19 support or ergonomics disappoint, `react-arborist` is the safe fallback [S10][S12]. Start with a ~60-line hand-rolled tree only if the goal is zero new dependencies — accept the ARIA/keyboard work.
4. **Scope v1 to names only.** No click-to-open. Follow-up (separate task): file preview, which requires (a) restricting CORS to the dashboard origin(s), (b) a realpath-jailed `GET /agents/:id/file?path=` with size cap and binary sniffing, (c) an explicit deny-list (`.env*`, key files) even for tracked files.
5. **Optional later:** decorate rows with `git status --porcelain` so the tree doubles as a "what did this agent touch" view (overlaps with the Diff tab; Pierre's Git-status decorations show the pattern [S11]). Add a `GET /projects/:id/files` sharing the same helper if a project-level explorer is wanted.

**Risks & mitigations**
- *Stale tree while agents edit* → re-fetch on tab activation + refresh button; snapshot semantics documented in the UI.
- *Huge non-git dirs* → depth/entry caps with `truncated` banner.
- *Path traversal / symlink escape* → none in v1 (no client-supplied path); mandatory `realpath` jail before adding the content route.
- *CORS `*` exposure* → don't ship content endpoints until origin is restricted [S7].
- *Library churn* → the tree component sits behind `FilesPanel`, so swapping libraries touches one file.

**Alternative if constraints change:** if the requirement becomes "browse any folder on disk" (not just agent roots), extend `/browse` with a `files=1` flag (Option B) — but only after adding a root allowlist. If `@pierre/trees` reaches 1.0 stable, Option C becomes the lowest-code path.

## Next Steps

- To create a task: `/task-add Add Files tab to agent detail view: GET /agents/:id/files (git ls-files, readdir fallback, caps) + FilesPanel tree (headless-tree), names only`
- Separate task/decision: `/decision-create` for "serving file contents from host-server" — CORS restriction, realpath jail, deny-list.
- Quick verification before implementing: confirm `@headless-tree/react` current version and React 19 peer range; confirm `.env` is in `.gitignore`; decide whether the panel should show untracked files (`-o`) — this report assumes yes.
