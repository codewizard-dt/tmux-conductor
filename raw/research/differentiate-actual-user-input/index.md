---
topic: "how to differentiate actual user input."
slug: differentiate-actual-user-input
researched: 2026-09-20
sources: [./sources.md]
---

# Research: Telling Genuine User Input Apart From Everything Else an Agent Receives

> Builds on [../last-user-message-capture/index.md](../last-user-message-capture/index.md) (Finding 7: the hook cannot tell typed from dispatched) and [../../../wiki/work/tasks/TASK-0219-verify-userpromptsubmit-payloads.md](../../../wiki/work/tasks/TASK-0219-verify-userpromptsubmit-payloads.md) (payload evidence). This report covers only what is new.
>
> **Executive summary.** `UserPromptSubmit` does **not** mean "a human typed this". Three independent third-party reports show it also fires for Claude Code's machine-injected `<task-notification>` messages [S9][S10][S11], and TASK-0219 never tested that case, so ROADMAP-0027's `last_prompt` (TASK-0221, already implemented) will store an XML blob as "the last message" whenever a background agent finishes *(inference from our code: `normalizePrompt` only unwraps pastes)*. There are two different questions and they need two different signals. **(1) Human-typed vs harness-injected** is answered by Claude Code itself: every transcript user record can carry `origin.kind` (`human`, `task-notification`, `peer`, …) and `promptSource` (`typed`, `system`, `sdk`) [S8][S1][S13][S14]. **(2) Human vs conductor-dispatched** cannot be answered by Claude at all, because `tmux send-keys` and a keyboard are the same PTY bytes [S2]; only the *sender* knows, and the conductor already writes a record before it types (`dispatch.jsonl`) [S3]. Recommendation: classify by elimination in two layers (Claude's `origin` first, the conductor's send ledger second), store the result as a `kind` next to `last_prompt`, and add a cheap prefix guard to the hook now so injected XML never becomes the "last message".

## Research Questions

1. Which sources put text into an agent's prompt, and which of them fire `UserPromptSubmit`?
2. What provenance does Claude Code itself record, and how reliable is it in this version?
3. Can the conductor tell its own injections (queue dispatch, Add Task dispatch, orchestrator enqueue) from a human, and what does it already record?
4. What is the cheapest correct design, and what should change in the ROADMAP-0027 plan?

## Current State (Codebase)

- **Hook side.** `hooks/lib/write-state.js::writeState` now persists `last_prompt {text, ts[, prompt_id]}` for every non-empty `UserPromptSubmit` prompt after `normalizePrompt` unwraps `<pasted_content>` (TASK-0221, `pending-uat`). It has no notion of who sent the text [S5].
- **Conductor send paths.** Queue dispatch goes `dispatchTaskToAgent` → appends a `dispatch.jsonl` record `{ts, agent, command, state, detection, queue, …}` → `sendDispatchToPane` → `sendTextToPane` (literal `send-keys` + delay + separate Enter; project-kind tasks send `/clear` first, which fires no hook) [S3][S2]. `monitor.sh` writes the same file for its own dispatches [S3]. Dashboard Direct Input goes through `sendDirectInput` (`POST /agents/:id/keys` and the terminal WebSocket) [S4].
- **Transcript.** The host-server already pins each agent's main transcript via the `.meta.json` sidecar (`context.ts::resolveTranscriptPath`) and reads its tail [S5].

## Key Findings

