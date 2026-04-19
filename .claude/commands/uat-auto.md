---
description: Non-interactively run every test in a pending UAT file and auto-judge verdicts with no human prompts
argument-hint: <path/to/uat-file.md, number-slug, or description>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**


# UAT Auto

Headless variant of `/uat-walkthrough`. Runs every test in a pending UAT file, auto-judges pass/fail from deterministic evidence, writes results, and moves files on completion — with **zero user prompts**.

---

**UAT File**: $ARGUMENTS

---

## When to Use

Use `/uat-auto` when there is no human at the keyboard — for example, when a headless orchestrator (e.g. a tmux-based multi-agent conductor, a CI job, or a scheduled run) dispatches UAT work. Use `/uat-walkthrough` for anything interactive.

`/uat-auto` slots into the same task lifecycle:

```
/add-task → /tackle → /uat-generator → /uat-auto (headless)   ─┐
                                     → /uat-walkthrough (human)─┴→ completed/
```

Both walkthrough commands produce identical file-movement outcomes — only the decision procedure differs.

---

## Prime Directive: Fail Closed

**The agent never auto-passes a test it cannot verify with hard evidence.** Pass requires a machine-checkable match. On any doubt, uncertainty, or missing evidence, record `[FAIL: auto-judge: <reason>]`. **Never** `[SKIP]` — skip is a human judgment, not an agent judgment. **Never** `[x] Pass` unless the pass criteria below are met exactly.

This is the single most important rule in this command. A false pass is worse than a false fail: a false fail gets re-triaged by a human in the next `/uat-walkthrough`, whereas a false pass ships a broken feature.

---

## Step 1: Resolve and Parse the UAT File

Parse `$ARGUMENTS` to locate the UAT file (same resolver as `/uat-walkthrough`):

1. **File path** (e.g. `.docs/uat/pending/3-user-auth.uat.md`) — use directly
2. **Number-slug** (e.g. `3-user-auth`) — search `.docs/uat/pending/`, fall back to `.docs/uat/completed/`
3. **Number or description** (e.g. `3`, `user auth`) — search `.docs/uat/pending/` for a match. If ambiguous, **STOP** and report the ambiguity in the completion summary (do not prompt)

If the file does not exist, is empty, or is not in `.docs/uat/pending/`, **STOP** and exit with an explanatory summary.

Parse the file:
- **Test sections**: `### UAT-*` headings (e.g. `UAT-API-001:`, `UAT-UI-002:`)
- **Prerequisites**: items under `## Prerequisites`
- **Existing statuses**: `- [ ] Pass`, `- [x] Pass`, `- [FAIL: ...]`, `- [FIXING: ...]`, `- [SKIP: ...]`
- Count totals per status

If every test is already resolved (no `- [ ] Pass`, no `[FAIL]`, no `[FIXING]`), skip to **Step 6** (file-movement).

---

## Step 2: Verify Prerequisites (Non-Interactively)

For each prerequisite in the UAT file:

- If the prerequisite is a **runnable check** (e.g. "server running at localhost:4321", "database migrated"), attempt to verify it with a single deterministic command (a `curl`, a `pg_isready`, a file existence check). One Bash call per prerequisite.
- If the prerequisite is **descriptive only** (e.g. "test data loaded"), treat it as **unverifiable** and record a note. Do not assume it is satisfied.
- If any prerequisite fails or is unverifiable, **abort the entire walkthrough** with `[FAIL: auto-judge: prerequisite not satisfied — <which>]` on every untested test. Proceed to Step 6 reporting.

**Note:** Auth prerequisites (login state, bearer tokens, session cookies, test-user credentials) are handled by the new **Step 2.5: Auth Detection and Setup** below and must **not** cause abort at Step 2. Skip auth-related prerequisites here and let Step 2.5 resolve them.

Prerequisites are a hard gate. A single unverifiable prerequisite fails the run.

---

## Step 2.5: Auth Detection and Setup

Scan each eligible test (pending + previously-failed) for any of these auth signals:

1. Literal `Authorization:` header in the test's `**Command**:` block
2. Literal `Bearer` token reference in Expected or Command sections
3. `Auth-Required: true` metadata field in the test's metadata block
4. `Page:` URL matching a configured auth-gated route prefix (read from `CLAUDE.md` if present; otherwise skip this signal)

If any eligible test matches → invoke `/uat-auth` with role inferred from test metadata (`Auth-Role: guest` → `--role=guest`, default `user`) and `--inject-cookie` when any UI test is eligible.

If `/uat-auth` exits non-zero → mark every auth-gated test `[FAIL: auto-judge: auth setup failed — <reason>]` and proceed to remaining non-auth tests normally.

If no eligible test matches auth signals → skip Step 2.5 entirely, do not invoke `/uat-auth`.

---

## Step 3: Classify Tests

Classify each untested and failed-but-scoped test (see Mode below):

