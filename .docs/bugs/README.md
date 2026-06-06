# Bugs

This directory is this project's **Bug Log** — every defect report tracked from first sighting to verified fix. A bug is a confirmed-or-suspected deviation between actual and expected behavior in code that already exists. Net-new feature work belongs in a PRD or task, not here.

Bugs are managed via three slash commands:

| Command | Purpose |
|---------|---------|
| `/bug-file <description>` | Create a new bug in `open/` with required-on-report fields (steps to reproduce, environment, expected/actual) |
| `/bug-triage <BUG-NNNN>` | Set priority, assignee, tags, impact; decide next destination (stay triaged, start work, or trash) |
| `/bug-close <BUG-NNNN>` | Record root cause + resolution + regression test; move to `closed/` |

---

## Glossary

| Term | Definition |
|------|------------|
| **Bug** | A reproducible (or suspected) defect in shipped or staged code. Has a single observable symptom |
| **Severity** | The **impact** of the defect if it occurs (data loss, crash, cosmetic). Set by the reporter / triager based on what users experience |
| **Priority** | The **urgency** of fixing it (when we'll schedule the work). Set by the owner during triage. Severity and priority are independent — a critical-severity bug for a tiny user segment may be low priority |
| **Reproducibility** | How reliably the bug surfaces: `always`, `sometimes`, `rarely`, `once` |
| **Workaround** | Steps a user can take to avoid the bug until a fix ships. "None known" is a valid value |
| **Root Cause** | The underlying defect explanation, filled in during/after the fix — not on report |
| **Regression Test** | A test that fails before the fix and passes after. Required to close a bug |

---

## When to File a Bug

| File a bug when | Don't file a bug when |
|---|---|
| Existing behavior diverges from documented or reasonable expectations | The feature doesn't exist yet — file a task or PRD |
| You can describe steps to reproduce, or a reliable trigger | You have a vague "feels slow" with no measurement — gather data first |
| The defect is in code, config, or infra under this project's control | The defect is in an upstream dependency — file there, then track here only if a workaround is needed |
| A user, monitor, or test surfaced the symptom | You're brainstorming a refactor — that's not a bug |

---

## Severity Rubric

| Level | Definition | Examples |
|-------|------------|----------|
| **critical** | Data loss, security breach, production fully down, no workaround | Auth bypass; corrupted writes; full outage |
| **high** | Major feature broken for many users; workaround painful or partial | Checkout fails for one payment provider; 5xx on a primary route |
| **medium** | Feature degraded or broken for a subset; reasonable workaround exists | Sort order wrong on a non-default view; intermittent retries |
| **low** | Cosmetic, copy, or minor UX nit; no functional impact | Misaligned icon; typo in a help string |

## Priority Rubric

| Level | Definition |
|-------|------------|
| **P0** | Drop everything — fix in the current session/day |
| **P1** | Fix in the current iteration |
| **P2** | Schedule within the next 1–2 iterations |
| **P3** | Backlog; revisit during periodic triage |

Severity and priority are independent dimensions. Always assign both.

---

## Directory Layout

```
.docs/bugs/
├── open/           # Reported (new or triaged); not yet being worked on
├── in-progress/    # Actively being fixed
├── closed/         # Fix verified + shipped (terminal)
└── trashed/        # wontfix / duplicate / cannot-reproduce (terminal)
```

Folder location captures **coarse** status; the `Status` field inside each bug file captures **fine** status (e.g. `triaged` vs `new` while still in `open/`).

---

## Status Lifecycle

```
              ┌──────────┐
   report ───►│   new    │  open/
              └────┬─────┘
                   │ triage (severity + priority + assignee)
                   ▼
              ┌──────────┐
              │ triaged  │  open/
              └────┬─────┘
                   │ start work
                   ▼
              ┌──────────────┐
              │ in-progress  │  in-progress/
              └──────┬───────┘
                     │ fix merged
                     ▼
              ┌──────────┐
              │  fixed   │  in-progress/    (awaiting verification)
              └────┬─────┘
                   │ regression test passes / verified in env
                   ▼
              ┌──────────┐
              │ verified │  closed/
              └──────────┘

   any state ─► wontfix / duplicate / cannot-reproduce ─► trashed/
```

| Status | Folder | Set when |
|--------|--------|----------|
| `new` | `open/` | Bug filed; no triage yet |
| `triaged` | `open/` | Severity, priority, assignee set |
| `in-progress` | `in-progress/` | Owner started work |
| `fixed` | `in-progress/` | Patch merged to main; awaiting verification (test/UAT/manual) |
| `verified` | `closed/` | Regression test passes and fix confirmed in the relevant environment |
| `wontfix` | `trashed/` | Deliberate decision not to fix (record the reason) |
| `duplicate` | `trashed/` | Duplicate of another bug (link to canonical) |
| `cannot-reproduce` | `trashed/` | Reproduction failed after reasonable effort; reopen if a repro surfaces |

---

## Naming Convention

```
NNNN-<short-slug>.md
```

- `NNNN`: 4-digit zero-padded sequential integer, **unique across all four folders**. Never re-number. To find the next number, scan `open/`, `in-progress/`, `closed/`, and `trashed/` and take `max + 1`.
- `<short-slug>`: lowercase, hyphen-separated, 2–5 words, ≤ 60 chars.

Examples: `0001-login-fails-on-safari.md`, `0042-csv-export-drops-utf8.md`.

The bug ID `BUG-NNNN` (e.g. `BUG-0042`) is the stable handle referenced from commits, PRs, support tickets, and other artifacts.

---

## File Template

```markdown
# BUG-NNNN — <Short Bug Title>

- **Status**: new | triaged | in-progress | fixed | verified | wontfix | duplicate | cannot-reproduce
- **Severity**: critical | high | medium | low
- **Priority**: P0 | P1 | P2 | P3
- **Reported**: YYYY-MM-DD
- **Reporter**: <name or role>
- **Assignee**: <name or role, or `—`>
- **Last updated**: YYYY-MM-DD
- **Tags**: <area-1>, <area-2>

## Summary

<2–4 sentences. What's broken, where, and who is affected.>

## Environment

| Field | Value |
|-------|-------|
| OS / Platform | <e.g. macOS 14.5, iOS 17.4> |
| Browser / Runtime | <e.g. Chrome 122, Node 20.10> |
| App version / commit | <SHA or version tag where the bug was seen> |
| Other relevant config | <feature flags, locale, account type, etc.> |

## Steps to Reproduce

1. ...
2. ...
3. ...

## Expected Behavior

<What should happen at the final step.>

## Actual Behavior

<What does happen. Include error messages, stack traces, console output, or screenshots in `.docs/uat/screenshots/` (link them).>

## Reproducibility

| Field | Value |
|-------|-------|
| Frequency | always / sometimes / rarely / once |
| First seen | YYYY-MM-DD |
| Last seen | YYYY-MM-DD |

## Impact

<Who is affected, how many, what does it block. Cite metrics, support tickets, or monitors when available.>

## Workaround

<Steps a user can take to avoid this until fixed, or "None known.">

## Root Cause Analysis

> Filled in during or after the fix — not on report.

<Brief technical explanation of the underlying defect. One paragraph is usually enough.>

## Resolution

> Filled in on close.

| Field | Value |
|-------|-------|
| Fix commit | <SHA> |
| Fix version | <version / release tag> |
| Linked PR | <#NNN> |
| Linked task | <`.docs/tasks/NNN-slug.md`, if work warranted a task> |
| Regression test | <path to the test that locks in the fix> |

## Related

- Related bugs: BUG-NNNN, BUG-NNNN
- Duplicate of: BUG-NNNN (when applicable)
- Upstream issue: <link, when caused by a dependency>
```

**Required, non-empty fields** before moving a bug to `closed/`:

| Field | Why |
|-------|-----|
| Steps to Reproduce | The contract. Without it, "fixed" can't be verified |
| Expected vs Actual | Defines the gap that was closed |
| Root Cause Analysis | Prevents reintroduction; informs related-bug discovery |
| Resolution (commit, regression test) | Audit trail and regression coverage |

---

## Index

One row per bug. Sort by ID ascending.

| ID | Title | Severity | Priority | Status | Reporter | Assignee | Reported | Closed |
|----|-------|----------|----------|--------|----------|----------|----------|--------|
| _No bugs yet — create the first file as `open/0001-<slug>.md`._ | | | | | | | | |

When adding a row:

| Column | Format |
|--------|--------|
| `ID` | `[BUG-NNNN](open/NNNN-slug.md)` — link points to the file's current location |
| `Title` | The bug's H1 sub-title (without the `BUG-NNNN —` prefix) |
| `Severity` | `critical` \| `high` \| `medium` \| `low` |
| `Priority` | `P0` \| `P1` \| `P2` \| `P3` |
| `Status` | `new` \| `triaged` \| `in-progress` \| `fixed` \| `verified` \| `wontfix` \| `duplicate` \| `cannot-reproduce` |
| `Reporter` | Name or role |
| `Assignee` | Name or role, or `—` |
| `Reported` | `YYYY-MM-DD` |
| `Closed` | `YYYY-MM-DD` if terminal, else `—` |

---

## Anti-Patterns to Avoid

| Anti-Pattern | What it looks like | Remedy |
|--------------|--------------------|--------|
| **Repro-Free Report** | "It's broken sometimes" | Block triage until steps to reproduce or a reliable trigger is captured |
| **Severity = Priority Conflation** | All criticals marked P0, all lows marked P3 | Score each axis independently — impact is not urgency |
| **Compound Bug** | One file covers three different symptoms | Split into separate bugs; cross-link via `## Related` |
| **Silent Close** | Status flipped to `verified` with no commit, PR, or test link | Block close until `## Resolution` lists commit + regression test |
| **Premature `cannot-reproduce`** | Triaged once, couldn't repro, moved to trashed in an hour | Record what was tried; leave open with status `cannot-reproduce` for a cooldown period before trashing |
| **Phantom Duplicate** | Marked duplicate without naming the canonical bug | `Duplicate of: BUG-NNNN` is mandatory before moving to trashed |
| **Missing Regression Test** | Bug closed; same defect ships again two months later | Every close cites a test path — even a manual UAT checklist counts if automation isn't feasible |
| **Open Bug Graveyard** | Hundreds of P3 bugs aging in `open/` for years | Periodic triage either re-prioritizes, ages-out to `wontfix`, or splits into a task |

---

## See Also

- [`.docs/guides/bug-lifecycle.md`](../guides/bug-lifecycle.md) — folder-movement rules and triage flow
- [`.docs/guides/task-lifecycle.md`](../guides/task-lifecycle.md) — parallel model for task/UAT artifacts
- [Joel Spolsky — Painless Bug Tracking](https://www.joelonsoftware.com/2000/11/08/painless-bug-tracking/) — the canonical short read on what a bug record must contain
- [Bugzilla Status Workflow](https://bugzilla.readthedocs.io/en/latest/using/editing.html#life-cycle-of-a-bug) — reference state machine
