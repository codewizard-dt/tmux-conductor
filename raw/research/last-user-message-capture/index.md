---
topic: "how to capture and store the last command/ chat message that was actually sent by the user (maybe 'onEnter'?)"
slug: last-user-message-capture
researched: 2026-09-20
sources: [./sources.md]
---

# Research: Capturing the Last Command / Chat Message the User *Actually Sent*

> Builds on [terminal-typed-command-persistence/index.md](../terminal-typed-command-persistence/index.md), which recommended reconstructing the command from the Direct Input keystroke stream (`LogTail.enqueue()`) into `localStorage`. This report covers only what is new: **an `onEnter` handler cannot tell you what was actually sent**, and there is a much better signal already wired into this repo. Claude Code's `UserPromptSubmit` hook fires *after* the app accepts a submission and hands over the exact `prompt` string on stdin [S8][S9]. tmux-conductor already installs a `UserPromptSubmit` hook (`hooks/on-prompt-submit.js`) whose shared `writeState()` already parses that payload — and then throws the prompt away [S1][S2]. Persisting it is a ~5-line change to the existing per-agent sidecar (`<agent>.meta.json`), which the host-server already reads [S3]. That yields an exact, server-side, reload/browser-independent "last message" that also covers queue-dispatched prompts, history recall, Tab-completion, paste and multi-line input — everything the keystroke mirror is lossy on. `onEnter`/keystroke capture drops to a fallback for agents without hooks.

## Research Questions

1. Is a UI-side `onEnter` handler a valid definition of "actually sent"? Where does the browser see Enter today?
2. Is there an authoritative "the agent accepted this message" signal, and what does its payload contain?
3. What does this repo already capture from that signal, and how would the last message reach the dashboard?
4. What are the alternative authoritative sources (transcript JSONL), and what are their pitfalls?
5. What are the gaps (slash commands, non-Claude agents, distinguishing typed vs. dispatched, secrets)?

## Current State (Codebase)

- **Where Enter exists in the UI.** Direct Input runs an `@xterm/xterm` `Terminal` (`LogTail.tsx`, `new Terminal(` ~L337), and every key/paste funnels through `enqueue(payload)` (~L553) → terminal WebSocket `sendInput` or HTTP `sendAgentKeys` [S10][S16]. That is the only `onEnter`-like seam; it emits keystrokes, not submissions.
- **A hook already fires on every submission and is already registered.** `hooks/on-prompt-submit.js` is a one-liner: `require('./lib/write-state').writeState('busy', 'prompt-submit')` [S1]. It is registered under `UserPromptSubmit` for Claude Code (`hooks/register-hooks.jq`) and — via the same script — for Codex (`hooks/register-codex-hooks.jq`) [S7].
- **The prompt is parsed and discarded.** `writeState()` reads all of stdin synchronously and `JSON.parse`s it into `payload`, then persists only `transcript_path`, `session_id` and `model` into `<STATE_DIR>/<agent>.meta.json` (merged with any prior sidecar) [S2]. `payload.prompt` is never touched.
- **The sidecar is already the host-server's hook→server channel.** `context.ts::resolveTranscriptPath` reads `<stateDir>/<agent>.meta.json` as the authoritative per-agent record [S3]. (Also the mitigation recorded in memory for agents sharing a workdir: key by agent, not workdir.)
- **Display pipeline for a "current command" already exists.** `getActiveTask()` returns the last `dispatch.jsonl` command only while `busy/awaiting/stalled` [S4]; it is computed in the poll loop, diffed for SSE (`prev.activeTask !== agent.activeTask`), and rendered in the detail-pane strip and sidebar card [S5][S6]. There is even an `activeTaskRetained` flag on the status contract [S5].

## Key Findings

