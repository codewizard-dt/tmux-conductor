---
description: Move a task and its related UAT files to trashed directories
argument-hint: <path/to/task-file.md>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**

# Trash Task

Move a task file (and any related UAT files) to their respective `trashed/` directories, then update all references.

---

**Task File**: $ARGUMENTS

---

## Instructions

### Step 1: Resolve the Task File

Parse `$ARGUMENTS` to locate the task file:

1. **If a file path is provided** (e.g., `.docs/tasks/active/3-user-auth.md`):
   - Confirm the file exists (use Serena `find_file` or `list_dir`)
   - If the file does not exist, STOP and report the error

2. **If a number-slug is provided** (e.g., `3-user-auth`):
   - Search `.docs/tasks/active/` for `<number-slug>.md`
   - If not found, check `.docs/tasks/completed/`
   - If still not found, STOP and report the error

3. **If only a description or number is provided** (e.g., `user auth` or `3`):
   - Search `.docs/tasks/active/` and `.docs/tasks/completed/` for a matching task file
   - If ambiguous, list matches and ask the user to clarify
   - If no match found, STOP and report the error

4. Determine which directory the task currently lives in (`active/` or `completed/`)
5. Extract the task's **number-slug identifier** (e.g., `3-user-auth` from `3-user-auth.md`)

### Step 2: Find Related UAT Files

Using the task's number-slug identifier, search for matching UAT files:

1. Check `.docs/uat/pending/` for `<number>-<slug>.uat.md`
2. Check `.docs/uat/completed/` for `<number>-<slug>.uat.md`
3. Collect all matches — there may be zero, one, or multiple related UAT files

### Step 3: Confirm with the User

Before moving anything, use `AskUserQuestion` to confirm. Show:

- **Task file** to be trashed: `$ARGUMENTS`
- **UAT file(s)** to be trashed (list each, or "None found")
- Ask: **"Move these files to trashed? (Yes/No)"**

If the user says **No**, STOP.

### Step 4: Move Files

1. **Move the task file**:
   - Use `git mv <source> .docs/tasks/trashed/<filename>` (fall back to `mv` if `git mv` fails)

2. **Move related UAT files** (if any):
   - Use `git mv <source> .docs/uat/trashed/<filename>` for each (fall back to `mv` if `git mv` fails)

### Step 5: Update References

Search for and update any references to the moved files across the project:

1. Use Serena's `search_for_pattern` to find all references to the trashed task filename and UAT filename(s) across:
   - `.docs/tasks/README.md` (task index)
   - `PROJECT_STATUS.md`
   - Other task files that may cross-reference this task
   - Any UAT files that reference the task

2. For each reference found:
   - If in an index or status file: **remove the line** or update the path to reflect the new `trashed/` location
   - If in another task/UAT file's `Source task` or `UAT` link: **update the path** to `trashed/`

3. Use the **`Edit`** tool to make the updates — one `Edit` call per replacement. **Never** use `sed`, `awk`, or `perl -i` to bulk-rewrite paths across files, even when many references need updating. See `.docs/guides/mcp-tools.md` "Common anti-patterns".

### Step 6: Report Completion

Report what was done:

- Task file moved: `<old path>` → `.docs/tasks/trashed/<filename>`
- UAT file(s) moved: `<old path>` → `.docs/uat/trashed/<filename>` (or "None")
- References updated: list each file that was modified

Suggest next steps:
```
To undo, move files back:  git mv .docs/tasks/trashed/<filename> <original-directory>/
To permanently delete:     rm .docs/tasks/trashed/<filename>
```
