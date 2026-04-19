---
description: Tackle an outlined task file step-by-step
argument-hint: <path/to/task.md, number-slug, or description>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**

# Tackle Outline

Execute a pre-planned task file step-by-step. The task file IS the plan — no re-planning needed. Each step section specifies its agent type via `<!-- agent: TYPE -->` annotation. This command reads, executes, and updates.

---

**Outline File**: $ARGUMENTS

---

## Step 0: Resolve the Task File

Parse `$ARGUMENTS` to locate the task file:

1. **If a file path is provided** (e.g., `.docs/tasks/active/3-user-auth.md`):
   - Confirm the file exists (use Serena `find_file` or `list_dir`)
   - If the file does not exist, fall through to case 4

2. **If a number-slug is provided** (e.g., `3-user-auth`):
   - Search `.docs/tasks/active/` for `<number-slug>.md`
   - If not found, fall through to case 4

3. **If only a description or number is provided** (e.g., `user auth` or `3`):
   - Search `.docs/tasks/active/` for a matching task file
   - If ambiguous, list matches and ask the user to clarify
   - If no match found, fall through to case 4

4. **If `$ARGUMENTS` is empty OR the input above did not resolve to a task file** — auto-pick the most important active task:
   - Use `mcp__serena__list_dir` on `.docs/tasks/active/` to enumerate all `*.md` task files (exclude `README.md`)
   - If no active tasks exist, STOP and report "No active tasks to tackle"
   - Read each candidate task file (use `Read` — these are markdown) to assess its `## Objective`, overall checkbox progress, and any blocking/failure markers
   - Pick the next task using this priority order (highest first):
     1. **In-progress tasks** — any task with at least one `[x]` checkbox but not all complete (continue existing work before starting new)
     2. **Unblock-able tasks** — tasks with `[BLOCKED: ...]` or `[FAILED: ...]` markers whose blocker is plausibly resolvable now (skip if the blocker is clearly still outstanding)
     3. **Lowest-numbered fully-pending task** — as the stable tiebreaker, the task with the lowest `<NNN>` prefix whose checkboxes are all `[ ]`
   - Before beginning, announce the auto-pick to the user in one line: `No matching task — tackling \`<NNN>-<slug>.md\` (<reason>, <X>/<Y> steps complete)`. Do not prompt for confirmation; proceed.
   - If `$ARGUMENTS` was non-empty but unresolved, prefix the announcement with `Input \`<arguments>\` did not match — ` so the user sees why auto-pick fired.

Use the resolved file path as the outline for all subsequent steps.

---

IMPORTANT: Adhere to all rules in '.docs/guides/mcp-tools.md'

## MANDATORY: MCP Serena for All Code Operations

All sub-agents delegated from this command **MUST** use MCP Serena tools for code exploration and editing. This is non-negotiable.

| Operation | MUST Use | NEVER Use |
|-----------|----------|-----------|
| Explore code structure | Serena `get_symbols_overview` | `Read` on code files |
| Find function/class | Serena `find_symbol` | `Grep` on code files |
| Edit code | Serena symbolic or file/line tools | Standard `Edit` on code files |
| Search code | Serena `search_for_pattern` | `Grep` |
| Find files | Serena `find_file`, `list_dir` | `Glob`, `find` |
| Library docs | Context7 MCP | `WebSearch` / `WebFetch` |

**Exceptions** — standard Read/Edit/Write tools are permitted for markdown and config files (JSON, YAML, `.env`). Code files must use Serena. File/directory exploration must always use Serena tools (`list_dir`, `find_file`, `search_for_pattern`) — never `bash` commands like `ls`, `cat`, `find`, `grep`, or `sed`.

Every sub-agent prompt **MUST** include this instruction:
> "Use Serena for all code exploration and editing, and for all file/directory exploration of any type. Standard `Read`/`Edit`/`Write` are permitted for markdown and config files only. Never use `bash` `ls`/`cat`/`find`/`grep`/`sed`. See `.docs/guides/mcp-tools.md` for the full tool reference."

---

## Cycle Overview

This command is a pure executor. It does NOT plan — the task file already contains the full plan with agent annotations. The cycle is:

