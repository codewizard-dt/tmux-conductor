---
id: TASK-0220
aliases: [TASK-0220]
title: "Decide the last-payload storage rules (ordering, length cap, multi-line display, secrets)"
status: done
created: 2026-09-20
updated: 2026-09-20
depends_on: []
blocks: []
parallel_safe_with: []
uat: ""
tags: [last-payload, decision, hooks, dashboard, roadmap-0027]
---

# TASK-0220 — Decide the last-payload storage rules (ordering, length cap, multi-line display, secrets)

relates_to::[[ROADMAP-0027]]
relates_to::[[hook-authoritative-last-prompt]]
relates_to::[[last-user-message-capture]]
relates_to::[[terminal-typed-command-persistence]]

> **Roadmap**: ROADMAP-0027 Phase 1, item 2 ("Decide the storage rules"). Research: `raw/research/last-user-message-capture/index.md`, building on `raw/research/terminal-typed-command-persistence/index.md`. Produces a **written decision, not production code.** The implementation items in ROADMAP-0027 Phases 2-3 consume it.
> **Collision note**: touches only this file and `wiki/knowledge/concepts/hook-authoritative-last-prompt.md`; no source files. Parallel-safe with every code task.

## Objective

ROADMAP-0027 stores each agent's last user-written payload in two places: server-side in the hook sidecar (`<stateDir>/<agent>.meta.json`, field `last_prompt: { text, ts }`) and browser-side in `localStorage` (`conductor:lastPayload:<agentId>`, value `{ text, ts, source: 'hook' | 'add-task' }`). Before Phase 2-3 code is written, fix the rules both stores and the display share, so the hook, the host-server, the frontend store and the two display sites (detail-pane strip and sidebar agent card in `frontend/src/components/AgentList.tsx`) cannot drift. Nobody could be asked, so the **recommended defaults below are the recorded decision**; they are cheap to reverse because they live in one hook line and one frontend helper.

## Approach

Facts this decision rests on (re-verify in Step 1, line numbers drift):

- `hooks/lib/write-state.js::writeState` (lines 19-112, 1-based, verified 2026-09-20) already `JSON.parse`s the whole stdin payload and merges `transcript_path` / `session_id` / `model` into the sidecar, then stamps a top-level `meta.ts`. `payload.prompt` is never read. Only `UserPromptSubmit` carries `prompt`, so a non-empty-string guard is sufficient and other events leave the previous `last_prompt` in place.
- The host-server already reads the same sidecar (`host-server/context.ts::resolveTranscriptPath`, lines 87-121), so `lastPrompt` needs no new endpoint.
- `frontend/src/lib/lastPayload.ts` does not exist yet (no file matches `lastPayload*` under `frontend/src`).
- `activeTask` is rendered at `AgentList.tsx` ~L1177-1183 (detail-pane strip, `text-[11px] ... truncate`) and ~L1285-1288 (sidebar card, `text-[10px] ... truncate`, `title={agent.activeTask}`); the payload replaces it in both. (Corrected 2026-09-20: earlier numbers ~L1164-1169 / ~L1272-1274 had drifted by about 13 lines.)
- `DELETE /agents/:id` (`host-server/index.ts` ~L1418) currently unlinks only `<winName>.state` (~L1456) and never `<winName>.meta.json`, so a re-created same-named agent would inherit the old sidecar's `last_prompt`. Rule (g) below closes this. The sidecar is keyed by the tmux window name the hook resolves as `AGENT_NAME` (`agentWindowName(entry)` server-side), not by the numeric agent id.
- The hook cannot tell typed input from queue-dispatched input (dispatch uses `send-keys -l` into the same prompt), so a queue dispatch arrives as a `hook`-source value, not a third source.
- `logs/state/`, `logs/` and `tmp/` are gitignored (`.gitignore` lines 215-219, 250).

Decision comparison for each rule (chosen option first):

