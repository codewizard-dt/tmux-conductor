---
description: Skip UAT for a task, moving it to completed and archiving/creating a skeleton UAT in skipped
argument-hint: <path/to/task-file.md or task number-slug>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**

# UAT Skip

Skip UAT testing for a task, marking it as completed and moving (or creating) a UAT file in `.docs/uat/skipped/`.

---

**Target**: $ARGUMENTS

---

## Pipeline Context

This command is part of the task lifecycle: `/add-task` → `/tackle` → `/uat-generator` → `/uat-walkthrough`

`/uat-skip` is an **escape hatch** — use it when UAT testing is not needed, not applicable, or intentionally deferred for a task that has completed implementation.

---

## Instructions

### Step 1: Resolve the Task File

Parse `$ARGUMENTS` to locate the task file:

1. **If a file path is provided** (e.g., `.docs/tasks/active/3-user-auth.md`):
   - Confirm the file exists (use Serena `find_file` or `list_dir`)
   - If the file does not exist, STOP and report the error

2. **If a number-slug is provided** (e.g., `3-user-auth`):
   - Search `.docs/tasks/active/` for `<number-slug>.md`
   - If not found, also check `.docs/tasks/active/` as a fallback
   - If still not found, STOP and report the error

3. **If only a description or number is provided**:
   - Search `.docs/tasks/active/` for a matching task file
   - If ambiguous, list matches and ask the user to clarify

4. Extract the task's **number-slug identifier** (e.g., `3-user-auth` from `3-user-auth.md`)

5. **Validate location**: The task file should be in `.docs/tasks/active/`.

### Step 2: Find or Create the UAT File

Using the task's number-slug identifier:

1. **Check for an existing UAT file** in `.docs/uat/pending/` → `<number>-<slug>.uat.md`
2. Also check `.docs/uat/completed/` in case it was already completed (warn if found there)

**If a UAT file exists in `pending/`:**
- It will be moved to `.docs/uat/skipped/` in Step 4

**If no UAT file exists:**
- A skeleton UAT file will be created in `.docs/uat/skipped/` to document the intentional skip. Use this template:

```markdown
# UAT: [Feature Name] (Skipped)

> **Source task**: [`.docs/tasks/completed/<number>-<slug>.md`](../../tasks/completed/<number>-<slug>.md)
> **Skipped**: YYYY-MM-DD
> **Reason**: UAT intentionally skipped — no tests generated

---

## Status

This task's UAT was intentionally skipped via `/uat-skip`. No test cases were generated or executed.
```

### Step 3: Confirm with the User

Before moving anything, present a summary and ask for confirmation inline:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UAT SKIP — Confirm
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task:  .docs/tasks/active/<number>-<slug>.md → .docs/tasks/completed/
UAT:   .docs/uat/pending/<slug>.uat.md → .docs/uat/skipped/
       (or: No existing UAT — skeleton will be created in skipped/)

Proceed? (Yes/No)
```

If the user says **No**, STOP.

### Step 4: Move and Create Files

1. **Ensure target directories exist**:
   - `.docs/uat/skipped/` — create if it does not exist
   - `.docs/tasks/completed/` — should already exist

2. **Move the task file** to completed:
   - `git mv .docs/tasks/active/<number>-<slug>.md .docs/tasks/completed/<number>-<slug>.md`
   - Fall back to `mv` if `git mv` fails

3. **Handle the UAT file**:
   - **If UAT exists in `pending/`**: `git mv .docs/uat/pending/<number>-<slug>.uat.md .docs/uat/skipped/<number>-<slug>.uat.md` (fall back to `mv`)
   - **If no UAT exists**: Create the skeleton file directly in `.docs/uat/skipped/<number>-<slug>.uat.md` using the template from Step 2

### Step 5: Update References

1. **Update the task file** (now in `completed/`) using the **`Edit`** tool. **Never** use `sed`, `echo >>`, or any other shell command for these edits. See `.docs/guides/mcp-tools.md` "Common anti-patterns".
   - If it contains a UAT reference pointing to `pending/`, `Edit` to update the path to `skipped/`
   - If it has no UAT reference, `Read` the file then `Edit` to append:
     ```markdown
     ---
     **UAT**: [`.docs/uat/skipped/<number>-<slug>.uat.md`](../../uat/skipped/<number>-<slug>.uat.md) *(skipped)*
     ```

2. **Update the UAT file** (now in `skipped/`):
   - If the `Source task` link points to `active/`, update it to `completed/`

3. **Search for other references** using Serena's `search_for_pattern`:
   - Look for references to the old task path (`active/<number>-<slug>.md`) across `.docs/`
   - Update any found references to the new `completed/` path

### Step 6: Delete Related Screenshots

If any screenshots exist for this task in `.docs/uat/screenshots/`:
- Delete them: `git rm .docs/uat/screenshots/<task-number>-*` (fall back to `rm` if `git rm` fails)
- If no screenshots exist, skip silently

### Step 7: Report Completion

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UAT SKIP COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task:  .docs/tasks/active/<number>-<slug>.md → .docs/tasks/completed/<number>-<slug>.md
UAT:   .docs/uat/pending/<slug>.uat.md → .docs/uat/skipped/<slug>.uat.md
       (or: Skeleton created at .docs/uat/skipped/<slug>.uat.md)

References updated: [list files modified]
Screenshots deleted: [count or "None"]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Directory Structure

```
.docs/tasks/
├── active/           # Tasks being implemented via /tackle, or awaiting UAT testing
├── completed/        # UAT passed (or skipped), task fully complete
└── trashed/          # Discarded tasks

.docs/uat/
├── pending/          # Generated UATs, not yet walked through
├── completed/        # All tests passed via /uat-walkthrough
├── skipped/          # UAT intentionally skipped via /uat-skip
└── screenshots/      # Temporary screenshots from /uat-walkthrough
```

**Task lifecycle**: `active/` → (`/tackle`, stays in `active/`) → (`/uat-walkthrough` | **`/uat-skip`**) → `completed/`

---

## Naming Convention

| Source | UAT File Path |
|--------|--------------|
| Task `.docs/tasks/active/3-user-auth.md` | `.docs/uat/skipped/3-user-auth.uat.md` |
| Task `.docs/tasks/active/12-api-refactor.md` | `.docs/uat/skipped/12-api-refactor.uat.md` |

The `<number>` prefix ensures UAT files sort alongside their tasks and are easy to cross-reference.