1. **"Enter pressed" ≠ "message sent."** xterm.js gives you `onData` (which delivers `\r` for Enter) and `onKey`; the canonical tutorial pattern is "buffer chars, on `\r` run the command" — which is a *shell emulator you wrote yourself*, not a TUI that owns its own input [S15]. Here the TUI (Claude Code) owns the input line, so Enter can also mean: accept an autocomplete/slash-command suggestion, confirm a dialog choice, submit an empty line, or insert a newline in a multi-line editor *(inference — Claude Code TUI key semantics not verified against a primary source)*. The UI cannot know which happened.
2. **`UserPromptSubmit` is the "actually sent" event, and it carries the text.** Docs: it "runs when the user submits a prompt, before Claude processes it" and the payload adds a `prompt` field with the submitted text alongside `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` [S8][S9][S10]. The Agent-SDK type is `{ hook_event_name: "UserPromptSubmit"; prompt: string; session_title?: string }` [S9].
3. **Zero new plumbing needed on the hook side.** Because `writeState()` already has `payload`, capturing is `if (payload.prompt) meta.last_prompt = { text, ts }` inside the existing sidecar merge — and since only `UserPromptSubmit` carries `prompt`, no signature change is needed (other events leave the previous value in place) [S2]. Codex's `UserPromptSubmit` payload also exposes `prompt` (documented examples read `payload["prompt"]`), and this repo already registers the same script for Codex, so it likely works there for free [S7][S12] *(the Codex claim rests on docs/community examples, not a run against this repo)*.
4. **Hook-based capture covers exactly what keystroke mirroring can't**: queue dispatch (`send-keys -l` types into the same prompt), history recall (`Up`), Tab completion, cursor edits, paste, multi-line, and input from any client (a second browser, real tmux attach) [S2][S8]. It is server-side, so it survives reload and is identical across browsers — the reason the prior report's "localStorage" constraint stops being necessary.
5. **Transcript JSONL is a valid alternative but noisy.** In this session's own transcript, `type:"user"` records include injected meta lines (`isMeta:true`), tool results (array content with `toolUseResult`), a `<local-command-caveat>` block, slash commands wrapped as `<command-name>/…</command-name>…`, and real prompts (string content with a `promptId`/`origin`) [S13]. Community parsers confirm the `type` field names the *channel*, not the author — hook feedback, skill bodies, subagent prompts and command output all arrive as `user` records [S14]. Filtering is doable (`!isMeta`, string content, not `<command-…>`/`<local-command-…>` wrappers, not sidechain) but is heuristic and format-unspecified [S13][S14]; `context.ts` already pins the main transcript via the sidecar, so the plumbing exists [S3].
6. **Slash commands are a documented gap.** `UserPromptExpansion` (payload: `expansion_type: "slash_command" | "mcp_prompt"`, `command_name`, `command_args`, `prompt`) exists specifically for slash-command/MCP-prompt expansion [S9][S8]. The docs retrieved do not state whether `UserPromptSubmit` also fires for a typed `/command`; **this must be verified empirically** (dump one payload while typing `/clear` and `/research foo`) before promising "every command is captured" *(unverified)*.
7. **A distinction is impossible from the hook alone: typed vs. queue-dispatched.** The hook sees only the text. To label "typed by user" vs "dispatched from queue", correlate the text/timestamp with the latest `dispatch.jsonl` record for the window, or have the dispatcher stamp a marker [S4] *(design suggestion — inference)*.
8. **Timing/latency is fine.** The hook writes the sidecar at submit time, before model processing; the host-server poll loop (`pollAndDiff`, ~2 s) picks it up and SSE-diffs it [S5]. `UserPromptSubmit` has a 30 s default timeout and blocks model start until it returns [S10] — the write is sync and tiny, and `writeState()` is already best-effort/exit-0, so no added risk.

## Constraints

- Only Claude Code (and, per docs, Codex) has hooks; Aider and others do not → need a fallback [S7][S12].
- Hooks run at agent start from a snapshot; hook changes need agent restart to take effect [S19]. The installed copy lives in `~/.claude/hooks/tmux-conductor/`, so `install-hooks.sh` must be re-run after editing `hooks/lib/write-state.js` (CLAUDE.md, Key Design Decisions).
- `writeState()` must stay best-effort and must never throw or block the agent [S2].
- `prompt` can contain secrets or very large pasted content → cap length (suggest ≤ ~2 000 chars, first line preview) and keep it in the gitignored `logs/state/` dir; `dispatch.jsonl` already stores dispatched commands verbatim [S4].
- The config-vs-data split and "no new endpoint" preference from the prior report still hold: a new field on the existing agent payload, not a new route.