```
┌─────────────────────────────────────────────────────────┐
│  1. READ OUTLINE  →  2. EXECUTE NEXT STEP  →  3. UPDATE │
│         ↑                                       │       │
│         └───────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────┘
```

---

## Step 1: Read and Parse the Outline

**Delegate this step** to an `Explore` sub-agent. The sub-agent reads and parses the outline, then returns a structured summary. The main agent should NOT read the outline directly.

- Use MCP Serena to read the outline file
- If the file does not exist or is empty, STOP and report the error
- Parse the structure to identify:
  - **Completed items**: Marked with `[x]`, `- [x]`, `[DONE]`, or strikethrough `~~text~~`
  - **In-progress items**: Marked with `[ ]`, `- [ ]`, `[WIP]`, or similar
  - **Not started items**: Unmarked list items or sections without status markers
  - **Blocked items**: Marked with `[BLOCKED]` or similar
- For each step section (`### N. ...`), extract the **agent type** from the `<!-- agent: TYPE -->` annotation
  - If no annotation exists, default to `general-purpose`
- Return: ordered list of sections with their status and agent type

### Completion Check
- If ALL items are marked complete:
  - Report success and STOP
  - Output: "All tasks in outline complete!"

---

## Step 2: Execute the Next Incomplete Step

**Delegate this step** to the sub-agent type specified in the task file's `<!-- agent: TYPE -->` annotation for that section. All implementation work runs in a sub-agent — never in the main context.

### Identify the Next Step

From the parsed outline (Step 1), pick the next step using this priority:
1. **Fix blockers first**: If any item is marked blocked, investigate why
2. **Continue in-progress work**: If something is WIP, prioritize completing it
3. **Start next incomplete item**: The first section with incomplete checkboxes

### Delegate Directly — No Re-Planning

The task file already contains all necessary detail. Pass the step's checkboxes and sub-details verbatim to the sub-agent. Do NOT research, re-plan, or ask clarifying questions — those were handled during `/add-task`.

**CRITICAL**

1) Absolute maximum of 3 sub-processes at a time
2) **ALWAYS** terminate processes when done (dev servers, type checkers, long-running commands)

### Subagent Requirements

When delegating, **every** sub-agent prompt MUST include:

1. **MCP Serena mandate**: "Use MCP Serena for all code exploration and editing. Do NOT use Read, Edit, Grep, or Glob on code files. See `.docs/guides/mcp-tools.md` for the full tool reference."
2. **The exact checkboxes and sub-details** from the task file section — pass them verbatim
3. **Run quality gates** after completing the work:
   - After any code changes: run the project's typecheck command (e.g., `pnpm typecheck`, `make types-backend`, `mypy`, etc.)
   - **ALL type errors are caused by your changes. No exceptions.** The codebase is committed clean before every `/tackle` cycle (enforced by `/update-docs` and `/git-commit`). There are zero pre-existing type errors.
   - **NEVER run `git stash` to "verify" if errors are pre-existing** — this is banned. It wastes time, triggers approval prompts, and the answer is always the same: the errors are yours. Fix them immediately.
4. **Report completion status** (success, partial, or failure with reason)

### Example Delegation

```
Task tool invocation:
  subagent_type: "general-purpose"   ← read from <!-- agent: general-purpose -->
  prompt: |
    **MANDATORY**: Use MCP Serena for all code exploration and editing.
    Do NOT use Read, Edit, Grep, or Glob on code files.
    See `.docs/guides/mcp-tools.md` for the full tool reference.

    Complete these tasks from the outline:

    ### 1. Create API Route

    - [ ] Create `src/pages/api/contact.ts` with POST handler
    - [ ] Validate request body: name (required), email (required, valid format), message (required)
    - [ ] Return 200 on success, 400 on validation failure
      - Use Zod for validation schema

    After completing the work:
    1. Run `pnpm typecheck` to verify no type errors
    2. If typecheck fails, ALL errors are from your changes — fix them immediately. NEVER run `git stash` to check if errors are pre-existing (they are not — the codebase is committed clean before every cycle).
    3. Report success or any issues encountered
```

---