- **API/CLI test** — contains `curl`, `http`, `wget`, or a shell-command code block in Steps/Expected, OR has an `Endpoint:` metadata field
- **UI test** — has `UAT-UI-*` prefix, or has `Page:` / `Components:` metadata
- **Manual test** — anything else

### Mode

Unlike `/uat-walkthrough`, there is no mode prompt. The default is **"pending + previously-failed"**: every test with `- [ ] Pass` or `[FAIL: ...]` is eligible. Reset `[FAIL: ...]` to `- [ ] Pass` before running so a fresh verdict is recorded. Leave `[x] Pass` and `[SKIP: ...]` untouched.

---

## Step 4: Execute and Auto-Judge, Per Type

Work through eligible tests in document order. Update the file immediately after each verdict (see Step 5).

### 4A — API/CLI Tests

Extract the command from the test's `**Command**:` block (written by `/uat-generator`). If no extractable command exists, record `[FAIL: auto-judge: no machine-executable command in test body]` and move on.

**One Bash call per test.** Run the command as-is. No `&&`, no `;`, no `echo` banners, no `-o /tmp/...` indirection, no multi-statement shells. Same forbidden-patterns rules as `/uat-walkthrough` Step 3A — a single clean `curl -sS`, optionally piped into one `jq` stage. If the generated command contains forbidden patterns, rewrite it to the clean form before executing.

**Pass criteria (ALL must be true):**

1. The command exited successfully (curl returned a response; no connection error).
2. The HTTP status code matches the Expected section's explicit status (e.g. "HTTP 201"). If no status is specified, treat any 2xx as pass-eligible on status alone.
3. The response body satisfies **every** machine-checkable assertion in the Expected section. Machine-checkable means: literal string presence, JSON key presence, JSON value equality, array length, or type-of checks. Use `jq` or direct substring matching.
4. If the test references `$UAT_AUTH_TOKEN`, the token must be present in the environment (set by Step 2.5). If not present, record `[FAIL: auto-judge: auth token missing]`.

If any criterion fails → `[FAIL: auto-judge: <which criterion, with actual vs expected>]`.
If the Expected section contains no machine-checkable assertions at all → `[FAIL: auto-judge: expected section not machine-verifiable]`.

### 4B — UI Tests

Launch Puppeteer once, on the first UI test, with headless desktop viewport (1600×950). Reuse it for all subsequent UI tests. Close it at the end of the run.

**Pass criteria (ALL must be true):**

1. `puppeteer_navigate` to the test's `Page:` URL succeeds (no navigation error, no 4xx/5xx response).
2. The Expected section contains at least one selector-based or text-based assertion that `puppeteer_evaluate` or `puppeteer_get_text` can verify (e.g. "element `.panel-empty` is visible", "heading contains 'No strengths yet'").
3. Every such assertion returns the expected value.

On fail, screenshot the broken state to `.docs/uat/screenshots/<task-number>-<UAT-ID>-fail.png` before recording the verdict. Task number comes from the UAT filename's `<number>-<slug>.uat.md` prefix.

If the Expected section is purely visual ("panel looks right", "no overflow") with no scriptable check → `[FAIL: auto-judge: expected section requires human visual inspection]`. Screenshot anyway so the next human walkthrough has context.

### 4C — Manual Tests

Manual tests (edge cases, concurrency, integration scenarios) are **always** recorded as `[FAIL: auto-judge: manual test requires human verification]`. Do not attempt to execute or heuristically evaluate them. This is intentional fail-closed behavior — if `/uat-generator` produced a manual test, it expected a human.

---

## Step 5: Update the File Per Verdict

Use the **`Edit`** tool — one `Edit` call per status line. **Never** `sed`, `awk`, `perl -i`, or `echo`, even when many tests flip in a row. See `.docs/guides/mcp-tools.md` "Common anti-patterns".

Append the current date in the trailing HTML comment (ISO format, `YYYY-MM-DD`).

**Status line formats:**

```markdown
Pass:    - [x] Pass <!-- 2026-04-13 -->
Fail:    - [FAIL: auto-judge: HTTP 500 expected 201] <!-- 2026-04-13 -->
```

Only the status line changes. Never rewrite or reformat any other part of the test block. Preserve all metadata, headings, and whitespace exactly.

---

## Step 6: Completion and File Movement

After every eligible test has a non-blocking status (`[x] Pass`, `[SKIP: ...]` already-present, or `[FAIL: ...]`), decide outcome:

### All Pass (no `[FAIL]` or `[FIXING]` markers remain)

