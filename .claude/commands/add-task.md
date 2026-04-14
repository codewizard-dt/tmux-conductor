---
description: Add a new task to .docs/tasks
argument-hint: <task description>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Always obey `.docs/guides/task-lifecycle.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**


$ARGUMENTS

---

**Instructions:**

1) **Read the task spec**: Read `.docs/tasks/active/README.md` for the required file format, naming convention, and example output. Follow it exactly.

2) **Summarize the user input**: Extract the core task objective, scope, and any specific requirements from the provided arguments.

3) **Assess existing tasks**: Check `.docs/tasks/active/` and `.docs/tasks/completed/` to determine the next task number.

4) **Research**: Run the `/research` workflow (see `.claude/commands/research.md`) scoped to this task:
   - **Phase 2 (Internal)**: Review `PROJECT_STATUS.md`, `CLAUDE.md`, and related code via Serena to understand constraints, dependencies, patterns, and data flow.
   - **Phase 3 (External)**: Use Context7 MCP for library docs and Brave Search MCP for best practices, pitfalls, package discovery, and community recommendations.
   - **Phase 4 (Synthesis)**: Produce a clear picture of trade-offs, risks, and viable solutions. If multiple approaches exist, present a comparison table.

5) **Clarify approach**: Present your research findings and **always ask clarifying questions if there are multiple valid approaches** — use `AskUserQuestion` to present options with descriptions (informed by the research) before committing to an approach.

6) **Present your plan**: Before creating the task file, present a summary of the planned task structure to the user. Include:
   - Core objective
   - Key architecture/design decisions (informed by clarifying questions)
   - High-level step breakdown
   Ask the user to confirm before proceeding.

7) **Create the task file**: After user confirmation, create a fully detailed, execution-ready task file in `.docs/tasks/active/` following the format specified in `.docs/tasks/active/README.md`.

   **CRITICAL — The task file IS the plan.** `/tackle` will execute steps verbatim without re-planning. Every step must include:
   - **Specific file paths** to create or modify
   - **Function/component names** to implement
   - **Agent type annotation** on each section header (e.g., `### 1. Create API Route  <!-- agent: general-purpose -->`)
   - **Enough implementation detail** that an agent can execute without ambiguity or further research
   - **Sub-details** as plain-text indented lines under checkboxes for acceptance criteria

   Agent type annotations use an HTML comment on the section header line:
   ```markdown
   ### 1. Section Name  <!-- agent: general-purpose -->
   ```
   Valid agent types: `general-purpose`, `Explore`, `Plan`

8) **Update the task index**: Add a reference to the new task in `.docs/tasks/README.md` under the "Active Tasks" section (create the file if it doesn't exist).

9) **Update `PROJECT_STATUS.md`**: If it exists, update any references to this task or add it under the appropriate phase.

10) **Confirm completion**: Report the created task file path and summary to the user. Suggest next steps:
   ```
   To implement this task:  /tackle .docs/tasks/active/<number>-<slug>.md
   ```
   Note: After `/tackle` completes, the task stays in `active/`. Use `/uat-generator` to create UAT tests, then `/uat-walkthrough` to move the task to `completed/`.
