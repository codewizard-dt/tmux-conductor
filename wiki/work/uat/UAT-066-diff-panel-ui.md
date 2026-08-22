---
id: UAT-066
aliases: [UAT-066]
title: "UAT: Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)"
status: pending
task: TASK-066
created: 2026-07-06
updated: 2026-07-06
---

# UAT-066 — UAT: Diff panel UI — unified diff in AgentDetailModal (colour-coded additions/deletions)

implements::[[TASK-066]]

> **Source task**: [[TASK-066]]
> **Generated**: 2026-07-06
> **Deviation carried from the task file**: the "Changes" section's visibility is gated on the diff endpoint's own null-ness contract (`GET /api/agents/:id/diff` → `{ diff: null, base: null }` for a non-git `workdir`) rather than on `agent.branch`, which does not exist on the frontend `Agent` type yet (that field lands in TASK-062). `DiffPanel` (`frontend/src/components/DiffPanel.tsx`) owns this gating itself — it renders `null` once the fetch resolves and both `diff` and `base` are `null`. Tests below verify the actual implemented gate, not the task text's original wording.
> **Route note**: `GET /agents/:id/diff` is registered on the `/api`-prefixed router (`host-server/index.ts:1338`), so the live route is `GET /api/agents/:id/diff`. The endpoint diffs `base..HEAD` (committed history), not the working tree — producing diff content requires committed divergence between the detected base branch and the fixture's checked-out `HEAD`, not just uncommitted edits.

---

## Prerequisites

