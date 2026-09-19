---
id: TASK-0168
aliases: [TASK-0168]
title: "Update stale agent-status-observability wiki pages, then run a full audit of the shipped transitions.jsonl feature"
status: done
created: 2026-09-18
updated: 2026-09-18
depends_on: []
blocks: []
parallel_safe_with: []
uat: "[[UAT-0168]]"
tags: [observability, wiki, transitions-jsonl, roadmap-019, audit]
---

# TASK-0168 — Update stale agent-status-observability wiki pages, then run a full audit of the shipped transitions.jsonl feature

relates_to::[[transition-observability]]
relates_to::[[agent-state-determination]]
relates_to::[[monitor-sh-transition-emit-testability]]
relates_to::[[detect-agent-status-reason-mapping]]

## Objective

ROADMAP-019 (unified `logs/transitions.jsonl` agent-status-transition observability, via TASK-142/143/144/145) has fully shipped, but three wiki knowledge pages still describe parts of it as an open research question or an in-progress build. Fix the wiki first, then run a full comprehensive audit of the shipped feature — verifying the existing test/verify scripts actually pass, that the two independent emitters (host-server `pollAndDiff`, `monitor.sh`'s `is_idle()`) stay consistent, that the `DetectionReason` mapping is complete and correct against the live code, and that no sensitive pane-text is mishandled. Confirmed real defects get filed as new bugs via the existing bug lifecycle; a clean result is recorded as a completion note on this task, not a new file.

## Approach

Phase 1 (wiki correction) must land before Phase 2 (audit) starts, since the audit's own findings should be written against accurate pages rather than ones that still call the feature "unbuilt." Do not touch `raw/` — it is immutable; only `wiki/knowledge/**` pages, `wiki/index.md` (if a page's one-line summary changes meaningfully), and `wiki/log.md` are edited in Phase 1.

