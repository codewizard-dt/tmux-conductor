# Product Requirements Documents

This directory is this project's **Product Requirements Log (PRL)** — the collection of every Product Requirements Document (PRD) written for the project. Each PRD captures **what to build and why** from a product perspective: the problem, the personas, the desired outcomes, and the explicit non-goals. PRDs are the **upstream input** to the architectural decision and implementation pipeline.

PRDs are managed via five slash commands:

| Command | Purpose |
|---------|---------|
| `/prd-create <idea>` | Draft a new PRD via a Socratic Q&A session |
| `/prd-finalize <file>` | Run a completeness audit and flip status from `draft` → `approved` |
| `/prd-extract-decisions <file>` | Extract Architecturally Significant Requirements (ASRs) and propose ADR candidates |
| `/prd-update <file> <change>` | Append a tracked amendment block (never rewrite); flag downstream impact |
| `/prd-trash <file>` | Move a cancelled PRD to `trashed/` and surface linked ADRs/tasks for review |

---

## Glossary

| Term | Definition |
|------|------------|
| **PRD** (Product Requirements Document) | A single file capturing the product-perspective requirements for one feature, initiative, or product area |
| **PRL** (Product Requirements Log) | The collection of all PRDs for this project — *i.e.* this directory |
| **ASR** (Architecturally Significant Requirement) | A requirement with measurable effect on system structure, key quality attributes, or external dependencies. ASRs surface from PRDs and become the inputs to ADRs |
| **Persona** | A specific named user role with stated goals, context, and constraints. Not "users" — name and characterize each |
| **User Story** | A unit of desired behavior in the form *"As a `<persona>`, I want `<capability>` so that `<outcome>`"* with explicit acceptance criteria |
| **Success Metric** | A measurable signal with threshold and timeframe used to evaluate whether the PRD's goals were met after release |
| **Non-Goal** | An explicit out-of-scope statement. Critical for scope discipline — what the PRD will *not* address |
| **Amendment** | A tracked, append-only change to an approved PRD. Recorded as a new `## Amendment N` block, never by rewriting prior content |

---

## Relationship to ADRs and Tasks

PRDs sit **upstream** of ADRs and tasks in the spec-driven flow:

```mermaid
flowchart LR
    Idea[Feature idea / problem] --> CreatePRD[/prd-create/]
    CreatePRD --> Draft[PRD status: draft]
    Draft --> FinalizePRD[/prd-finalize/]
    FinalizePRD --> Approved[PRD status: approved]
    Approved --> PRDToDecisions[/prd-extract-decisions/]
    PRDToDecisions --> CreateADR[/adr-create/]
    CreateADR --> ProposedADR[ADR proposed]
    ProposedADR --> FinalizeADR[/adr-finalize/]
    FinalizeADR --> AcceptedADR[ADR accepted]
    AcceptedADR --> AddTask[/task-add --adr/]
    AddTask --> Tackle[/tackle/]
    Tackle --> UAT[/uat-walk/]
```

The boundary between PRD and ADR is sharp:

| Layer | Vocabulary | Question it answers |
|-------|------------|---------------------|
| **PRD** | Outcomes, personas, user behavior, business value | *What must the product do, for whom, and why?* |
| **ADR** | Trade-offs, options, technical drivers, consequences | *How will we build it, and which option, with what risks?* |
| **Task** | File paths, function names, steps | *What changes do we make to the code today?* |