| Rule | Chosen | Rejected alternatives |
|------|--------|------------------------|
| Ordering | Newest `ts` wins, tie goes to `hook` over `add-task` | Hook always wins (a fresh Add Task submit would be hidden for up to one 2 s poll tick, then also replaced by the same text: pointless flicker); browser always wins (loses exactness when history recall or another client submits) |
| Length cap | 2000 chars, both stores | No cap (a pasted file bloats the SSE payload every 2 s tick and `localStorage`'s ~5 MB quota); 500 chars (cuts real multi-paragraph prompts that the tooltip should show whole) |
| Multi-line | First non-empty line + ` …`; full capped text in `title` | Join lines with spaces (a pasted diff becomes an unreadable run-on); show all lines (breaks the single-line strip/card layout) |
| Secrets | No redaction, no masked-prompt detection | Regex redaction (false confidence, mangles legitimate text); skip capture while a password prompt is up (not reliably detectable from the hook, which fires only on accepted prompts to the agent, not on terminal password entry) |
| Slash commands | Store raw as submitted | Strip the leading `/` or expand the command (changes what the user sees vs. typed) |
| Empty prompts | Never overwrite | Overwrite with empty (erases the last real message on an accidental empty submit) |

## Decision

**Outcome: the recommended defaults below, recorded on 2026-09-20 in the absence of a live answer (autonomous session).** The implementation tasks for ROADMAP-0027 Phases 2-3 must encode exactly these rules (points a-g).

| # | Point | Rule |
|---|-------|------|
| a | Ordering across hook, Add Task submit and dispatch | **Newest `ts` wins.** Sources are `hook` (covers typed, history recall, paste, and queue dispatch, because the hook sees all of them) and `add-task` (browser submit time). Dispatch is not a separate source. On an exact `ts` tie the source order `hook` > `add-task` decides. Timestamps are ISO-8601 UTC strings (`new Date().toISOString()`); compare as parsed epoch milliseconds, not lexically, and treat an unparseable `ts` as oldest. Server and browser share one machine (single-user, fully local), so clock skew is not a design concern. |
| b | Length cap | **2000 characters total (UTF-16 code units, i.e. JS `.length`), applied in both stores.** Longer text is truncated to the first 1999 characters plus a single `…` marker, so the stored length is at most 2000; text of 2000 characters or fewer is stored untouched. The hook applies it when writing the sidecar; the host-server reader and `saveLastPayload` re-apply it defensively (idempotent: an already-capped value is not re-truncated). Do not split a surrogate pair at the cut (drop the dangling high surrogate, so the result may be 1998 characters plus `…`). |
| c | Multi-line display | **Strip and card show the first non-empty (trimmed) line, followed by ` …` when the text contains further non-empty lines.** The full capped text goes in the element's `title` tooltip. Implemented once as a shared helper (`firstLinePreview(text)`) in `frontend/src/lib/lastPayload.ts` so both display sites agree. Single-line overflow is handled by the existing CSS `truncate`. |
| d | Secrets | **No redaction and no masked-prompt detection.** A pasted or typed credential in a submitted prompt is stored verbatim (up to the cap). **Residual risk, stated plainly:** anything the user submits to an agent, including a secret, is written unencrypted to `logs/state/<agent>.meta.json` and to the browser's `localStorage`; `logs/dispatch.jsonl` already stores dispatched commands verbatim, so this adds no new class of exposure. Mitigations that remain: both locations are local, single-user and gitignored (`logs/`, `logs/state/`), the value is never sent off the machine, and it is overwritten by the next prompt. |
| e | Slash commands | **Stored raw, exactly as submitted** (e.g. `/clear`, `/research foo`). Whether `UserPromptSubmit` fires for a typed slash command is the separate Phase 1 dump item; if it does not, the `UserPromptExpansion` registration feeds the same field with the same rules. |
| f | Empty / whitespace-only prompts | **Never overwrite a stored value.** Guard in the hook (`typeof payload.prompt === 'string' && payload.prompt.trim() !== ''`), in the SSE-to-store mirror, and in `saveLastPayload` for Add Task submits. Stored text is otherwise not trimmed or normalised. |
| g | Lifecycle and API naming | **`DELETE /agents/:id` must unlink the agent's `<winName>.meta.json` sidecar** (beside the existing `<winName>.state` unlink, best-effort try/catch), so a re-created same-named agent does not inherit a stale `last_prompt`; the frontend store entry for that agent id is cleared on delete too (TASK-0228). This requirement is added to TASK-0222. Reconciled names for all implementing tasks: the shared first-line display helper is `firstLinePreview`; the store API takes `agentId: number` (callers pass `agent.id`, never `String(agent.id)`; the `localStorage` key is `conductor:lastPayload:<agentId>`); the stored-text cap is 2000 characters total (1999 characters plus an ellipsis marker at most). |

**Rationale.** The hook is the exact "actually sent" signal and needs no clock or source arbitration beyond "newest wins", which also lets an Add Task submit show instantly (before the ~2 s poll tick) and then be superseded only by something genuinely newer. A single 2000-char cap matches the value already recommended in the research, bounds every 2 s SSE agent payload and the `localStorage` quota, and is large enough that the `title` tooltip shows a real prompt whole. First-line display keeps the strip and card single-line and readable for pasted multi-line content. Secret handling is stated honestly rather than implemented weakly, because a submitted-prompt hook cannot see masked terminal prompts and regex redaction would give false confidence.

**Follow-up.** No new task is needed to record this. The ROADMAP-0027 implementation items (hook `last_prompt`, host-server `lastPrompt`, Add Task recording, `lastPayload.ts` store, strip and card display) each cite this Decision; `firstLinePreview` and the cap helper are part of the `lastPayload.ts` item. The sidecar-unlink-on-delete requirement (rule g) belongs to TASK-0222 and the store-clear-on-delete to TASK-0228.

## Completion

Closed as `done` on 2026-09-20 as a decision task (no product source change, no UAT). Step 1 found only line-number drift plus the missing sidecar unlink on agent delete; both are recorded above (Approach corrections, rule g).

## Steps

### 1. Verify the facts the decision cites  <!-- agent: Explore -->

- [x] Re-confirm with Serena (not grep) that `hooks/lib/write-state.js::writeState` still merges into `<agent>.meta.json` and does not read `payload.prompt`; `host-server/context.ts::resolveTranscriptPath` still reads the sidecar; `frontend/src/lib/lastPayload.ts` does not yet exist; `AgentList.tsx` still renders `activeTask` in the strip and the sidebar card. Correct any line numbers or names in `## Approach` that drifted.

### 2. Record the decision  <!-- agent: general-purpose -->

- [x] Confirm the `## Decision` section above is present and covers points a-f, the rejected alternatives and the rationale (it is authored by this task; adjust only if Step 1 found drift). Do not edit `wiki/work/roadmaps/ROADMAP-0027-last-user-payload-per-agent.md`'s checklist here; the orchestrator ticks it.
- [x] `wiki/knowledge/concepts/hook-authoritative-last-prompt.md`: append a short `## Storage rules` subsection stating rules a-f in two or three sentences each at most, with `derived_from::[[TASK-0220]]`, and bump `updated:` in its frontmatter. Keep the page atomic (one concept) and do not contradict its existing "text capped ~2 000 chars" wording; make it consistent (2000 chars including the ellipsis marker).

### 3. Close out  <!-- agent: general-purpose -->

- [x] Flip this task to `done` per `wiki/work/tasks/lifecycle.md` (decision task: no UAT, no code). The orchestrator handles `wiki/work/tasks/index.md`, `wiki/log.md`, `wiki/hot.md` and the ROADMAP-0027 checkbox, so do not edit those in this task if it is being run under an orchestrator; otherwise drop the index line, tick the roadmap item and append a log entry yourself.

## Files

- `wiki/work/tasks/TASK-0220-last-payload-storage-rules-decision.md` (this file)
- `wiki/knowledge/concepts/hook-authoritative-last-prompt.md`

No `host-server/`, `hooks/`, `frontend/` or `scripts/` files are touched.

## Dependencies

None.

Soft links (not blocking): the Phase 1 payload-dump task settles whether slash commands fire `UserPromptSubmit` (rule e says "store raw either way"); ROADMAP-0027 Phase 2-3 implementation tasks should list `TASK-0220` in `depends_on` so they inherit these rules.

## Notes

Guardrails for whoever implements this task, and for the ROADMAP-0027 work it feeds:

- Never run `install-hooks.sh` against the real `~/.claude` and never edit `~/.claude/settings.json`. This task needs neither; later hook tasks must test the hook with a fixture `CONDUCTOR_STATE_DIR` under `./tmp/`, not the installed copy.
- Never kill or restart tmux windows or sessions, and never kill or restart the running host-server or dev servers (`make dev`); other agents are working in them concurrently.
- Live-fleet verification (re-running the installer, restarting agents, typing into a live agent and reloading the page) is a documented UAT step for a human to perform, not something an autonomous agent does.
- Temporary files go in `./tmp/`, never `/tmp` or `$TMPDIR`.
