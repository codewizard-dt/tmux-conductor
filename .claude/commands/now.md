---
description: Execute task with planning and delegation
argument-hint: <task description>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**


$ARGUMENTS

---

**Instructions:**

1) **Context**: Summarize the input from the user, determine desired outcomes, and determine what parts of the codebase to assess.
2) **Recall Serena memories**: Before planning, check for relevant project knowledge:
   - `mcp__serena__list_memories` → scan for memories related to the task area (use `topic` filter if applicable)
   - `mcp__serena__read_memory` → read any relevant memories to inform your plan
   - Factor recalled knowledge (architecture decisions, known gotchas, integration patterns) into your approach
3) **Research**: If the task involves technology choices, architectural decisions, or unfamiliar patterns, run the `/research` workflow (see `.claude/commands/research.md`) to gather internal and external context before planning.
4) Assess all relevant files (use serena mcp) and make a comprehensive plan to achieve desired outcomes.
5) Delegate each step of the plan to the proper sub-agent.
6) **Update memories after completion**: Once all steps are done:
   - Update stale memories with `mcp__serena__edit_memory` if the task changed documented patterns
   - Write new memories with `mcp__serena__write_memory` for non-obvious knowledge discovered during execution (use `/` in names for topic hierarchy, e.g. `api/auth/jwt-flow`)

---

**CRITICAL**

1) Absolute maximum of 3 sub-processes at a time
2) **ALWAYS** terminate processes when done** (dev servers, type checkers, long-running commands)