1. Cleanup auth state: run `unset UAT_AUTH_TOKEN UAT_TEST_EMAIL UAT_TEST_PASSWORD UAT_SESSION_COOKIE; rm -f /tmp/uat-auth-*.jar /tmp/uat-auth-*.json` regardless of outcome.
2. Move the UAT file: `git mv .docs/uat/pending/<slug>.uat.md .docs/uat/completed/<slug>.uat.md` (fall back to `mv` if `git mv` fails).
3. Move the associated task file: derive from UAT name (`<number>-<slug>.uat.md` → `<number>-<slug>.md`), then `git mv .docs/tasks/active/<number>-<slug>.md .docs/tasks/completed/<number>-<slug>.md` (fall back to `mv`).
4. Update internal path references in both moved files (`active/` → `completed/` in the task, `pending/` → `completed/` in the UAT's source-task link).
5. Delete screenshots for this task: use `mcp__serena__list_dir` on `.docs/uat/screenshots/` to find files matching `<task-number>-*` — **never** `ls` — then `git rm` each (or `rm` if untracked).
6. Close Puppeteer: `puppeteer_close_browser` if it was launched.
7. Run `/update-docs` to refresh project documentation.
8. Emit the completion summary (see below).

### Any Fail (`[FAIL: ...]` markers remain)

1. Cleanup auth state: run `unset UAT_AUTH_TOKEN UAT_TEST_EMAIL UAT_TEST_PASSWORD UAT_SESSION_COOKIE; rm -f /tmp/uat-auth-*.jar /tmp/uat-auth-*.json` regardless of outcome.
2. **Leave the UAT file in `pending/`** — it is not complete.
3. **Keep screenshots** — they are diagnostic evidence for the next human walkthrough.
4. Close Puppeteer if launched.
5. Emit the completion summary.
6. Exit 0 — a headless orchestrator treats `/uat-auto` exiting as the task being done from its perspective; the UAT pipeline itself decides what to do with the fail markers.

### Summary Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UAT AUTO COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
File:    .docs/uat/pending/5-positions.uat.md
Source:  .docs/tasks/active/5-positions.md
Mode:    headless

Results:
  ✓ Passed:       6
  ⊘ Skipped:      1  (pre-existing, untouched)
  ✗ Failed:       2
    of which auto-judge-uncertain:  1
  - Pending:      0
  Total:          9

Failed Tests:
  • UAT-API-003: Delete Position — "auto-judge: HTTP 500 expected 204"
  • UAT-EDGE-001: Empty Positions — "auto-judge: manual test requires human verification"

Next action:
  /uat-walkthrough .docs/uat/pending/5-positions.uat.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

On all-pass, replace `Next action` with `Moved to completed/` and the new paths.

---

## Important Rules

### No User Interaction
- **No `AskUserQuestion`** — ever. If an ambiguity arises, record fail and exit.
- **No inline prompts** — no `Pass / Fail / Skip?` text to the user. The summary at the end is the only output the user reads.
- **No clarifying questions** on the UAT file path. Ambiguous input → exit with a diagnostic summary.

### No Fix Workflow
- This command **does not** delegate fixes. It records evidence and exits. Re-run `/uat-walkthrough` to triage and fix.
- `[FIXING: ...]` markers found in the input file are reset to `- [ ] Pass` and re-evaluated (a `/uat-walkthrough` session may have been interrupted mid-fix).

### Verdict Discipline
- `[x] Pass` only on concrete machine-verified evidence (Step 4 criteria).
- `[FAIL: auto-judge: <reason>]` for anything else, including uncertainty, missing commands, non-verifiable expected sections, and manual tests.
- **Never** write `[SKIP: ...]` — skip is a human verdict.

### File Integrity
- Only modify status lines via `Edit`. Never rewrite other parts of the UAT file.
- Preserve all headings, metadata, whitespace.

### Bash Hygiene (API/CLI Tests)
- One `curl` per Bash call, optionally with one `jq` pipe stage. Nothing else.
- No `&&`, `;`, `echo` banners, output redirection, temp files, defensive flags, or multi-line line-continuations.
- Rewrite any generated command that violates these rules before executing.

### Puppeteer Lifecycle
- Launch once on the first UI test, headless desktop viewport (1600×950).
- Reuse across all UI tests.
- Always close at end of run (`puppeteer_close_browser`), whether all-pass, any-fail, or aborted.

### MCP Tool Compliance
- Use Serena for every directory listing and file search (e.g. screenshots cleanup).
- Use the `Edit` tool for every status-line flip.
- No `sed`, `awk`, `ls`, `find`, `grep`, `cat` on any file. See `.docs/guides/mcp-tools.md`.
- Credentials are governed by `/uat-auth` — never emit literal password values in any Bash call, thinking block, or text output. Only `"$UAT_AUTH_TOKEN"` and `"$UAT_TEST_PASSWORD"` env-var references are permitted.

---

## Begin Auto-Walkthrough

Now start:

1. Resolve the UAT file from `$ARGUMENTS` (Step 1).
2. Verify prerequisites (Step 2). Abort on failure.
3. Classify and execute each eligible test in document order (Steps 3, 4).
4. Update the file after each verdict (Step 5).
5. On completion, move files if all pass, keep in pending if any fail, emit summary (Step 6).

**Start now — resolve the UAT file and begin.**