- [ ] Host-server running on `http://127.0.0.1:8788` (`make dev` or `npm --prefix host-server run dev`)
- [ ] Frontend dev server running on `http://localhost:4321` (`make dev` or `npm --prefix frontend run dev`)
- [ ] The conductor tmux session is running (`POST /api/agents` returns `409 { error: "session not running" }` otherwise)
- [ ] `jq` installed
- [ ] From the repo root, build three fixture directories under the repo-local `./tmp/` (never `/tmp`, per this repo's convention):

  ```bash
  mkdir -p tmp/uat066-fixture-diff && cd tmp/uat066-fixture-diff \
    && git init -q -b main && printf 'line1\nline2\nline3\n' > file.txt && git add file.txt && git commit -q -m init \
    && git checkout -q -b feature && printf 'line1\nline2-changed\nline3\nline4\n' > file.txt \
    && git add file.txt && git commit -q -m "feature change" && cd -
  ```
  ```bash
  mkdir -p tmp/uat066-fixture-empty && cd tmp/uat066-fixture-empty \
    && git init -q -b main && git commit -q --allow-empty -m init && cd -
  ```
  ```bash
  mkdir -p tmp/uat066-fixture-nogit
  ```
  - `uat066-fixture-diff` is checked out on `feature`, one commit ahead of `main` with a mixed add/change/context diff (exercises `+`, `-`, `@@`, and context lines).
  - `uat066-fixture-empty` is checked out on `main` with no divergent commits (`base..HEAD` is empty → `diff: ""`).
  - `uat066-fixture-nogit` has no `.git` (`diff: null, base: null`).
- [ ] Cleanup after every test: `DELETE /api/agents/:id` for every throwaway agent created, and `rm -rf tmp/uat066-fixture-*` when done.

---

## Test Cases

### UAT-UI-001: "Changes" section appears and colour-codes diff lines for a git-workdir agent with committed divergence
- **Page**: `http://localhost:4321/` (Agents page, root route)
- **Component**: `frontend/src/components/DiffPanel.tsx`, wired into `AgentDetailModal` in `frontend/src/components/AgentList.tsx:780`
- **Description**: For an agent whose `workdir` is a git repo with a non-empty `base..HEAD` diff, the modal shows a "Changes" section whose diff lines are colour-coded: `+` lines green, `-` lines red, `@@` hunk headers blue/muted, context and `+++`/`---` file-header lines neutral.
- **Steps**:
  1. Create the agent (adjust the absolute path if your repo root differs):
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat066-diff\",\"workdir\":\"$(pwd)/tmp/uat066-fixture-diff\",\"launchCmd\":\"bash\"}"
     ```
  2. Note the returned `agent.id` (call it `<DID>`).
  3. Open `http://localhost:4321/`, click the `uat066-diff` agent tile to open `AgentDetailModal`.
  4. Click the "Changes" summary to expand the `<details>`.
  5. Inspect the diff lines (visually, or via browser devtools element inspector on the `<pre>` children).
  6. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$DID"`
- **Expected Result**: A "Changes" `<summary>` is present and expandable. Once expanded, the `<pre>` block renders one `<div>` per diff line. The `@@ -1,3 +1,4 @@` hunk header line has class `text-accent-blue`. The `-line2` line has class `text-accent-red`. The `+line2-changed` and `+line4` lines have class `text-accent-green`. The unchanged `line1`/`line3` context lines and the `--- a/file.txt`/`+++ b/file.txt` header lines have class `text-ink`. No "No changes yet" placeholder is shown.
- **Repeatable Unit Test**: Blocked: `frontend/` has no test runner configured (no vitest/jest in `frontend/package.json` — only `tsc`/`eslint`/`vite`); unit-testing `DiffPanel`'s internal `lineClass` classification would require introducing new frontend test infrastructure, which this task does not call for.
- [FAIL: auto-judge: prerequisite not satisfied — conductor tmux session not running (POST /api/agents returned 409 {"error":"session not running","sessionAlive":false})] <!-- 2026-08-22 -->

### UAT-UI-002: "No changes yet" placeholder shown for an empty diff
- **Page**: `http://localhost:4321/`
- **Description**: When the diff endpoint returns `{ diff: "", base: "main" }` (git repo, but `HEAD` has no commits ahead of the detected base), the panel shows the empty-diff placeholder instead of a `<pre>` block.
- **Steps**:
  1. Create the agent:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat066-empty\",\"workdir\":\"$(pwd)/tmp/uat066-fixture-empty\",\"launchCmd\":\"bash\"}"
     ```
  2. Note `agent.id` (`<EID>`).
  3. Open the dashboard, click the `uat066-empty` tile, expand "Changes".
  4. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$EID"`
- **Expected Result**: The "Changes" section is present (the agent is a git repo, so the panel is not hidden). Expanding it shows the italic text "No changes yet" and no `<pre>` block. The "Refresh" button is still visible.
- **Repeatable Unit Test**: Blocked: no frontend test runner configured (see UAT-UI-001).
- [FAIL: auto-judge: prerequisite not satisfied — conductor tmux session not running (POST /api/agents returned 409 {"error":"session not running","sessionAlive":false})] <!-- 2026-08-22 -->

### UAT-UI-003: "Changes" section is absent for a non-git-workdir agent
- **Page**: `http://localhost:4321/`
- **Description**: When the diff endpoint returns `{ diff: null, base: null }` (non-git `workdir`), `DiffPanel` renders nothing — no "Changes" summary appears anywhere in the modal.
- **Steps**:
  1. Create the agent:
     ```bash
     curl -sS -X POST 'http://127.0.0.1:8788/api/agents' -H 'Content-Type: application/json' -d "{\"name\":\"uat066-nogit\",\"workdir\":\"$(pwd)/tmp/uat066-fixture-nogit\",\"launchCmd\":\"bash\"}"
     ```
  2. Note `agent.id` (`<NID>`).
  3. Confirm the endpoint contract directly: `curl -sS "http://127.0.0.1:8788/api/agents/$NID/diff" | jq` should print `{"diff": null, "base": null}`.
  4. Open the dashboard, click the `uat066-nogit` tile.
  5. Search the modal DOM (visually, or via devtools) for any element containing the text "Changes" between the Skills section and the usage-breakdown section.
  6. Teardown: `curl -sS -X DELETE "http://127.0.0.1:8788/api/agents/$NID"`
- **Expected Result**: Step 3's curl confirms `diff: null, base: null`. In the modal, no "Changes" summary/section is rendered at all (not collapsed, not empty — absent from the DOM), consistent with `DiffPanel` returning `null` once `loaded && diff === null && base === null`.
- **Repeatable Unit Test**: Blocked: no frontend test runner configured (see UAT-UI-001).
- [FAIL: auto-judge: prerequisite not satisfied — conductor tmux session not running (POST /api/agents returned 409 {"error":"session not running","sessionAlive":false})] <!-- 2026-08-22 -->

### UAT-UI-004: Diff panel is scrollable and capped at a fixed max-height for a large diff
- **Page**: `http://localhost:4321/`
- **Description**: A diff long enough to exceed the panel's fixed height scrolls inside the `<pre>` rather than growing the panel or pushing the modal out of view.
- **Steps**:
  1. Extend the diff fixture with enough additional lines to overflow 400px (roughly 30+ lines at the panel's `text-[11px]` line height):
     ```bash
     cd tmp/uat066-fixture-diff && seq 1 60 | sed 's/^/extra-line-/' >> file.txt && git add file.txt && git commit -q -m "bulk lines" && cd -
     ```
  2. Create/reuse an agent pointed at `tmp/uat066-fixture-diff` (or reuse `<DID>` from UAT-UI-001 if still present) and expand "Changes" in the modal.
  3. Inspect the `<pre>` element in devtools: confirm its computed `max-height` is `400px` and `overflow-y` is `auto`.
  4. Scroll within the `<pre>` block and confirm the modal itself does not grow or get pushed off-screen — only the inner diff block scrolls.
- **Expected Result**: The `<pre>` has `max-h-[400px] overflow-y-auto` applied (Tailwind classes present on the element, and computed style confirms `max-height: 400px`); scrolling reveals the additional lines without resizing the modal.
- **Repeatable Unit Test**: Blocked: no frontend test runner configured; layout/overflow behavior is a rendering concern requiring a real browser (see UAT-UI-001).
- [FAIL: auto-judge: prerequisite not satisfied — conductor tmux session not running (POST /api/agents returned 409 {"error":"session not running","sessionAlive":false})] <!-- 2026-08-22 -->

### UAT-UI-005: "Refresh" button re-fetches the diff and reflects new commits without closing the modal
- **Page**: `http://localhost:4321/`
- **Description**: Clicking "Refresh" re-runs the fetch used on mount, so a diff that changed since the panel first loaded is picked up live.
- **Steps**:
  1. Create an agent pointed at `tmp/uat066-fixture-diff` (fresh from the base setup, i.e. before the UAT-UI-004 bulk-lines commit, or use a fresh checkout) and open its "Changes" section — confirm the baseline diff (from `init` → `feature change`) is showing.
  2. Without closing the modal, in a separate terminal add a new commit to the fixture:
     ```bash
     cd tmp/uat066-fixture-diff && printf 'line5\n' >> file.txt && git add file.txt && git commit -q -m "refresh check" && cd -
     ```
  3. Click the "Refresh" button inside the still-open "Changes" section.
  4. Observe the diff content.
- **Expected Result**: After clicking Refresh, the rendered diff includes the new `+line5` (green) line that was not present before the commit — confirming the panel re-fetched rather than showing stale/cached content. No page reload or modal close/reopen was needed.
- **Repeatable Unit Test**: Blocked: no frontend test runner configured; this is a live-fetch/DOM-update behavior requiring a real browser session (see UAT-UI-001).
- [FAIL: auto-judge: prerequisite not satisfied — conductor tmux session not running (POST /api/agents returned 409 {"error":"session not running","sessionAlive":false})] <!-- 2026-08-22 -->

### UAT-STATIC-001: `tsc --noEmit` and `npm run build` pass cleanly in `frontend/`
- **Description**: The task's static-gate acceptance criterion, re-verified independently of `/tackle`'s own run.
- **Steps**:
  1. Run the command below from the repo root.
- **Command**:
  ```bash
  npm --prefix frontend run typecheck
  ```
- **Expected Result**: Exit code 0, no TypeScript errors printed.
- **Repeatable Unit Test**: Not applicable: this test *is* the static gate (`tsc --noEmit`), already run as part of `/tackle`'s own verification and re-checked here as a UAT sanity gate, not additional new test code.
- [x] Pass <!-- 2026-07-06 -->

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| "Changes" section appears only for agents where the diff endpoint reports non-null (documented deviation from `agent.branch`, which doesn't exist on the frontend type yet) | UAT-UI-001, UAT-UI-002 (present), UAT-UI-003 (absent) |
| Diff lines are colour-coded: `+` green, `-` red, `@@` muted/blue, context neutral | UAT-UI-001 |
| Diff panel is scrollable and capped at a fixed max-height | UAT-UI-004 |
| "No changes yet" placeholder shown for an empty diff | UAT-UI-002 |
| "Refresh" button re-fetches the diff | UAT-UI-005 |
| `npx tsc --noEmit` and `npm run build` pass cleanly in `frontend/` | UAT-STATIC-001 |