For the audit, reuse the audit tooling that already exists in the repo rather than writing new scripts:
- `scripts/verify-transitions-jsonl-emit.sh` (monitor.sh's bash-side `emit_transition_jsonl`/`pane_tail_json`)
- `host-server/transitionsLog.test.ts` (TS-side `appendTransitionLog`)
- `scripts/verify-collect-diagnostics-transitions-bundle.sh` (diagnostics bundle inclusion)
- `scripts/verify-transitions-jsonl-docs.sh` (CLAUDE.md/AGENTS.md/README.md doc-sync)

Any issue found in Phase 2 that represents a real defect (not just a documentation gap) gets filed with `/bug-file` against the relevant component, then linked back into this task's completion notes — do not hand-roll a bug file with `Write`.

## Audit Findings (2026-09-18)

- **Step 5 (verify/test scripts):** all 4 pass clean — `scripts/verify-transitions-jsonl-emit.sh` 10/10, `host-server/transitionsLog.test.ts` 7/7, `scripts/verify-collect-diagnostics-transitions-bundle.sh` 5/5, `scripts/verify-transitions-jsonl-docs.sh` 6/6. No `FAIL:` lines anywhere.
- **Step 6 (DetectionReason mapping cross-check):** CLEAN — all 18 return sites in `host-server/state.ts`'s `detectAgentStatus` (state.ts:324-439) match the `raw/research/detect-agent-status-reason-mapping/index.md` 18-row table byte-for-byte.
- **Step 7 (live transitions.jsonl + pane-text sensitivity + diagnostics bundle scope):** CLEAN — no credential-shaped patterns found in sampled `paneTail` fields (spot-check caveat noted, not a guarantee); `scripts/collect-diagnostics.sh` confirmed local-only (`./tmp/diagnostics/`), no upload/share step.

**Audit clean — no defects found, no bugs filed.**

Non-blocking follow-up (out of scope for this task, not filed as a bug or task): the research's suggested inline code comments at the two ambiguous override sites in `host-server/state.ts` — the busy→awaiting-dialog-closed revert (~line 411) and the idle→busy override (~line 418) — flagging that they intentionally fall under the generic `state-file` reason bucket, were never added. Behavior is correct; this is purely a documentation-in-code nicety a future contributor may pick up if desired.

## Steps

### 1. Update `wiki/knowledge/sources/monitor-sh-transition-emit-testability.md` <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Read the current page in full.
  - Its body currently frames "how to write a repeatable unit test for `emit_transition_jsonl`/`pane_tail_json`" as an open research question with a recommended-but-unbuilt resolution.
- [x] Confirm live in the repo that `scripts/verify-transitions-jsonl-emit.sh` implements exactly the recommended resolution: it extracts `emit_transition_jsonl`/`pane_tail_json` (and `emit_dispatch_jsonl`) out of the live `scripts/monitor.sh` file via `sed`/awk-style extraction into a throwaway harness with a stubbed `tmux`, and exercises JSON shape, null-handling for empty from/to/age fields, and write-failure resilience (missing parent dir never aborts the caller).
  - Also confirm `host-server/transitionsLog.test.ts` covers the TS-side `appendTransitionLog` equivalent.
  - Verified live: `bash scripts/verify-transitions-jsonl-emit.sh` → 10/10 PASS; `node --test host-server/transitionsLog.test.ts` → 7/7 pass.
- [x] Rewrite the page body: change the framing from "open question, here's the recommended resolution" to "resolved and shipped — here's what was built and where it lives," citing both `scripts/verify-transitions-jsonl-emit.sh` and `host-server/transitionsLog.test.ts` by path. Keep the "why neither existing precedent transferred directly" reasoning as historical context (it explains *why* this shape of harness was chosen) but mark it as resolved, not outstanding.
  - Update the `researched:` or add an `updated:` frontmatter field to today's date (2026-09-18).
  - Keep the existing `relates_to::` links; they remain valid.

### 2. Update `wiki/knowledge/sources/transition-observability.md` <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Read the current page in full.
  - It currently describes the fix ("a new `logs/transitions.jsonl` stream... mirrored by a bash-side emitter in `monitor.sh`'s `is_idle()`") in forward-looking "recommended fix is" language, as if not yet built.
- [x] Rewrite the relevant paragraph to past tense / shipped-state, confirming against `CLAUDE.md`'s "Unified transition observability (ROADMAP-019)" paragraph and the live code (`scripts/monitor.sh:22,435-541`, `host-server/index.ts:460`, `host-server/index.ts:2419`) that both emission paths exist and match the originally recommended design (host-server's `pollAndDiff` as primary, `monitor.sh`'s poll loop as the regex-fallback mirror, same pane-tail reuse).
  - Note explicitly that the host-server record and the monitor.sh record are NOT the same shape (host-server: `agentId`, `agent`, `from`, `to`, `reason`, `matchedPattern`, `stateFileAgeS`, `windowPresent`, `queuedTasks`, `paneTail`; monitor.sh: `agent`, `from`, `to`, `reason`, `stateFileAgeS`, `paneTail` — no `agentId`/`matchedPattern`/`windowPresent`/`queuedTasks`) — this is a real, permanent asymmetry a future consumer must handle, not a bug, but it was previously undocumented on this page.
  - Update `updated:` frontmatter to 2026-09-18.
  - Verified live: `appendTransitionLog` defined at host-server/index.ts:456-467, called from `pollAndDiff` around host-server/index.ts:2580; `scripts/monitor.sh:435-541` defines the bash-side `emit_transition_jsonl()`/poll-loop diff.

### 3. Update `wiki/knowledge/concepts/agent-state-determination.md` <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Read the current page in full.
  - It has two stale paragraphs: "**Confirmed still unbuilt as of 2026-09-13**" (about the transitions.jsonl wiring gap) and "**In progress as of 2026-09-13** (TASK-142)" (about the `DetectionReason` mapping work).
- [x] Confirm both TASK-142 (`wiki/work/tasks/archive/TASK-142-widen-detect-agent-status-reason.md`) and TASK-144 (`wiki/work/tasks/archive/TASK-144-monitor-sh-transitions-jsonl-mirror.md`) are archived/done, and TASK-143/145 similarly archived, confirming the full feature shipped.
  - Confirmed: TASK-142, TASK-143, TASK-144, TASK-145 all live under `wiki/work/tasks/archive/` with `status: done`.
- [x] Replace both stale paragraphs with a single "**Shipped as of 2026-09-18**" paragraph summarizing: `logs/transitions.jsonl` is live from both detectors, `detectAgentStatus()`'s 18 return sites are mapped onto the 8-value `DetectionReason` union per [[detect-agent-status-reason-mapping]], and point to [[transition-observability]] for the stream shape and [[monitor-sh-transition-emit-testability]] for its test coverage.
  - Update `updated:` frontmatter to 2026-09-18.

### 4. Sync `wiki/index.md` one-line summaries and log the wiki update <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Update the one-line summaries in `wiki/index.md`'s Sources/Concepts sections for the three pages touched in steps 1-3 if their old summary text quotes now-stale phrasing (e.g. "Confirmed still unbuilt", "In progress"). Keep summaries to one line each, matching the existing style.
  - Updated all 3: transition-observability, monitor-sh-transition-emit-testability, agent-state-determination — each rewritten from proposal/gap language to shipped-state.
- [x] Append one entry to `wiki/log.md`:
  ```
  ## [2026-09-18] task | TASK-0168 wiki correction
  Updated 3 stale agent-status-observability pages (monitor-sh-transition-emit-testability, transition-observability, agent-state-determination) to reflect ROADMAP-019/TASK-142/143/144/145 having shipped.
  ```

### 5. Run the existing verify/test scripts and record pass/fail <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Run `bash scripts/verify-transitions-jsonl-emit.sh` from the repo root; capture full output.
  - Result: 10/10 PASS.
- [x] Run the host-server test suite scoped to `transitionsLog.test.ts` (use this project's existing test runner invocation pattern, e.g. `npm test -- transitionsLog` from `host-server/` — check `host-server/package.json`'s `test` script first to get the exact invocation right rather than guessing a flag).
  - Real invocation: `npm test -- transitionsLog.test.ts` from `host-server/` (package.json's `test` script is `node --import tsx/esm --test`). Result: 7/7 pass.
- [x] Run `bash scripts/verify-collect-diagnostics-transitions-bundle.sh`; capture full output.
  - Result: 5/5 PASS (2 benign `curl: (7)` stderr lines from the harness's deliberately-unreachable liveness probe, not failures).
- [x] Run `bash scripts/verify-transitions-jsonl-docs.sh`; capture full output.
  - Result: 6/6 PASS.
- [x] For any script that fails or reports a `FAIL:` line, do not fix it inline yet — collect it for step 8's triage.
  - No failures found across all 4 scripts/suites — nothing to carry into Step 8's triage from this step.

### 6. Cross-check the DetectionReason mapping against live code <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Use `mcp__serena__find_symbol` to locate `detectAgentStatus` in `host-server/state.ts` with `include_body=true`.
  - Function now spans state.ts:324-439 (line numbers shifted since the 2026-09-13 research's cited 313-422, content unchanged).
- [x] Enumerate every `return` site inside the function body and the `reason`/`matchedPattern` value each one produces.
  - All 18 return sites enumerated with line/state/reason/matchedPattern — see full table in step-6 agent report (recorded in wiki/log.md at completion).
- [x] Compare the full list against the 18-row mapping table described in `raw/research/detect-agent-status-reason-mapping/index.md` (the wiki summary page cites this as the source of the definitive table — read the raw file for the actual per-row mapping since the wiki page only summarizes the key resolutions).
  - Byte-for-byte match, all 18 rows.
- [x] Flag any of: a return site whose reason doesn't match the table, a new return site added since 2026-09-13 that isn't in the table at all, or a documented reason value that no longer has a corresponding return site.
  - **Verdict: CLEAN — no discrepancies.** One non-blocking cosmetic note carried to Step 8: the research's recommended inline code comments at the two ambiguous override sites (busy↔awaiting revert at line ~411, idle→busy override at line ~418), flagging that they intentionally fall under the generic `state-file` reason bucket, were never added to `host-server/state.ts`.

### 7. Inspect a live transitions.jsonl and check pane-text handling <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] If a conductor session is already running locally (check via `ls logs/transitions.jsonl` and whether it has recent lines), inspect the tail of the real file. Otherwise, note that live inspection was skipped and rely on the unit/verify-script fixtures from step 5 instead — do not spin up a real tmux conductor session just for this audit.
  - `logs/transitions.jsonl` exists live, 1294 lines, ts range 2026-09-13T08:46:30Z–2026-09-19T03:05:25Z (this session's own ambient activity included). Inspected in place, nothing started/stopped.
- [x] Check that `paneTail`/pane-text fields in sampled records don't contain anything that looks like a credential, token, or secret (grep sampled lines for common patterns like `sk-`, `ghp_`, `AKIA`, `-----BEGIN`). This is a spot-check, not a guarantee — note the limitation explicitly in the findings.
  - Zero real matches for precise credential patterns (AWS/GitHub/Slack/Google key shapes, PEM headers, bearer/api_key/password patterns). Broad substring hits on "sk-" were all false positives (e.g. "task-", "roadmap 22"). Explicit caveat recorded: spot-check only, not a guarantee against every possible secret shape a pane could echo.
- [x] Confirm `scripts/collect-diagnostics.sh`'s bundling of `logs/transitions.jsonl` (per `scripts/verify-collect-diagnostics-transitions-bundle.sh`'s coverage) doesn't get shared/uploaded anywhere automatically — it's a local `./tmp/diagnostics/` bundle only, per `npm run diagnostics:bundle`'s documented behavior in [[Local Observability]]. Confirm this is still true by reading `scripts/collect-diagnostics.sh` directly rather than trusting the wiki page.
  - Confirmed by direct read: `OUT_ROOT="${OUT_ROOT:-./tmp/diagnostics}"`; only network call is an optional local `localhost:8788` curl; log files are `cp`'d locally; no upload/share/remote-host step anywhere in the script. Wiki claim still accurate.
  - **Verdict: CLEAN.**

### 8. Triage findings and file bugs for real defects <!-- agent: general-purpose -->
<!-- Updated: 2026-09-18 -->

- [x] Review everything collected in steps 5-7.
- [x] For each confirmed real defect (a verify script that actually fails against current code, a `DetectionReason` mismatch, a genuine pane-text leak risk that isn't just a documented and accepted trade-off), run `/bug-file` to create a proper `BUG-NNNN` entry with the required fields, rather than hand-writing the bug file.
  - No confirmed real defects found — nothing to file.
- [x] For anything that's a documentation/wiki gap rather than a code defect, fix it directly in the relevant wiki page (small `Edit`, not a new task) and note the fix in this task's own notes.
  - No wiki/documentation gap found beyond the Phase 1 corrections already made in steps 1-4.
- [x] If nothing fails and no defects are found, do not create any new file — record "audit clean, no defects found" directly as a note when this task is marked done (e.g. in the commit message or a short addendum under this task's Objective section via `Edit`).
  - Recorded in the new "## Audit Findings (2026-09-18)" section above. No new file created. One non-blocking, out-of-scope cosmetic follow-up noted there (missing suggested inline code comments in `host-server/state.ts`) — not filed as a bug or task.
