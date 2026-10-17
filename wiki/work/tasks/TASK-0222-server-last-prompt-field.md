---
id: TASK-0222
aliases: [TASK-0222]
title: "Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate"
status: pending-uat
created: 2026-09-20
updated: 2026-09-20
depends_on: [TASK-0220]
blocks: []
parallel_safe_with: []
uat: "[[UAT-0222]]"
tags: [agents, dashboard, hooks, host-server, sse, last-prompt]
---

# TASK-0222 — Read the hook sidecar's last_prompt in the host-server and expose agent.lastPrompt on the snapshot, both SSE builders and the change-diff predicate

relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
depends_on::[[TASK-0220]]

> **Roadmap**: ROADMAP-0027 Phase 2, item 2 ("Read the sidecar in the host-server and add `lastPrompt` to the agent snapshot, both SSE builders and the SSE change-diff predicate, with a parity test"). Research: `raw/research/last-user-message-capture/index.md` (Recommendation, step 2), `raw/research/terminal-typed-command-persistence/index.md`.
> **Scope**: HOST-SERVER ONLY. Do not touch anything under `frontend/` (the frontend `Agent` type and display are later ROADMAP-0027 tasks) and do not touch `hooks/` (the sidecar write is the sibling hook task, TASK-0221).
> **Collision note**: edits `host-server/index.ts` (the `Snapshot` type, `buildSnapshot`, the SSE connect replay, `pollAndDiff`), which TASK-0209 (`inGitRepo`), TASK-0211 (`pollAndDiff` predicate extraction) and TASK-0215 (clone payload) also edit. Sequence with those; do not parallelize. It also shares `host-server/agentDiff.ts` with TASK-0211 (see Step 3).

## Objective

Surface the exact last user-submitted prompt (persisted by the `UserPromptSubmit` hook as `last_prompt: { text, ts }` in `<stateDir>/<agent>.meta.json`) to every dashboard client as `lastPrompt: { text: string, ts: string } | null` on the agent snapshot. It must appear on the REST status snapshot (`buildSnapshot`), on BOTH hand-maintained SSE `agent-update` builders, and be part of the SSE change-diff predicate so a new prompt on an otherwise-idle agent actually produces an event. `activeTask` and its computation stay entirely untouched: it remains in the API and the status contract, and only the frontend display use of it is replaced by a later task.

## Approach

