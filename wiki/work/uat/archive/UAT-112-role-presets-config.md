---
id: UAT-112
aliases: [UAT-112]
title: "UAT: Role presets — presets.json config with a per-role CLAUDE.md fragment"
status: passed
task: TASK-112
created: 2026-08-15
updated: 2026-08-15
---

# UAT-112 — UAT: Role presets — presets.json config with a per-role CLAUDE.md fragment

implements::[[TASK-112]]

> **Source task**: [[TASK-112]]
> **Generated**: 2026-08-15
> **Note**: TASK-112 is pure backend with no HTTP endpoint and no UI — `getRoleFragment()`/`ROLE_VALUES` (`host-server/rolePresets.ts`) are called directly by TASK-113's spawn path, not exposed over the wire. There is accordingly no `UAT-API-*`/`UAT-UI-*` case in this file; every case below is either an edge-case behavior test or a static/integration check, and every one of them is machine-verifiable and was executed live at generation time — 14/14 pass, 0 human-only. **The headline invariant this file exists to protect: `getRoleFragment` must never throw.** It runs in the agent-spawn path (`createAgent()` → `createWorktree()` succeeds → TASK-113 calls `getRoleFragment`) — a throw there takes down agent creation itself, turning a cosmetic preset problem into an outage of the system's core function. Roughly two-thirds of the cases below exist specifically to attack that invariant from every angle a real deployment could hit it.

---

## Prerequisites

- [ ] `host-server/rolePresets.ts`, `host-server/role-presets.json`, and `host-server/rolePresets.test.ts` exist (TASK-112 implemented).
- [ ] `host-server/db.ts` contains the `agents.role` `CHECK` constraint from TASK-111 (schema v7) and `host-server/index.ts` contains the `VALID_AGENT_ROLES` array from TASK-111's `POST /agents` validation — both are cross-checked against `ROLE_VALUES` below.
- [ ] Fixtures: repo-local `./tmp/` only (the file-corruption tests below use `fs.mkdtempSync` under `./tmp/`, never `/tmp` or the real `host-server/role-presets.json`).
- [ ] Node ≥ 26, `tsx` available (already a `host-server` dependency, used via `node --import tsx/esm --test`).

---

## Test Cases