**Hard rule** (from Joel Parker Henderson's ADR pattern guide): *"A PRD never justifies architecture. An ADR never redefines product scope."* If you find a PRD specifying "use Redis", lift that into an ADR. If you find an ADR specifying "users can reset their password via SMS", lift that into a PRD.

---

## When to Write a PRD

Write a PRD when **all** of the following are true:

| Criterion | Check |
|-----------|-------|
| There is a real problem or opportunity worth aligning on | Not a trivial UI tweak |
| The work involves more than one decision area | Otherwise an inline issue is fine |
| Multiple stakeholders need a shared reference | Solo work doesn't need a PRD |
| The "what" is not obvious from the codebase or current product | Documenting the obvious wastes effort |

## When NOT to Write a PRD

| Category | Why skip |
|----------|----------|
| Bug fixes | The bug *is* the spec |
| Refactors with no user-facing change | No product surface to capture |
| One-line config changes | Below the threshold |
| Internal tooling / dev-experience tweaks owned by one engineer | An issue or task suffices |
| Decisions purely about *how* to implement something | That's an ADR, not a PRD |

If the topic doesn't clear the bar above, do not pad the PRL — open a task directly via `/task-add` or close the question in code review.

---

## Status Lifecycle

Each PRD has a single top-level `Status` that progresses linearly:

| Status | Meaning | Set by | Allowed transitions |
|--------|---------|--------|---------------------|
| `draft` | In active authoring; gaps may remain | `/prd-create` | → `approved` (via `/prd-finalize`); → `trashed` (via `/prd-trash`) |
| `approved` | Audit passed; downstream ADR/task work may begin | `/prd-finalize` | → `archived` (manually, after delivery); → `superseded` (when a successor PRD replaces it); → `trashed` (rare; only if cancelled mid-flight) |
| `archived` | The product work landed; PRD preserved as historical reference | Manual edit | Terminal |
| `superseded` | A new PRD covers this scope and replaces this one | Manual edit referencing successor | Terminal |
| `trashed` | Cancelled or invalidated before approval | `/prd-trash` | Terminal |

**Approved PRDs are immutable in substance.** Changes to scope, personas, success criteria, or non-goals after approval go through `/prd-update`, which appends an `## Amendment N` block rather than editing the original sections in place. This preserves the audit trail.

---

## File Template

Each PRD lives at `.docs/prd/NNN-slug.md` (3-digit zero-padded, lowercase-dashed, ≤ 60 chars). The shape:

```markdown
# PRD NNN: <Product Initiative Title>

> <One-sentence elevator pitch — what this PRD captures.>

- **Status**: draft | approved | archived | superseded | trashed
- **Created**: YYYY-MM-DD
- **Last updated**: YYYY-MM-DD
- **Owner**: <product-lead name or role>
- **Stakeholders**: <names or roles, comma-separated>
- **Tags**: <area-1>, <area-2>

## Problem Statement

<2-4 sentences. What is broken, missing, or possible? Why now?>

## Goals

| # | Goal | Linked Success Metric |
|---|------|-----------------------|
| 1 | <outcome-oriented sentence> | SM-1 |
| 2 | <…> | SM-2 |

## Non-Goals (explicit out-of-scope)

| # | Non-Goal | Why excluded |
|---|----------|--------------|
| 1 | <something a reader might assume is in scope> | <reason> |

## Personas

| Persona | Context | Primary goal in this PRD |
|---------|---------|--------------------------|
| **<Name, e.g. "Casey, the on-call SRE">** | <where they sit, constraints> | <what they want to accomplish> |

## User Stories

### US-1. <Short story title>

> As **`<persona>`**, I want `<capability>` so that `<outcome>`.

**Acceptance Criteria:**

| # | Criterion |
|---|-----------|
| 1 | <observable, testable> |
| 2 | <…> |

### US-2. <…>

<repeat>

## Success Metrics

| ID | Signal | Threshold | When measured |
|----|--------|-----------|---------------|
| SM-1 | <e.g. weekly active sessions> | <≥ 1.5× baseline> | <30 days post-launch> |
| SM-2 | <…> | <…> | <…> |

## Constraints

| # | Constraint | Source |
|---|------------|--------|
| 1 | <e.g. must comply with SOC 2 access controls> | <legal / regulatory / business> |

## Assumptions

| # | Assumption | If false, impact |
|---|------------|------------------|
| 1 | <e.g. existing auth system supports OIDC> | <PRD scope expands to include auth work> |

## Open Questions

| # | Question | Owner | Resolution by |
|---|----------|-------|---------------|
| 1 | <…> | <name> | YYYY-MM-DD |

## Linked ADRs

> Filled in by `/prd-extract-decisions`. Each row tracks one Architecturally Significant Requirement that became (or will become) an ADR.

| ASR | ADR | Status |
|-----|-----|--------|
| <e.g. p95 latency < 200ms under 10k concurrent> | ADR-NNNN#DM | proposed/accepted |

## Linked Tasks

> Filled in as `/task-add --prd PRD-NNN` runs. The PRD is delivered when all linked tasks complete.

| Task | Status |
|------|--------|
| `.docs/tasks/NNN-slug.md` | WIP / done |

## Amendments

> Appended by `/prd-update`. Never edit prior amendments — append a new one.

<!-- Amendments appear here as `## Amendment 1`, `## Amendment 2`, etc. -->
```

**Required, non-empty fields** before `/prd-finalize` will pass:

| Field | Why |
|-------|-----|
| Problem Statement | Without it, the PRD is a feature wishlist, not a requirement |
| Goals (≥ 1) with linked Success Metrics | Goals without metrics are vibes |
| Non-Goals (≥ 1) | Forces scope discipline |
| Personas (≥ 1, named & characterized) | "Users" is not a persona |
| User Stories (≥ 1) with acceptance criteria | The behavior contract |
| Success Metrics (≥ 1) with signal + threshold + timeframe | Required for post-launch evaluation |
| Owner | Single accountable person |

Fields that may legitimately be empty: `Constraints`, `Assumptions`, `Open Questions` (if all resolved), `Linked ADRs` and `Linked Tasks` (filled later).

---

## Index

One row per PRD. Sort by file number ascending.

| File | Title | Status | Created | Owner | Linked ADRs | Linked Tasks |
|------|-------|--------|---------|-------|-------------|--------------|
| _No PRDs yet — use `/prd-create <idea>` to draft the first one._ | | | | | | |

When adding a row:

| Column | Format |
|--------|--------|
| `File` | `[PRD-NNN](NNN-slug.md)` |
| `Title` | The PRD's H1 sub-title (without the `PRD NNN:` prefix) |
| `Status` | `draft` \| `approved` \| `archived` \| `superseded` \| `trashed` |
| `Created` | `YYYY-MM-DD` |
| `Owner` | One name or role |
| `Linked ADRs` | Count of ADR decisions linked, e.g. `3` (or `—` if none) |
| `Linked Tasks` | Count of tasks linked, e.g. `2/4 done` (or `—` if none) |

---

## Anti-Patterns to Avoid

| Anti-Pattern | What it looks like | Remedy |
|--------------|-------------------|--------|
| **PRD-as-Spec** | The PRD prescribes implementation details, framework choices, schemas | Move all *how* statements to ADRs; keep the PRD to *what* and *why* |
| **Vague Personas** | "Users", "the team", "everyone" listed as personas | Name and characterize each persona; if you can't, the requirement isn't real |
| **Vibe Goals** | "Improve performance", "make it faster" with no metric | Every goal links to a measurable Success Metric with a threshold |
| **Missing Non-Goals** | No `## Non-Goals` section, or the section says "N/A" | Force at least one non-goal — what would a reader incorrectly assume is in scope? |
| **Acceptance-Criteria-as-Tests** | Acceptance criteria are written as test cases ("test: assert X = Y") | Acceptance criteria describe observable user-facing behavior, not test implementations |
| **Solution Smuggled into Problem Statement** | "We need to add a Postgres index on `users.email`" | Restate as the user-visible problem ("login takes 8s for users with > 100k records") and let the ADR pick the solution |
| **PRD Bloat** | The document sprawls past ~3 pages with implementation discussion | Move technical exploration to `/research` notes or to ADRs |
| **Amendment Avoidance** | The team rewrites the original sections instead of using `/prd-update` | Approved PRDs are immutable in substance — surface scope changes as amendments so the audit trail survives |
| **Phantom Linkage** | The PRD references ADRs or tasks that don't exist or never got created | `/prd-extract-decisions` is the only sanctioned path to populate `## Linked ADRs`; populate `## Linked Tasks` only via `/task-add --prd` |
| **One-Way Sign-off** | The owner approves the PRD but stakeholders never review | `/prd-finalize` requires explicit confirmation that named stakeholders have reviewed |

---

## Quick-Reference Workflow

```mermaid
flowchart LR
    Idea[Feature idea] --> Create[/prd-create/]
    Create --> Draft[draft]
    Draft --> Finalize[/prd-finalize/]
    Finalize --> Audit{All required<br/>fields present<br/>and measurable?}
    Audit -- no --> AskUser[AskUserQuestion]
    AskUser --> Audit
    Audit -- yes --> Approved[approved]
    Approved --> Bridge[/prd-extract-decisions/]
    Bridge --> ASRs{ASRs<br/>identified?}
    ASRs -- yes --> CreateADR[/adr-create per group/]
    ASRs -- no --> AddTask[/task-add --prd/ directly]
    CreateADR --> AcceptedADR[/adr-finalize/]
    AcceptedADR --> AddTaskFromADR[/task-add --adr/]
    AddTask --> Tackle[/tackle/]
    AddTaskFromADR --> Tackle
    Tackle --> UATWalk[/uat-walk/]
    UATWalk --> Done[Linked Tasks marked done<br/>in PRD index]
    Approved --> Update[/prd-update/]
    Update --> Amendment[Amendment N appended<br/>downstream impact flagged]
```

---

## See Also

- [`/prd-create` command](../../.claude/skills/prd-create/SKILL.md)
- [`/prd-finalize` command](../../.claude/skills/prd-finalize/SKILL.md)
- [`/prd-extract-decisions` command](../../.claude/skills/prd-extract-decisions/SKILL.md)
- [`/prd-update` command](../../.claude/skills/prd-update/SKILL.md)
- [`/prd-trash` command](../../.claude/skills/prd-trash/SKILL.md)
- [ADR Log](../adr/README.md) — downstream decision records
- [Atlassian PRD guide](https://www.atlassian.com/agile/product-management/requirements) — agile PRD conventions
- [Marty Cagan on lean PRDs](https://plan.io/blog/one-pager-prd-product-requirements-document/) — the case for short, living PRDs
- [Joel Parker Henderson's PRD↔ADR pattern](https://gist.github.com/thedavidyoungblood/bccce859af7a476e44a290a2230e0913) — the boundary rule
- [Spec-Driven Development (arXiv 2602.00180, 2026)](https://arxiv.org/abs/2602.00180) — the spec-first paradigm this directory implements