- **Reader in a new file, not `context.ts`.** `context.ts` already reads the same sidecar in `resolveTranscriptPath` (`host-server/context.ts` ~86–120, `<stateDir>/<agentName>.meta.json`, keyed by the tmux window name), but it is a busy file other tasks edit. A new `host-server/lastPrompt.ts` exporting `readLastPrompt(stateDir: string, windowName: string): LastPrompt | null` is collision-safe. Key by `agentWindowName(agent)` (`host-server/db.ts` ~33, the `wn` already computed in `buildSnapshot`), exactly as `resolveTranscriptPath`'s callers do, because the hook names the sidecar after the tmux window / `CONDUCTOR_AGENT_NAME`.
- **Defensive read.** Returns `null` on: missing file, unreadable file, invalid JSON, `last_prompt` absent, not an object, `text` not a non-empty string, `ts` not a string (or not parseable by `Date.parse`). Caps `text` at 2 000 chars as a belt-and-braces guard against a hand-edited or older-hook sidecar (the hook applies the same cap; if TASK-0220's storage rules settle on a different cap, use that number and export it as a named constant `LAST_PROMPT_MAX_CHARS`). Never throws.
- **Cheap on the 2 s tick.** `buildSnapshot` runs once per `statusPollMs` for every agent, so cache the parsed value per meta-file path keyed on `mtimeMs` + `size` from a `statSync` (re-parse only when the file changed). This mirrors how the context reader avoids re-parsing transcripts. Export a `__resetLastPromptCacheForTests()` so tests do not depend on filesystem timing.
- **Retained-until-replaced.** No age expiry and no clearing on idle: the value stays until the hook writes a newer one. This is the roadmap semantics; it also means the value survives a host-server restart (it lives in the sidecar, not in memory).
- **Shape parity across the three builders.** Bug 0006 (`wiki/work/bugs/archive/0006-role-badge-never-renders-sse-omits-role.md`) is the precedent: `role` was on `buildSnapshot` but silently missing from both hand-maintained SSE builders because the `Snapshot` type did not declare it. Declare `lastPrompt: LastPrompt | null` in the `Snapshot` interface's inline agent type first, so the compiler flags any builder that omits it, then add it to each site, then pin it with a parity test.
- **Placement in the SSE bodies.** Add `lastPrompt: agent.lastPrompt,` AFTER `usage: agent.usage,` / `inGitRepo` in both bodies and never between `worktreePath` / `branch` / `role`: `host-server/sseRolePayloadParity.test.ts` regex-asserts those three are adjacent in the periodic payload, and the connect-replay assertion allows only 600 chars between `sendSSE(reply, 'agent-update', {` and `role: agent.role,`.
- **Diff predicate.** Add `prev.lastPrompt?.ts !== agent.lastPrompt?.ts || prev.lastPrompt?.text !== agent.lastPrompt?.text` (compare both: two prompts can share a second-resolution `ts`, and the same text resubmitted must still bump the event because `ts` differs). Put it in the extracted `agentSnapshotChanged` predicate rather than growing the inline condition (Step 3).
- **One-shot payloads left alone.** The clone / spawn / project-create / rename hand-built `agent-update` payloads (`host-server/index.ts` ~1124, ~1189, ~1555, ~1601, ~2418, all `...ctx` spreads) are partial payloads that the frontend merges field-by-field; a brand-new agent has no prompt yet, and an omitted `lastPrompt` means "unchanged" to the merge. Do not add it there (TASK-0215 owns bringing those payloads to parity). State this in a code comment at the `Snapshot` interface.
- **CLAUDE.md.** Its Code layout / Core Scripts tables do not enumerate agent-snapshot fields (only route names), so no CLAUDE.md change is needed unless that has changed by implementation time; if it now lists fields, add `lastPrompt`.
- **Out of scope**: writing the sidecar field (TASK-0221, `hooks/`); the frontend `Agent` type, `lastPayload.ts` store, mirroring and display (later ROADMAP-0027 tasks); labeling typed-vs-dispatched; a new HTTP route (the value rides the existing agent payload).

## Steps

### 1. Reader module  <!-- agent: general-purpose -->

- [x] Create `host-server/lastPrompt.ts`: export `interface LastPrompt { text: string; ts: string }`, `LAST_PROMPT_MAX_CHARS` (2000 unless TASK-0220 decided otherwise), `readLastPrompt(stateDir: string, windowName: string): LastPrompt | null` and `__resetLastPromptCacheForTests(): void`.
  - Path: `path.join(stateDir, `${windowName}.meta.json`)`. `statSync` for `mtimeMs`/`size`; if the cached entry for that path matches, return the cached value; otherwise `readFileSync` + `JSON.parse`, validate `meta.last_prompt` (object, non-empty string `text`, string `ts` with `!Number.isNaN(Date.parse(ts))`), slice `text` to the cap, cache, return. Every failure path (stat, read, parse, shape) returns `null` and never throws; do not cache a failed read as permanent (a missing file is re-stat'd next tick, which is cheap).
  - Use the same import style as neighbouring modules (`import * as fs from 'fs'`, `import * as path from 'path'`).
- [x] Verify with Serena (`find_symbol resolveTranscriptPath`, `get_symbols_overview host-server/context.ts`) that the sidecar path convention and window-name keying still match before writing, since other agents edit these files concurrently.

### 2. Snapshot wiring in index.ts  <!-- agent: general-purpose -->

- [x] `host-server/index.ts`: import `readLastPrompt` and the `LastPrompt` type. Add `lastPrompt: LastPrompt | null` to the `Snapshot` interface's inline agent element type (search `activeTask: string | null; label: string | null`, ~684) BEFORE touching the builders, so `npm run typecheck` fails on any builder that omits it. Add a one-line comment that every per-agent field must be mirrored in both SSE builders (bug 0006) and that partial one-shot payloads intentionally omit `lastPrompt`.
- [x] `buildSnapshot` (~2650–2700): compute `const lastPrompt = readLastPrompt(conf.stateDir, wn);` next to `const activeTask = getActiveTask(...)` and add `lastPrompt,` to the returned per-agent object after `usage`. Do NOT modify `activeTask` or `getActiveTask`.
- [x] No-session fallback of `GET /status` (~826–838, the branch that hand-builds agent entries with `activeTask: null`): add `lastPrompt: null` (or read the sidecar with the agent's window name if that branch already has `conf`; a stale value is fine, `null` is acceptable and simplest). The type change from the previous step will force this site.
- [x] SSE connect replay (`GET /events`, ~2545–2580, the `for (const agent of prevSnapshot.agents)` loop): add `lastPrompt: agent.lastPrompt,` after `usage`/`inGitRepo`, keeping `role: agent.role,` within 600 chars of `sendSSE(reply, 'agent-update', {`.
- [x] `pollAndDiff` periodic broadcast (~2811–2838): add `lastPrompt: agent.lastPrompt,` after `inGitRepo: agent.inGitRepo,` (or after `usage`), keeping `worktreePath`, `branch`, `role` adjacent and in that order.
- [x] **Stale-sidecar cleanup on delete (added by the orchestrator, from TASK-0228's finding):** `DELETE /agents/:id` unlinks `<winName>.state` but not `<winName>.meta.json`, so an agent re-created with the same name would inherit the deleted agent's `last_prompt` (and the SSE mirror would write it back into localStorage). In that handler, also best-effort unlink `path.join(conf.stateDir, `${winName}.meta.json`)` (never throw; ignore ENOENT) next to the existing `.state` unlink, and invalidate the reader's cache entry for that path. Add a unit test (temp dir under `./tmp/`) proving the sidecar is removed and a later `readLastPrompt` returns `null`.

### 3. Change-diff predicate  <!-- agent: general-purpose -->

- [x] Check whether TASK-0211 has landed: use Serena `find_file agentDiff* host-server`.
  - **If `host-server/agentDiff.ts` exists** (TASK-0211 done): add `lastPrompt: { text: string; ts: string } | null` to `DiffableAgent` and the two comparisons above to `agentSnapshotChanged`; extend `host-server/agentDiff.test.ts` (Step 4) rather than creating a second file.
  - **If it does not exist yet**: create it exactly as TASK-0211 Step 1 specifies (same file name and exports `DiffableAgent` / `agentSnapshotChanged`, the exact current `pollAndDiff` predicate, structural types with no imports from `index.ts`) plus the `lastPrompt` clause, and replace the inline `if (!prev || … )` in `pollAndDiff` with `if (agentSnapshotChanged(prev, agent))`, keeping the transition-log and idle-dispatch blocks unchanged. Leave the worktree comparisons and the route-comment edit to TASK-0211, and add a note in TASK-0211's Dependencies section that TASK-0222 created the file so it should extend rather than recreate it. Do not reorder the broadcast body.
- [x] Do not add `lastPrompt` to `buildAgentStatusContract` or any status/evidence structure; it is a sibling of `activeTask`, not part of the contract.

### 4. Tests  <!-- agent: general-purpose -->

- [x] Create `host-server/lastPrompt.test.ts` (`node:test`, temp dir under `./tmp/`, never `/tmp`; use `fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'last-prompt-'))` and clean up): (a) valid sidecar → `{ text, ts }`; (b) missing file → `null`; (c) invalid JSON → `null`; (d) sidecar without `last_prompt` (only `transcript_path`/`model`) → `null`; (e) `last_prompt` with empty `text`, non-string `text`, missing `ts`, unparseable `ts`, and non-object value → `null` each; (f) text longer than the cap is truncated to exactly the cap; (g) unrelated meta keys are ignored; (h) cache: a second read of an unchanged file returns the same result without re-parse (spy via rewriting the file content while forcing the same mtime with `fs.utimesSync`, or assert via the reset hook), and a rewritten file with a new mtime/size is re-read; (i) a multi-line text and text containing unicode survive verbatim.
- [x] Extend `host-server/sseRolePayloadParity.test.ts` (or add a sibling `host-server/sseLastPromptParity.test.ts` if the file is being edited by another task) with source-regex checks in the same style: (1) the connect-replay `sendSSE(reply, 'agent-update', {…})` body contains `lastPrompt: agent.lastPrompt,`; (2) the periodic `broadcastSSE('agent-update', {…})` body contains `lastPrompt: agent.lastPrompt,`; (3) `buildSnapshot`'s returned object contains a `lastPrompt` property; (4) the `Snapshot` inline agent type declares `lastPrompt:`. Bound each regex to its own literal (e.g. `[\s\S]{0,1500}?` from the call opener) so a match in one builder cannot satisfy the other; confirm the tests are non-tautological by temporarily removing each occurrence and seeing the matching test fail, then restore.
- [x] `host-server/agentDiff.test.ts` (created by TASK-0211 or Step 3 here): add cases: `lastPrompt` null → set is `true`; same `ts` and `text` is `false`; different `ts` same `text` is `true` (resubmit of identical text); different `text` same `ts` is `true`; set → null is `true`; `undefined` vs `null` `lastPrompt` on both sides is `false`.
- [x] Do not hand-edit any real `logs/state/*.meta.json`; fixtures live only under `./tmp/`.

### 5. Verify  <!-- agent: general-purpose -->

- [x] `cd host-server && npm run typecheck && npm run lint && node --import tsx/esm --test lastPrompt.test.ts agentDiff.test.ts sseRolePayloadParity.test.ts transitionsLog.test.ts`, then the full `npm test` for regressions.
- [x] Confirm by Serena `find_referencing_symbols` on `Snapshot`/`buildSnapshot` consumers that no other builder of the per-agent snapshot shape was missed (the type change should have forced every site).
- [x] [DEFERRED-TO-UAT] Live round trip (`GET /status` and `GET /events` show `lastPrompt` after a real prompt is typed into a hook-installed agent; a new prompt on an idle agent produces an `agent-update` within one status tick) is a documented human UAT step, covered by the ROADMAP-0027 Phase 4 verification, not something an autonomous agent performs.

## Implementation record (2026-09-20)

Decisions taken autonomously:

- `host-server/agentDiff.ts` already existed (TASK-0211 landed), so Step 3 extended `DiffableAgent` (`lastPrompt?: {text, ts} | null | undefined`, optional so older fixtures type-check; `undefined` and `null` compare equal) and `agentSnapshotChanged`; `pollAndDiff` already called it.
- Reader exports beyond the spec: `capLastPromptText` (2000 cap = 1999 + `…`, drops a dangling high surrogate, idempotent) and `removeLastPromptSidecar(stateDir, windowName)` (best-effort unlink plus cache invalidation), which `DELETE /agents/:id` calls after the `.state` unlink. `DELETE /agents/:id/window` (close window only) intentionally keeps the sidecar because the agent survives.
- `last_prompt.prompt_id` (TASK-0219) and any other unknown keys are tolerated and ignored; `LastPrompt` stays `{ text, ts }`.
- Parity tests went in a new sibling `host-server/sseLastPromptParity.test.ts` (not the role file, which other work may touch). Mutation check done in memory (regexes run against `index.ts` with each occurrence removed): removing each of the 5 occurrences fails exactly its own test.
- The five partial one-shot `agent-update` payloads (spawn/clone/project-create/rename) are unchanged, documented in a comment above `interface Snapshot`.
- CLAUDE.md untouched (it does not enumerate snapshot fields).

Static gates: `tsc --noEmit` clean; eslint clean on every file I touched or created; targeted `node --test` (lastPrompt, agentDiff, sseRolePayloadParity, sseLastPromptParity, transitionsLog) 41/41; full `npm test` 400/400. Caveat: full `npm run lint` reports 85 `no-floating-promises` errors, all in `bgOutput.test.ts`, `bgRestart.test.ts` and `state.test.ts` (other in-flight tasks' files, not edited here; left alone).

## Files expected to be touched

- `host-server/lastPrompt.ts` (new)
- `host-server/lastPrompt.test.ts` (new)
- `host-server/index.ts` (`Snapshot` type, `buildSnapshot`, `GET /status` no-session fallback, SSE connect replay, `pollAndDiff` broadcast and predicate, `DELETE /agents/:id` sidecar unlink)
- `host-server/agentDiff.ts` (new only if TASK-0211 has not created it; otherwise edited)
- `host-server/agentDiff.test.ts` (new or edited, same rule)
- `host-server/sseRolePayloadParity.test.ts` (extended) or `host-server/sseLastPromptParity.test.ts` (new sibling)
- `CLAUDE.md` only if it has come to enumerate agent-snapshot fields

Explicitly NOT touched: anything under `frontend/`, anything under `hooks/`, `host-server/context.ts`, `getActiveTask` / `activeTask` logic, `~/.claude`.

## Dependencies

- TASK-0220
- Runtime data (not a build dependency): TASK-0221 writes `last_prompt` into the sidecar. This task's reader tolerates the field being absent (returns `null`), so it can be built and unit-tested before TASK-0221 lands, but the feature is only observable end to end once TASK-0221 is deployed and agents are restarted.
- Sequence with (do not parallelize; same files): TASK-0209 (`index.ts` status payload), TASK-0211 (`pollAndDiff` predicate, `agentDiff.ts`), TASK-0215 (clone payload parity).
- Feeds the later ROADMAP-0027 frontend tasks (`Agent` type / SSE mirroring into `lastPayload.ts`).

## Notes

Guardrails for whoever implements this:

- Never run `install-hooks.sh` against the real `~/.claude` and never edit `~/.claude/settings.json`. This task does not need either; the hook side is TASK-0221 and re-installing hooks is a human step in ROADMAP-0027 Phase 4.
- Never kill or restart tmux windows or sessions, and never kill or restart the running host-server or dev servers (`tsx watch` hot-reloads `host-server/` edits on its own; concurrent agents are editing the same tree). Verify with typecheck, lint and the targeted `node --test` runs only.
- Live-fleet verification (real agents, real sidecar writes, dashboard round trip) is a documented UAT step for a human, not something an autonomous agent performs.
- Temporary files and fixtures go under `./tmp/` (repo-local), never `/tmp` or `$TMPDIR`.
- Serena refuses gitignored paths and caches gitignore until `/mcp` reconnect: use Serena for `host-server/*.ts`, and `Read`/`Edit` for this markdown file and `CLAUDE.md`.
- The stored prompt may contain secrets; the reader must not log its value (no `console.log` of `text`), and nothing here should copy it into `transitions.jsonl` or `dispatch.jsonl`. Secret handling policy proper is TASK-0220's decision.