### UAT-EDGE-001: `getRoleFragment` returns a non-empty string for every valid role
- **Scenario**: Happy path — each of the 7 canonical role values must resolve to real content from `role-presets.json`.
- **Steps**: For each `role` in `ROLE_VALUES` (`generic`, `frontend`, `backend`, `qa`, `devops`, `security`, `architect`), call `getRoleFragment(role)` and assert it's a non-empty string.
- **Expected Result**: All 7 calls return non-empty strings.
- **Repeatable Unit Test**: Created (pre-existing from TASK-112's own implementation): `host-server/rolePresets.test.ts` (`'getRoleFragment returns a non-empty string for every ROLE_VALUES entry'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live at generation time (13/13 cases in this file passed in one scoped run, this one included).

### UAT-EDGE-002: Unrecognized role falls back to exactly the generic fragment
- **Scenario**: A role string that isn't in `role-presets.json` (e.g. a future DB enum value added before its preset ships) must not throw or return empty — it must degrade to the `generic` fragment.
- **Steps**: Call `getRoleFragment('nonexistent-role')` and `getRoleFragment('generic')`; compare.
- **Expected Result**: Both calls return the identical string.
- **Repeatable Unit Test**: Created (pre-existing): `host-server/rolePresets.test.ts` (`"getRoleFragment('nonexistent-role') falls back to the same fragment as getRoleFragment('generic')"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-003: Empty-string role falls back to exactly the generic fragment
- **Scenario**: `''` is a syntactically valid `string` (TypeScript won't catch it) but isn't a real role — must degrade gracefully like any other unrecognized role, not be treated as a distinct/crashing case.
- **Steps**: Call `getRoleFragment('')` and `getRoleFragment('generic')`; compare.
- **Expected Result**: Both calls return the identical string.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`"getRoleFragment('') falls back to the same fragment as getRoleFragment('generic')"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-004: `null`/`undefined` role (type-violating input) never throws and falls back to generic
- **Scenario**: `getRoleFragment`'s TypeScript signature is `(role: string) => string`, but nothing prevents a caller elsewhere in a large, evolving codebase from passing `null`/`undefined` at runtime (e.g. an older DB row, a bad JSON body, a refactor that loses a null-check). This is exactly the class of input the "never throws" invariant must survive, not just documented happy-path strings.
- **Steps**: Force-cast `getRoleFragment` to accept `string | null | undefined`, then call it with `null` and with `undefined`.
- **Expected Result**: Neither call throws; both return exactly the same string as `getRoleFragment('generic')`.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`'getRoleFragment never throws for null/undefined role (type-violating input) and falls back to generic'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-005: Absent `role-presets.json` degrades to a non-empty fallback, never throws
- **Scenario**: `presets` is loaded eagerly at module scope inside a `try/catch` (`rolePresets.ts:33-44`) — if the JSON file is missing at import time, the module must not crash the whole `host-server` process; it must degrade to an empty presets map and let `getRoleFragment`'s fallback chain handle the rest.
- **Steps**: Because loading happens once at module import, this can't be tested by corrupting the live file at runtime — it requires a **byte-identical scratch copy** of `rolePresets.ts`'s current source in a fresh `./tmp/` `mkdtemp` dir (no `role-presets.json` written alongside it), run in a spawned Node subprocess, capturing stdout/exit code. The real `host-server/role-presets.json` is never renamed, deleted, or touched — only the scratch copy's directory is affected, and it's `fs.rmSync`'d in a `finally` block regardless of outcome.
- **Expected Result**: Subprocess exits 0; stdout is non-empty.
- **Repeatable Unit Test**: Created (pre-existing from TASK-112's own implementation): `host-server/rolePresets.test.ts` (`'getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json is absent'`), using the `makeScratchModule()` helper.
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live. Confirmed post-run that the real `host-server/role-presets.json` (7 keys, all non-empty) and `host-server/rolePresets.ts` were unaffected, and no scratch directories were left under `./tmp/`.

### UAT-EDGE-006: Malformed JSON degrades to a non-empty fallback, never throws
- **Scenario**: Same eager-load invariant as UAT-EDGE-005, but for a `role-presets.json` that exists but fails `JSON.parse` (e.g. a hand-edit that leaves a trailing comma or unclosed brace).
- **Steps**: Scratch-copy technique (see UAT-EDGE-005) with `role-presets.json` content `'{ not valid json'`.
- **Expected Result**: Subprocess exits 0; stdout is non-empty.
- **Repeatable Unit Test**: Created (pre-existing): `host-server/rolePresets.test.ts` (`'getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json is malformed JSON'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-007: JSON that parses to a non-object (array) degrades to a non-empty fallback, never throws
- **Scenario**: `role-presets.json` is syntactically valid JSON but not an object — e.g. `[1,2,3]`. `rolePresets.ts:37` explicitly guards `typeof parsed === 'object' && !Array.isArray(parsed)`, so this must be verified as its own case, not assumed to be caught by the generic malformed-JSON path (a `JSON.parse` of `'[1,2,3]'` succeeds — this is a distinct failure class from UAT-EDGE-006's syntax error).
- **Steps**: Scratch-copy technique with `role-presets.json` content `'[1,2,3]'`.
- **Expected Result**: Subprocess exits 0; stdout is non-empty.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`'getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json parses to a non-object (JSON array)'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-008: JSON that parses to a non-object (bare string) degrades to a non-empty fallback, never throws
- **Scenario**: Same guard as UAT-EDGE-007, exercised with a different non-object JSON shape (a bare quoted string, valid JSON, `typeof parsed === 'string'`).
- **Steps**: Scratch-copy technique with `role-presets.json` content `'"just a string"'`.
- **Expected Result**: Subprocess exits 0; stdout is non-empty.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`'getRoleFragment degrades to a non-empty fallback (never throws) when role-presets.json parses to a non-object (JSON string)'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-009: A JSON file missing one role's key falls back to exactly the generic fragment for that role
- **Scenario**: `role-presets.json` is a well-formed object but is missing the `qa` key specifically (e.g. an edit that dropped one entry) — this must degrade per-key, not fail the whole file. Critically, this test proves the fallback actually **happened** (not just that some non-empty string came back, which UAT-EDGE-001-style tests alone can't distinguish from a coincidentally-present key) by comparing the missing role's output against `generic`'s output **from the same scratch environment** — no assertion on the fragment's prose content.
- **Steps**: Scratch-copy technique with a well-formed 6-key JSON object (all keys except `qa`), calling `getRoleFragment('qa')` then `getRoleFragment('generic')` in the same subprocess run (one line of stdout each).
- **Expected Result**: Subprocess exits 0; the `qa` line is non-empty and identical to the `generic` line.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`"getRoleFragment('qa') falls back to exactly the generic fragment when role-presets.json is missing the 'qa' key"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-EDGE-010: A JSON file with an empty-string value for one role falls back to exactly the generic fragment for that role
- **Scenario**: `role-presets.json` has all 7 keys, but `security`'s value is `""` (e.g. a bad merge or accidental find-replace) — `rolePresets.ts:59`'s `fragment.length > 0` check must treat this the same as a missing key, not return the empty string.
- **Steps**: Scratch-copy technique with a well-formed 7-key JSON object where `security: ''`, calling `getRoleFragment('security')` then `getRoleFragment('generic')` in the same subprocess run.
- **Expected Result**: Subprocess exits 0; the `security` line is non-empty and identical to the `generic` line.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`"getRoleFragment('security') falls back to exactly the generic fragment when role-presets.json has an empty-string value for 'security'"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-INTEGRATION-001: `ROLE_VALUES` matches `host-server/db.ts`'s `agents.role` CHECK constraint exactly
- **Scenario**: `rolePresets.ts`'s `ROLE_VALUES` and `db.ts`'s `CHECK (role IN (...))` constraint (TASK-111, `db.ts:404`) are two independent, hand-maintained lists of the same 7-value enum. If they drift, the API could accept a role the presets can't serve (or reject one the presets are ready for) — a real integration seam between two tasks, and cheap to pin with a direct source-cross-check rather than trusting both were typed correctly by hand.
- **Steps**: Read `host-server/db.ts`'s source text, regex-extract the `CHECK (role IN (...))` constraint's quoted role list, sort it, and compare (as a set) against a sorted copy of `ROLE_VALUES`.
- **Expected Result**: The two sorted lists are identical.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`"ROLE_VALUES matches the role enum in host-server/db.ts's agents.role CHECK constraint exactly"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-INTEGRATION-002: `host-server/index.ts`'s role validation reuses `ROLE_VALUES` with no local duplicate enum
- **Scenario**: At generation time, `index.ts`'s `POST /agents` route held its own inline `VALID_AGENT_ROLES` array — a third independent hand-maintained copy of the same 7-value enum, diffed against `rolePresets.ts`'s `ROLE_VALUES` to catch drift. **Superseded during `/uat-auto`, 2026-08-15**: TASK-115 (role selector UI, landed after this file was generated) refactored both role-validating routes (`POST /agents` and the newly role-aware `POST /projects/:id/agents`) to import and reuse `ROLE_VALUES` directly, deleting `VALID_AGENT_ROLES` entirely — confirmed via `mcp__serena__search_for_pattern` returning zero matches for `VALID_AGENT_ROLES` anywhere in `index.ts`. This is not a regression: drift between two hand-maintained copies is now structurally impossible rather than merely detected after the fact, a **stronger** invariant than the one this case originally described. The backing unit test was already rewritten to match (by the TASK-115 implementer, independently of this UAT run) — this case's own description was the only thing left stale, corrected here.
- **Steps**: Read `host-server/index.ts`'s source text; assert it imports `ROLE_VALUES` from `./rolePresets.ts`, contains no `VALID_AGENT_ROLES` string anywhere, and both role-validating routes actually call `ROLE_VALUES.includes(role)` (≥2 call sites).
- **Expected Result**: The import is present, `VALID_AGENT_ROLES` does not appear anywhere in `index.ts`, and at least 2 call sites validate against `ROLE_VALUES.includes(role)`.
- **Repeatable Unit Test**: Created (originally this generation, since renamed/strengthened by TASK-115's implementer): `host-server/rolePresets.test.ts` (`"host-server/index.ts's role validation imports and reuses rolePresets.ts's ROLE_VALUES (no local duplicate enum)"`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — re-verified live via `/uat-auto` (2026-08-15): full `rolePresets.test.ts` run, 14/14 pass including this (renamed) case.

### UAT-STATIC-001: `role-presets.json` has all 7 `ROLE_VALUES` keys, each a substantive fragment
- **Scenario**: This test reads the raw JSON file directly (not through `getRoleFragment`'s masking fallback chain) specifically because a role silently missing from the file would still pass UAT-EDGE-001 — `getRoleFragment` would quietly substitute the `generic` fragment and the "non-empty string" assertion would still hold, hiding the gap. This is the one case that would actually catch "6 of 7 keys shipped." Deliberately asserts only **structural** properties (key presence, string type, minimum length) — never on the fragment's prose content, since content is expected to be edited over time and an exact-text assertion would create false failures on legitimate copy changes.
- **Steps**: Read `host-server/role-presets.json` directly, `JSON.parse` it, and for each of the 7 `ROLE_VALUES`: assert the key is present (`hasOwnProperty`), the value is a `string`, and its length exceeds 40 characters (a length floor consistent with "a real 2-5 sentence fragment," not placeholder text like `"You are a frontend engineer."`).
- **Expected Result**: All 7 keys present, all string-typed, all above the length floor.
- **Repeatable Unit Test**: Created (new, this generation): `host-server/rolePresets.test.ts` (`'role-presets.json has all 7 ROLE_VALUES keys, each a substantive non-empty fragment (no prose-content assertion)'`).
- **Unit Test Command**: `node --import tsx/esm --test host-server/rolePresets.test.ts`
- [x] Pass — verified live.

### UAT-STATIC-002: `npx tsc --noEmit` passes cleanly and the full `host-server` suite is green
- **Scenario**: The task's own Acceptance Criteria require a clean typecheck; this generation additionally extended `rolePresets.test.ts` with 9 new cases (UAT-EDGE-003/004/007/008/009/010, UAT-INTEGRATION-001/002, UAT-STATIC-001), so the full suite must still be green, not just the new file in isolation.
- **Steps**: Run both commands below as-is.
- **Command**:
  ```bash
  cd /Users/davidtaylor/Repositories/tmux-conductor/host-server && npx tsc --noEmit
  ```
- **Expected Result**: Exits with no output and status 0 (zero type errors).
- **Repeatable Unit Test**: Not applicable: this command *is* the static gate itself.
- **Unit Test Command**: `npm test --workspace host-server`
- [x] Pass — verified live at generation: `npx tsc --noEmit` in `host-server/` exits clean (no output). `npm test --workspace host-server` (full suite, no filter): **78/78 pass, 0 fail** (a moving target across this session's concurrent sibling work — 68/68 at TASK-112's own tackle completion, 78/78 at generation time after this file's 10 additions to `rolePresets.test.ts` plus other agents' unrelated additions elsewhere in the suite; count observed live, not assumed). **Re-verified live via `/uat-auto` (2026-08-15)**: `npx tsc --noEmit` still clean; full suite now **79/79 pass, 0 fail** (one more unrelated addition landed since generation — still 0 fail, count still a moving target as anticipated above, not a regression).

---

## Coverage vs Acceptance Criteria

| Acceptance criterion | Covered by |
|---|---|
| `host-server/role-presets.json` exists with all 7 role keys, each a real, non-placeholder fragment | UAT-STATIC-001 |
| `getRoleFragment()` returns the correct fragment for each of the 7 roles and falls back to `generic` for anything else, never throwing | UAT-EDGE-001 (happy path), UAT-EDGE-002/003/004 (unrecognized/empty/null-undefined role) |
| `npx tsc --noEmit` passes cleanly in `host-server/` | UAT-STATIC-002 |
| The new `rolePresets.test.ts` cases pass | UAT-STATIC-002 (full-suite run) |
| *(headline invariant, beyond the task's own written criteria, per team-lead's explicit ask)* `getRoleFragment` never throws under file-level corruption (absent file, malformed JSON, non-object JSON, missing key, empty value) | UAT-EDGE-005 through UAT-EDGE-010 |
| *(integration seam, per team-lead's explicit ask)* `ROLE_VALUES` never drifts from the other two hand-maintained copies of the same enum | UAT-INTEGRATION-001, UAT-INTEGRATION-002 |

---

## Notes

- **14 of 14 cases are machine-verifiable and were executed live at generation time — 0 human-only, 0 UI cases.** This matches the expectation set for this task: TASK-112 is pure backend logic with no HTTP surface and no UI, so unlike this session's other UAT files (UAT-071, UAT-114) it doesn't fail-close to human walkthrough for anything.
- `uatGenerate.promoteTests` resolves (via the legacy `true` → `dedicated` mapping) to "write to a dedicated test directory," but `host-server/` visibly uses a sibling-file convention (`rolePresets.ts` ↔ `rolePresets.test.ts`, matching `git.ts` ↔ `git.test.ts`, `db.ts` ↔ `db.migration.test.ts`) with no dedicated `test/` directory anywhere in the project — TASK-112's own implementation already established the sibling file. Per the project layout taking precedence over the stored preference, all 10 new cases were added to the existing `host-server/rolePresets.test.ts` rather than creating a new dedicated-directory file.
- 6 of the 10 new cases (UAT-EDGE-003/004/007/008/009/010) and both UAT-INTEGRATION cases plus UAT-STATIC-001 were newly authored during this generation — team-lead's brief asked for edge cases beyond what TASK-112's own implementation had already covered (which was: happy path, unknown role, absent file, malformed JSON). The 6 file-corruption cases (UAT-EDGE-005 through 010) all reuse and extend the exact scratch-copy-in-`./tmp/`-plus-subprocess technique TASK-112's implementer (uatgen-070) established, via a small backward-compatible extension to the existing `makeScratchModule()` helper (added an optional `driverRoles` parameter so a test can compare two roles' output from one scratch environment — the mechanism UAT-EDGE-009/010 use to prove fallback occurred rather than merely asserting "non-empty").
- The real `host-server/role-presets.json` and `host-server/rolePresets.ts` were never renamed, deleted, or corrupted by any test in this file — verified post-run (`git status --porcelain` shows both untracked with no destructive change; a direct read confirmed all 7 keys still present and non-empty in the live file) and every corruption test operates exclusively on a `fs.mkdtempSync`-created scratch copy under `./tmp/`, cleaned up in a `finally` block.
