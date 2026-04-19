---
description: Deep research on a topic using codebase analysis, library docs, and web search
argument-hint: <topic or question to research>
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**
**Run `/primer` first if you have not already this session.**

# Research

Perform comprehensive research on a topic by combining codebase analysis, library documentation, and web research. Produce actionable findings with implementation suggestions.

---

**Research Topic**: $ARGUMENTS

---

## Phase 1: Understand the Research Question

1. **Parse the topic**: Extract the core question, scope, and any constraints from `$ARGUMENTS`
2. **Identify research dimensions**:
   - What needs to be understood about the **current codebase**? (existing patterns, dependencies, relevant code)
   - What **external knowledge** is needed? (libraries, best practices, architectural patterns)
   - Are there **multiple possible approaches** to compare?
3. **Formulate specific research questions** — break the topic into 3-5 concrete questions to answer

---

## Phase 2: Internal Research (Codebase Analysis)

Use MCP Serena to understand the current state of the codebase as it relates to the topic.

### 2a. Project Context

- Read Serena memories (`mcp__serena__list_memories` → `mcp__serena__read_memory`) for relevant project context
- Check `PROJECT_STATUS.md` and `CLAUDE.md` for constraints, conventions, and architectural decisions
- Review `.docs/tasks/` for any related active or completed tasks

### 2b. Code Exploration

- **Structure**: Use `mcp__serena__get_symbols_overview` on relevant files/directories to understand architecture
- **Dependencies**: Use `mcp__serena__search_for_pattern` to find imports, package usage, and existing integrations related to the topic
- **Patterns**: Use `mcp__serena__find_symbol` to locate relevant functions, classes, and components
- **Configuration**: Check `package.json`, config files, and environment setup for relevant dependencies and settings

### 2c. Identify Constraints

Document what already exists that any solution must work with:
- Existing dependencies and their versions
- Established patterns and conventions
- Integration points and data flow
- Testing approach and quality gates

---

## Phase 3: External Research (Library Docs & Web)

### 3a. Library Documentation (Context7 MCP)

For each relevant library or framework identified:

1. **Resolve the library**: `mcp__context7__resolve-library-id(libraryName="<library>")`
2. **Query specific topics**: `mcp__context7__query-docs(libraryId="<id>", query="<specific question>")`
3. **Repeat** with refined queries if initial results are insufficient

Use Context7 for:
- API syntax and usage patterns
- Configuration options
- Migration guides and version-specific features
- Known limitations and edge cases

### 3b. Web Research (Brave Search MCP)

**CRITICAL**: Brave Search has a rate limit of 1 request per second. All searches MUST be sequential, never parallel.

Use Brave Search for:
- Best practices and recommended approaches (e.g., `"<topic> best practices 2025"`)
- Common pitfalls and failure modes (e.g., `"<topic> common mistakes"`)
- Comparison of alternative solutions (e.g., `"<library A> vs <library B>"`)
- Community recommendations and real-world experience (e.g., `"<topic> production experience"`)
- Performance benchmarks and scalability considerations

### 3c. Package Discovery

When the research involves choosing packages or tools:

1. **Search for candidates**: Use Brave Search to find popular options (e.g., `"best <category> library for <framework> 2025"`)
2. **Evaluate each candidate** against these criteria:
   - Maintenance status (last release, open issues, bus factor)
   - Community adoption (npm downloads, GitHub stars, Stack Overflow presence)
   - Bundle size and performance impact
   - TypeScript support and type quality
   - Compatibility with existing stack
3. **Check documentation**: Use Context7 to verify API quality and completeness for top candidates

---

## Phase 4: Synthesis & Recommendations

### 4a. Summarize Findings

Present a clear, structured summary:

1. **Current State**: What exists in the codebase today relevant to this topic
2. **Key Findings**: Most important discoveries from research (with sources)
3. **Constraints**: What any solution must account for

### 4b. Solution Comparison (if multiple approaches exist)

For each viable approach, present:

| Criteria | Option A | Option B | Option C |
|----------|----------|----------|----------|
| **Approach** | Brief description | Brief description | Brief description |
| **Pros** | Key advantages | Key advantages | Key advantages |
| **Cons** | Key drawbacks | Key drawbacks | Key drawbacks |
| **Complexity** | Low/Medium/High | Low/Medium/High | Low/Medium/High |
| **Dependencies** | New deps needed | New deps needed | New deps needed |
| **Codebase fit** | How well it fits | How well it fits | How well it fits |
| **Maintenance** | Ongoing cost | Ongoing cost | Ongoing cost |

### 4c. Recommendation

- **Recommended approach**: State which option you recommend and why
- **Implementation outline**: High-level steps to implement the recommended approach
- **Risks and mitigations**: What could go wrong and how to handle it
- **Alternative if constraints change**: Note when a different option would become preferable

### 4d. Next Steps

Suggest concrete next steps:
- If the user wants to proceed: `To create a task: /add-task <description based on findings>`
- If more research is needed: Identify specific areas that need deeper investigation
- If a decision is needed: Frame the decision clearly with the trade-offs

---

## Research Quality Standards

- **Cite sources**: Note whether information came from codebase analysis, Context7 docs, or web search
- **Distinguish fact from opinion**: Clearly separate what the code shows from what best practices suggest
- **Stay current**: Prefer recent sources (2024-2025) over older ones
- **Be specific**: Include version numbers, specific API calls, and concrete examples
- **Acknowledge gaps**: If something couldn't be determined, say so rather than guessing

---

## CRITICAL Rules

1) **Brave Search rate limit**: 1 request/second, sequential only — never parallel
2) **Use Context7 for library docs**: Do NOT use Brave Search for library API documentation
3) **Use Serena for code**: Do NOT use Read, Grep, or Glob on code files
4) **Maximum 3 sub-processes at a time** if delegating research steps
5) **ALWAYS terminate processes when done**
