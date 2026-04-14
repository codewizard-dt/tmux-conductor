---
description: Assess and update a task file for execution readiness
argument-hint: <path/to/task.md, number-slug, or number> [optional instructions]
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**

# Update Task

Assess an existing task file against the task spec and update it until it is execution-ready for `/tackle`.

---

**Input**: $ARGUMENTS

---

## Step 1: Resolve the Task File

Parse the first part of `$ARGUMENTS` to locate the task file. Any remaining text after the file reference is treated as **user instructions** for how to update the task.

1. **If a file path is provided** (e.g., `.docs/tasks/active/3-user-auth.md`):
   - Confirm the file exists (use Serena `find_file` or `list_dir`)
   - If the file does not exist, STOP and report the error

2. **If a number-slug is provided** (e.g., `3-user-auth`):
   - Search `.docs/tasks/active/` for `<number-slug>.md`
   - If not found, STOP and report the error

3. **If only a number is provided** (e.g., `3`):
   - Search `.docs/tasks/active/` for a file starting with that number
   - If ambiguous, list matches and ask the user to clarify
   - If no match found, STOP and report the error

---

## Step 2: Read the Task Spec, Add-Task Command, and Task File

Read all three files:
1. `.docs/tasks/active/README.md` — the authoritative task file spec (format and naming rules)
2. `.claude/commands/add-task.md` — the full overview of how to structure a task (research process, execution-readiness criteria, agent annotations, level of detail required)
3. The resolved task file from Step 1

The `add-task` command defines what a well-structured task looks like. Use it as the lens for your assessment.

---

## Step 3: Assess Against the Spec

Evaluate the task file against every requirement in the spec. Check for:

### Structure Compliance
- [ ] Has `# NNN — Task Title` heading
- [ ] Has `## Objective` with one-sentence description
- [ ] Has `## Approach` with 1-3 sentence summary
- [ ] Has `## Prerequisites` section (can be empty if none)
- [ ] Has `---` separator between Prerequisites and Steps
- [ ] Has `## Steps` with numbered `### N.` sections
- [ ] Ends with a verification section

### Execution Readiness (the critical part)
- [ ] **Every `### N.` section has `<!-- agent: TYPE -->` annotation** with a valid type (`general-purpose`, `Explore`, `Plan`)
- [ ] **Every actionable item uses `- [ ]` checkbox syntax**
- [ ] **Steps include specific file paths** to create or modify
- [ ] **Steps include function/component names** to implement
- [ ] **Steps have enough implementation detail** for an agent to execute without ambiguity or further research
- [ ] **Sub-details** as plain-text indented lines for acceptance criteria where needed
- [ ] Steps are grouped by logical area
- [ ] No vague steps like "implement feature X" without specifics

### Codebase Alignment
- [ ] Referenced file paths actually exist (or are clearly marked as "create new")
- [ ] Referenced function/component names match the codebase
- [ ] Approach is consistent with existing project patterns and conventions

---

## Step 4: Report Findings

Present a clear assessment to the user:

1. **Spec compliance**: List any structural issues (missing sections, wrong format)
2. **Execution readiness gaps**: List steps that are too vague for `/tackle` to execute — these are the most important findings
3. **Codebase misalignments**: Any references that don't match reality

If there are **user instructions** (text after the file reference in `$ARGUMENTS`), note how they relate to the findings.

---

## Step 5: Apply Updates

### If user instructions were provided
Apply the user's specific changes first, then fix any spec compliance issues found in Step 3.

### If no user instructions were provided
Fix all issues found in Step 3:
- Add missing structural sections
- Add `<!-- agent: TYPE -->` annotations to any sections missing them
- Flesh out vague steps with specific file paths, function names, and implementation detail
  - Use Serena to explore the codebase and determine the correct paths, names, and patterns
  - Use Context7 MCP for any library/framework documentation needed
- Convert plain list items to `- [ ]` checkbox syntax

### Research for updates
When adding specificity to vague steps, follow the `/research` workflow (see `.claude/commands/research.md`):
- **Internal (Phase 2)**: Use Serena's `get_symbols_overview`, `find_symbol`, and `search_for_pattern` to understand the codebase
- **External (Phase 3)**: Use Context7 MCP for library docs and Brave Search MCP for best practices and package recommendations
- Ground every update in actual codebase state — don't guess at file paths or function names

### Present changes before applying
Before writing the updated task file, present a summary of proposed changes and ask the user to confirm using `AskUserQuestion`.

After confirmation, update the task file using the **`Edit`** tool (or `Write` for a full rewrite). **Never** use `sed`, `awk`, `perl -i`, or `echo >>` — call `Edit` once per change, even if there are many. See `.docs/guides/mcp-tools.md` "Common anti-patterns".

---

## Step 6: Confirm Completion

Report:
- Number of issues found and fixed
- Any remaining concerns or trade-offs
- Suggest next steps:
  ```
  To execute this task:  /tackle <resolved-path>
  ```
