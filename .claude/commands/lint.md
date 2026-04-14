---
description: Get lint diagnostics, fix issues one-by-one in cycles
---
**Always obey `.docs/guides/mcp-tools.md`. Read it now if not already in context.**

# Lint Fix Cycles

Use IDE diagnostics to find and fix lint errors/warnings one at a time, verifying each fix before moving on.

---

## Step 1: Detect Source Directory

Determine the project's primary source directory:

1. Check for common source directories in order: `src/`, `app/`, `lib/`, `pages/`, `components/`
2. If none exist, use the project root (`.`)
3. Note the detected path for reporting

---

## Step 2: Get Diagnostics

Use the `mcp__ide__getDiagnostics` tool to retrieve **all** current diagnostics — errors, warnings, info, and hints.

- Filter results to only include diagnostics from files within the detected source directory
- Include **every severity level**: errors, warnings (including CSS conflicts, unused imports, type issues), info, and hints
- Sort by severity: **errors first**, then warnings, then info/hints
- If no diagnostics are found, report "No lint issues found!" and **STOP**

Common warning types to look for:
- **CSS conflicts** (`cssConflict`) — e.g., conflicting Tailwind classes like `max-w-[80%]` with `max-w-none`
- **Unused variables/imports** — declared but never referenced
- **Type warnings** — implicit `any`, missing return types
- **Accessibility** — missing alt text, ARIA issues

Display a summary:
```
Found X issue(s) — Y error(s), Z warning(s), N info/hint(s)
```

---

## Step 3: Fix the First Issue (Cycle Start)

Take the **first** diagnostic (highest severity) and fix it:

1. **Read the relevant code** using Serena symbolic tools or Read tool
2. **Understand the issue** — what the diagnostic message means and what caused it
3. **Apply the fix** — use the appropriate editing tool (Serena symbolic edit for code symbols, Edit for line-level changes)
4. Keep fixes minimal and focused — only change what's needed to resolve the specific diagnostic

### Fix strategies by diagnostic type

- **CSS conflict warnings** (e.g., `cssConflict`): Remove the conflicting/redundant class from the class string. When two Tailwind utilities set the same CSS property, remove the one that gets overridden.
- **Unused imports/variables**: Remove the unused declaration
- **Type errors**: Add proper types, fix mismatches
- **General lint warnings**: Follow the diagnostic's suggestion or apply the standard fix for the rule

---

## Step 4: Verify the Fix

After applying the fix:

1. Call `mcp__ide__getDiagnostics` again
2. Check if the specific diagnostic from Step 3 is **gone**
   - **If fixed**: Report success — `"Fixed: [diagnostic message] in [file]"` — Cycle complete
   - **If still present or new issues introduced**: Report the problem and attempt an alternative fix (max 2 retries per issue). If still failing after retries, skip the issue, report it as unresolvable, and move on

---

## Step 5: Continue or Stop

After a successful cycle:

1. Check remaining diagnostics count
2. If **more issues remain**: Report progress (`"Cycle N complete. X issue(s) remaining."`) and return to **Step 3** with the next diagnostic
3. If **no issues remain**: Report completion and **STOP**

```
All lint issues resolved! Fixed X issue(s) in Y cycle(s).
```

---

## Rules

- **One fix per cycle** — never batch multiple fixes together
- **Verify after every fix** — always re-lint before moving to the next issue
- **Skip unfixable issues** — after 2 failed attempts, move on and report the skip
- **Don't introduce new issues** — if a fix creates new diagnostics, revert and try a different approach
- **Minimal changes only** — fix the diagnostic, nothing else
- **Report progress** — show cycle number, what was fixed, and remaining count after each cycle
