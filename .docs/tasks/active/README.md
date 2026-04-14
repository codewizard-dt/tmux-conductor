# Task File Specification

Task files in `active/` are structured outlines designed for execution by `/tackle`.

## Naming Convention

```
<NNN>-<short-description>.md
```

- **NNN**: Zero-padded sequential integer (check `active/` and `completed/` to find the next number)
- **short-description**: Lowercase, hyphen-separated slug (2-4 words)

Examples: `001-basic-infrastructure.md`, `004-application-tracker.md`, `008-find-jobs.md`

## Required Structure

```markdown
# NNN — Task Title

## Objective

One-sentence description of what this task accomplishes.

## Approach

Brief summary of the technical approach or key decisions (1-3 sentences).

## Prerequisites

- [ ] Any setup or dependencies that must exist before starting
- [ ] Reference other tasks by number: "Task 001 (Infrastructure) completed"

---

## Steps

### 1. Section Name  <!-- agent: general-purpose -->

- [ ] Step description with enough detail for an agent to implement
- [ ] Another step — include file paths, component names, or API routes when known
  - Sub-detail or acceptance criteria (plain text indent, not a checkbox)

### 2. Another Section  <!-- agent: general-purpose -->

- [ ] More steps grouped by logical area

### N. Verification  <!-- agent: general-purpose -->

- [ ] Verify TypeScript compiles / tests pass / app runs
- [ ] Verify key user flows work end-to-end
```

## Rules

- Every actionable item uses `- [ ]` checkbox syntax
- Number step sections sequentially: `### 1.`, `### 2.`, etc.
- **Every step section MUST have an agent type annotation**: `<!-- agent: TYPE -->` on the `###` header line
  - Valid types: `general-purpose`, `Explore`, `Plan`
- Group steps by logical area (e.g., "Schema Update", "API Routes", "UI Components")
- Steps should be specific enough for `/tackle` to execute without ambiguity — the task file IS the plan
- Include file paths, function names, or route patterns when known
- End with a verification section to confirm the work is complete
- Use `---` separator between Prerequisites and Steps
- Keep the objective to one sentence
- Keep the approach to 1-3 sentences

## Lifecycle

```
active/  →  completed/
(/tackle + /uat-walkthrough all pass)
```

When a task reaches `completed/`, a UAT link is appended:
```markdown
---
**UAT**: [`.docs/uat/completed/NNN-slug.uat.md`](../../uat/completed/NNN-slug.uat.md)
```