## Step 3: Update the Outline with Status

**Do this step directly in the main agent context** — do NOT delegate to a sub-agent. This is a simple text replacement that does not warrant the overhead of a sub-agent.

After the sub-agent from Step 2 completes (or fails), update the outline file using the native `Edit` tool:

### Status Markers to Use
- `[x]` or `- [x]` - Task completed successfully
- `[WIP]` - Work in progress (if partially done)
- `[BLOCKED: reason]` - Blocked by something
- `[FAILED: reason]` - Failed, needs attention

### Update Process

1. Use the **`Edit`** tool — call it once per checkbox line. **Never** reach for `sed`, `awk`, `perl -i`, or `echo` to update task files, no matter how many checkboxes need flipping. Ten `Edit` calls is correct; one `sed` is wrong (and will trigger an approval prompt every time).
2. Add a timestamp comment: `<!-- Updated: YYYY-MM-DD HH:MM -->`
3. If subtasks were discovered during execution, add them to the outline

> **Note**: Markdown files use the native `Edit` tool — Serena's symbolic editor doesn't apply to prose, and shell editors (`sed` etc.) are forbidden. See `.docs/guides/mcp-tools.md` "Common anti-patterns" for the full rule.

### Example Update

Before:
```markdown
- [ ] Fix Header H1 misuse (change logo wrapper from h1 to div)
```

After:
```markdown
- [x] Fix Header H1 misuse (change logo wrapper from h1 to div) <!-- Completed: 2026-03-02 -->
```

---

## Step 4: Repeat the Cycle

After updating the outline:

1. **Return to Step 1** - Read the updated outline
2. **Execute the next step** - Step 2
3. **Update** - Step 3
4. **Continue** until all tasks are complete or you are interrupted

---

## Important Rules

### Process Management
- Maximum of 3 concurrent subagents at a time
- **ALWAYS terminate ALL processes and sub-agents when done** — dev servers, type checkers, long-running commands, background tasks. No exceptions.
- After EVERY sub-agent completes, verify it has been terminated before proceeding
- If a subagent hangs, terminate it immediately and mark the task as blocked
- The main agent must NEVER run implementation commands directly — always delegate

### Error Handling
- If a subagent fails, mark the task with `[FAILED: reason]`
- Do not retry failed tasks automatically - continue with next available task
- If all remaining tasks are blocked/failed, STOP and report status

### Progress Reporting
After each cycle, briefly report:
- What was just completed
- What will be tackled next
- Overall progress (X of Y tasks complete)

### Stopping Conditions
- All tasks marked as `[x]` complete
- User interrupts with Ctrl+C
- All remaining tasks are blocked or failed
- Outline file becomes invalid or unreadable

### No Re-Planning
- `/tackle` is an executor, NOT a planner — all planning was done in `/add-task`
- Do NOT research, re-plan, break down steps further, or ask clarifying questions
- If a step is too vague to execute, mark it `[BLOCKED: step needs more detail]` and move on
- The task file's agent annotations and step details are authoritative

### Mandatory Delegation
- **ALL steps** (read, execute, update) MUST be delegated to sub-agents (except Step 3: outline update)
- The main agent's role is strictly orchestration: receive results, decide next action, delegate
- NEVER read source code, edit files, or run commands directly in the main context
- This preserves the main context window for decision-making and prevents token bloat

---

## Begin Execution

Now execute the cycle:

1. Read the outline at: `$ARGUMENTS`
2. Identify the first incomplete step (using agent annotation from `<!-- agent: TYPE -->`)
3. Delegate to the annotated agent type
4. Update the outline
5. Repeat until done
6. Ask the user: **"Generate UAT tests for this task?"** using `AskUserQuestion`:
   - **Yes** — Run `/uat-generator .docs/tasks/active/<filename>` to create a UAT file in `.docs/uat/pending/` matching this task's naming
   - **No** — Skip UAT generation
7. Run the `/update` skill (this ensures any generated UAT file is included in the documentation update)
8. If UAT was generated in step 6, suggest: `/uat-walkthrough .docs/uat/pending/<file>.uat.md`

**Start now - read the outline and begin the first cycle.**