## Solution Comparison

| Criteria | A. `UserPromptSubmit` hook → sidecar `last_prompt` | B. Tail transcript JSONL for last real user record | C. Frontend keystroke mirror in `enqueue()` (prior report's option A) | D. Naive UI `onEnter` |
|---|---|---|---|---|
| **Approach** | Extend `writeState()` to persist `payload.prompt`; server reads sidecar, adds `lastPrompt` to agent payload | Server scans transcript for last non-meta, non-tool-result `user` record | Line-buffer reducer; commit on `Enter` to `localStorage` | On Enter, save whatever text was in a UI box |
| **"Actually sent" fidelity** | Exact — fires only on accepted submit | Exact but must filter injected records | Lossy (history/Tab/cursor/paste) | Poor — Enter ≠ submitted |
| **Covers queue-dispatched** | Yes | Yes | No (typed only) | No |
| **Survives reload / other browser** | Yes (server-side) | Yes | Same browser only | Same browser only |
| **Complexity** | Low (~5 lines hook + field plumb) | Medium (heuristic filter, large-file tail) | Medium | Low |
| **Non-Claude agents** | Codex likely; Aider no | No | Yes | Yes |
| **Codebase fit** | High — sidecar + `activeTask` pipeline exist | Medium — `context.ts` transcript pinning exists | High for `lib/` pattern | Low |
| **Risks** | Slash-command coverage unverified; secret in prompt | Undocumented format drift [S14] | Wrong/secret text stored | Wrong text stored |

## Recommendation

**Option A** as the primary mechanism; **Option C** retained only as the fallback for agents without a submit hook (Aider); B held in reserve as a cross-check if slash commands turn out not to fire `UserPromptSubmit`.

Implementation outline:
1. **Hook**: in `hooks/lib/write-state.js`, inside the existing `if (payload)` sidecar merge, add `if (typeof payload.prompt === 'string' && payload.prompt) meta.last_prompt = { text: payload.prompt.slice(0, 2000), ts: new Date().toISOString() }`. Add a hook test. Re-run `install-hooks.sh`.
2. **Server**: a small reader (beside `resolveTranscriptPath` in `context.ts`, or in `state.ts`) returning `last_prompt` from the sidecar; add `lastPrompt: { text, ts } | null` to the agent snapshot (`buildSnapshot` + both SSE builders — bug 0006 in the wiki is precedent for these drifting), and to the SSE change-detection comparison.
3. **Frontend**: extend the `Agent` type and render `lastPrompt` in the existing detail-pane strip/sidebar card. Decide product semantics (retained-until-replaced vs cleared-on-idle) — the sidecar makes "retained" free and keeps `activeTask` for the transient in-flight case.
4. **Empirical check first (5 minutes)**: temporarily dump the payload for a typed `/slash` command, a multi-line paste, an `Up`-recalled prompt and a queue dispatch to settle Finding 6 and Finding 7.
5. **Typed-vs-dispatched label (optional)**: compare against latest `dispatch.jsonl` record.

Risks & mitigations:
- *Slash commands not captured* → verify (step 4); if absent, subscribe `UserPromptExpansion` too (same script, new registration) or fall back to B.
- *Secrets/large prompts* → cap + local-only file; consider not surfacing beyond the dashboard.
- *Stale hook copy in `~/.claude/hooks/`* → re-run installer; agents must restart.
- *Three snapshot builders drift* → add a parity test (a `sseRolePayloadParity.test.ts` exists as a model).

Alternative if constraints change: if hooks cannot be used for an agent type, use C for that type only; if the UI needs the value before the poll tick (<2 s), have the `POST /agents/:id/keys` handler set an optimistic value on Enter and let the hook overwrite it with ground truth.

## Next Steps

- Run the 5-minute empirical payload check (step 4) to close the slash-command question.
- File a task: `/task-add extend UserPromptSubmit hook to persist last_prompt in agent sidecar and surface as agent.lastPrompt` (hook + server + strip), superseding the localStorage-first plan in the prior report for hook-enabled agents.
- Prior report's open product question (retained vs. cleared-on-idle) still needs a decision.