1. **`UserPromptSubmit` fires for messages the user never typed.** Reported on Claude Code 2.1.273: a finished background task is delivered "as a UserPromptSubmit hook event whose prompt body is a synthetic `<task-notification>` block", and "the assumption 'UserPromptSubmit == a human typed something' does not hold on Claude Code" [S11]; a second project measured it on the blocking path [S10]; an Anthropic issue reports the hook firing when a Task/subagent completes [S9]. TASK-0219 tested typed, slash, paste and dispatch, but not injected notifications, so this is a **gap in our evidence**, not a contradiction of it. Whether peer/teammate messages and queued prompts also reach the hook is **unverified**: this session's transcript has no hook-execution records to count [S1].
2. **Claude Code records provenance on the user record.** The SDK documents `origin.kind` ∈ `human | channel | peer | task-notification | coordinator | auto-continuation | unclassified`, and states that a user message with **no `origin` is unattributed** (before v2.1.210 an absent origin was treated as human) [S8]. Real records: `promptSource` is `typed` for ordinary typed prompts with `origin: {kind:"human"}` [S13]; a Monitor line arrives as `promptSource:"system"`, `origin.kind:"task-notification"` [S14].
3. **Measured in this session (CLI 2.1.278, pinned transcript).** Typed prompts: `origin.kind:"human"`, `promptSource:"typed"` (3). Slash commands typed by the user: `origin.kind:"human"`, `promptSource:null`, content wrapped as `<command-message>…<command-name>/x</command-name>` (4). **48 cross-session peer messages: `origin` null and `promptSource` null**, content starting `Another Claude session sent a message: <teammate-message …`. The `/clear` wrapper and `[Request interrupted by user]`: null/null [S1]. So (a) the positive test `origin.kind === "human"` correctly separates human from peer messages here, but (b) the CLI does **not** emit the documented `peer` kind for them in this version — an allow-list on `human` is safe, a deny-list on named kinds is not.
4. **`origin`/`promptSource` are imperfect.** A third-party corpus review found records where `origin.kind:"human"` and `promptSource:"sdk"` disagree (93), and treats a null `origin` as "unknown", not "confirmed non-human" [S12]. Use `origin.kind` as the primary test and `promptSource === "typed"` as corroboration only.
5. **Claude cannot separate a human from the conductor.** A single-line dispatch is byte-identical to a typed message and to the print-mode string [S2]; nothing in the payload names the sender. *(Not measured: what `origin` a tmux-injected prompt gets — expected `human`/`typed` because the TUI sees ordinary keystrokes; an inference to verify.)* Therefore the only sound source for "the conductor sent this" is the sender's own record, and the conductor already writes one **before** it types (`dispatch.jsonl`, with the exact `command` text) [S3].
6. **A join key exists but is unverified.** The hook payload carries `prompt_id` [S2] and transcript user records carry `promptId` [S1]. That they are the same value is plausible *(inference — not compared)*. The transcript record may not exist yet when the hook fires (the hook runs before processing), so classification that needs the transcript should happen lazily on the server, not inside the hook.
7. **Text-shape filtering is a weak but useful first line.** Community parsers conclude the transcript `type` names the channel, not the author, and that host wrappers (`<task-notification>`, `<system-reminder>`, `<command-name>`) are injected on the same channel [S14][S11]. A prefix guard costs nothing and stops the worst case (XML shown as the user's message) but it is a deny-list, so it will miss new wrapper shapes.
8. **Queued prompts and history recall are still open.** Pressing Enter while Claude works queues the message [S18]; community reports say queued text is delivered at the next pause, possibly as a system-reminder rather than a fresh prompt *(unverified for our version)*. Up-arrow recall (per working directory) submits the text as a normal prompt [S18], and TASK-0219 could not exercise it. Both need an empirical run before promising exactness.

## Constraints

- Only hook-capable agents have `prompt_id`/`origin`; Codex/Aider have neither, so they fall back to the ledger alone.
- The hook must stay best-effort, synchronous and tiny (it blocks the turn) [S5]; transcript reads belong in the host-server.
- Classification must never delete data the user chose to include: ROADMAP-0027 explicitly counts Direct Input, Add Task and queue-dispatched commands. The change is to *label* dispatch and *exclude* harness-injected text, not to hide dispatches.
- Agent identity is self-declared and there is no auth; the ledger is a correlation aid, not a security control.

## Solution Comparison

| Criteria | A. Prefix deny-list in the hook | B. Claude's `origin` via `prompt_id` → transcript (server-side) | C. Conductor send ledger (dispatch.jsonl correlation) | D. Do nothing |
|---|---|---|---|---|
| **Removes harness-injected text** | Partly (known wrappers only) | Yes (allow-list `origin.kind==='human'`) | No | No |
| **Separates human from dispatch** | No | No | Yes (match text + ts window, consume once) | No |
| **Works without a transcript** | Yes | No | Yes | — |
| **Fragility** | High: new wrapper shapes slip through | Medium: `origin` sometimes null/inconsistent [S12]; `prompt_id`↔`promptId` unverified | Medium: text normalization (paste wrapper, multiline), clock/window tuning | — |
| **Complexity** | Low (~10 lines, in TASK-0221's file) | Medium (new `promptOrigin.ts`, cached tail read) | Low-Medium (reader over an existing log) | None |
| **Non-hook agents** | Yes | No | Yes | — |
| **Codebase fit** | High | High (transcript pinning already exists [S5]) | High (log already written [S3]) | — |

## Recommendation

Layered classification by elimination, with a stored `kind`:

1. **Now, in the hook (tiny, low risk):** skip prompts whose first non-blank text starts with a known harness wrapper (`<task-notification`, `<system-reminder`, `<teammate-message`, `Another Claude session sent a message:`, `<local-command`) — do not overwrite `last_prompt`. Belt and braces only (Finding 7). Also persist `prompt_id` (already stored when present).
2. **Server-side classifier `host-server/promptOrigin.ts`:** for the current `last_prompt`, find the transcript record whose `promptId` equals `prompt_id`; `kind = 'human'` only if `origin.kind === 'human'` (corroborate with `promptSource === 'typed'`); any other or missing origin ⇒ `injected` or `unknown`. Cache by transcript mtime/size like the other readers.
3. **Dispatch correlation:** if a `dispatch.jsonl` record for the same agent has `command` equal to the normalized prompt within a short window (start with 30 s) and has not been consumed, mark `kind = 'dispatch'`. Order: injected → dispatch → human.
4. **Surface it:** `lastPrompt` gains `kind: 'human' | 'dispatch' | 'injected' | 'unknown'`. Display rule (keeps the confirmed scope): show `human` and `dispatch`; never show `injected`; render a small "queued" marker for `dispatch` so the human can see the difference. The localStorage store keeps `kind` alongside `source`.
5. **Empirical spike first (small, like TASK-0219, isolated `--settings`, private tmux):** (a) does the hook fire for a finished background task and for a peer message, and with what `prompt`; (b) is hook `prompt_id` equal to the transcript `promptId`; (c) what `origin`/`promptSource` a `tmux send-keys` prompt gets; (d) queued-while-busy and Up-recall behaviour; (e) image paste.

Risks and mitigations: `origin` null on real human prompts (use allow-list but map null ⇒ `unknown`, never hide it, show as human-unverified); dispatch text mismatch from normalization (compare after the same `normalizePrompt`); a human typing text identical to a just-dispatched task (accept: labelled `dispatch`, rare); transcript not yet flushed (classify lazily, retry on next poll).

Alternative if constraints change: if the spike shows `origin` is unreliable for tmux-typed prompts, drop layer 2 and rely on prefix guard + ledger only.

## Plan Changes for the Running ROADMAP-0027 Orchestration

- **Amend, do not reopen:** file a follow-up task for the hook prefix guard (touches `hooks/lib/write-state.js` + `hookLastPrompt.test.ts`, the same files as `TASK-0221`) — it is a real defect in a task already `pending-uat`, and `UAT-0221`/`UAT-0230` should gain a case for it.
- **New tasks:** the empirical spike; `promptOrigin.ts` classifier + `kind` on `lastPrompt` (server, snapshot, both SSE builders — same parity discipline as `TASK-0222`); dispatch correlation; frontend `kind`/badge; then UAT. These slot between Phase 2 and Phase 3 and change `TASK-0225`–`0227` (they should carry `kind`).
- **Do not start further `AgentList.tsx` tasks** (`0229`/`0230` verification wording depends on this) until the spike answers (a)–(c); `TASK-0229`'s script should assert that a `<task-notification>` prompt does not overwrite `last_prompt`.

## Findings From the Interrupted Assumption Audit (verified before the pivot)

Not part of this topic's recommendation but established with evidence and worth keeping:

- **Sidecar key parity — confirmed.** Spawn sets `CONDUCTOR_AGENT_NAME='${winName}'` where `winName = projectName-name` (`host-server/index.ts` spawn path; `scripts/conductor.sh`, `scripts/spawn.sh`), identical to `agentWindowName(agent)` used by the server read path [S6].
- **Rename drift — new risk.** `PATCH /agents/:id` (rename) renames the tmux window and the `<win>.state` file but **not** `<win>.meta.json`, and the running agent keeps its old `CONDUCTOR_AGENT_NAME`, so after a rename the hook keeps writing the old-named sidecar while the server reads the new name until the agent restarts [S6]. `lastPrompt` (and the context meter, which uses the same sidecar) go missing until restart.
- **Installed hooks are stale — expected.** `~/.claude/hooks/tmux-conductor/lib/write-state.js` still has the old sidecar merge without `last_prompt` [S5]; the feature is inert until a human re-runs `install-hooks.sh` and restarts agents. Whether `settings.json` registers the hooks was not checked (my shell probes were blocked).
- **SQLite id reuse — confirmed.** `agents.id INTEGER PRIMARY KEY` has no `AUTOINCREMENT` [S7]; SQLite documents that rowids of deleted rows may be reused without it [S15], so `TASK-0228`'s orphan sweep is justified.
- **`~/.claude/settings.json` +1 byte — cause undetermined.** Claude Code writes that file itself (first `/config` change) [S16] and has had races in its own settings writer [S17]; no before-copy exists, so the specific change cannot be characterised. Low risk, not resolved.
- **Hermetic live verification is feasible.** `scripts/verify-bg-link-retired.sh` already boots the real host-server on a private port with scratch conf/DB and a private tmux server, never contacting the live one [S19]; Vite reads `FRONTEND_PORT`/`PROXY_TARGET`/`BACKEND_PORT` [S20]. A scratch-`--settings` hook + isolated host-server + isolated Vite + Playwright (two tabs share `localStorage` and receive `storage` events) could close the manual UAT cases without touching the live fleet. Playwright MCP availability was not verified.

## Next Steps

- Decide whether to pause `TASK-0229`/`0230` until the spike runs (recommended).
- `/task-add` the hook prefix guard, the spike, the classifier (`kind`), and the frontend badge; `/roadmap-create`-style amendment of `ROADMAP-0027` (or a new roadmap) to carry them.
- Fold this report into the wiki: `/wiki-ingest raw/research/differentiate-actual-user-input/index.md` (auto-ingest is enabled for this run).
