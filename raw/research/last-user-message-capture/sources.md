---
topic: "how to capture and store the last command/ chat message that was actually sent by the user (maybe 'onEnter'?)"
slug: last-user-message-capture
researched: 2026-09-20
---

# Primary Sources — Capturing the Last Command / Chat Message the User Actually Sent

Builds on [../terminal-typed-command-persistence/sources.md](../terminal-typed-command-persistence/sources.md); sources already registered there (AgentList strip, `getActiveTask`, `LogTail` seams, `agentOrder.ts`, `useSyncExternalStore`) are not repeated except where re-read for new facts. Serena line numbers are 0-based and approximate; symbol names are the stable locator.

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `hooks/on-prompt-submit.js` | 2026-09-20 | The whole `UserPromptSubmit` hook is `require('./lib/write-state').writeState('busy', 'prompt-submit')` — no prompt handling |
| S2 | codebase | `hooks/lib/write-state.js::writeState` (L18–111) | 2026-09-20 | Parses full stdin JSON into `payload`; sidecar merge persists only `transcript_path`, `session_id`, `model`, `ts`; `payload.prompt` unused; best-effort, always `process.exit(0)` |
| S3 | codebase | `host-server/context.ts::resolveTranscriptPath` (~L88–100) | 2026-09-20 | Host-server already reads `<stateDir>/<agent>.meta.json` as the authoritative hook-written per-agent record |
| S4 | codebase | `host-server/state.ts::getActiveTask` (L743–763) | 2026-09-20 | `activeTask` = last `dispatch.jsonl` command only while busy/awaiting/stalled; dispatch log is the only current command source |
| S5 | codebase | `host-server/index.ts` — `activeTask` sites (~L689–751 `activeTaskRetained`, ~L2605 `getActiveTask(conf, wn, state)`, ~L2683 `prev.activeTask !== agent.activeTask`, ~L2764 SSE payload) | 2026-09-20 | Where a new agent field must be added: snapshot build, SSE builders, and the change-diff comparison; status contract already has `activeTaskRetained` |
| S6 | codebase | `frontend/src/components/AgentList.tsx` — `activeTask: string \| null` (~L47) and render sites (~L1141, ~L1249) | 2026-09-20 | Existing strip and sidebar-card render points a `lastPrompt` would reuse |
| S7 | codebase | `hooks/register-hooks.jq` (~L53–66) and `hooks/register-codex-hooks.jq` (~L34) | 2026-09-20 | `on-prompt-submit.js` is registered under `UserPromptSubmit` for both Claude Code and Codex |
| S8 | context7 | `/websites/code_claude` — "UserPromptSubmit input / when it runs" | 2026-09-20 | Payload = common fields + `prompt`; "runs when the user submits a prompt, before Claude processes it"; 30 s default timeout; `UserPromptExpansion` carries `expansion_type` `slash_command`/`mcp_prompt` |
| S9 | context7 | `/websites/code_claude` — Agent SDK TS/Python hook input types | 2026-09-20 | `UserPromptSubmitHookInput = { hook_event_name: "UserPromptSubmit"; prompt: string; session_title?: string }`; `UserPromptExpansionHookInput` fields |
| S10 | web | https://code.claude.com/docs/en/hooks | 2026-09-20 | Confirms UserPromptSubmit semantics, default 30 s timeout, output discarded on timeout, hooks fire in terminal/IDE/Desktop alike |
| S11 | web | https://blakecrosley.com/blog/claude-code-hooks-explained | 2026-09-20 | Secondary confirmation that "UserPromptSubmit carries `prompt`"; hooks in subagents additionally get `agent_id`/`agent_type` |
| S12 | web | https://developers.openai.com/codex/hooks and https://codex.danielvaughan.com/2026/04/15/codex-cli-hooks-complete-guide-events-policy-patterns/ | 2026-09-20 | Codex has a `UserPromptSubmit` command hook with JSON stdin; documented example reads `payload["prompt"]` |
| S13 | codebase | `~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/71364f71-a163-451a-9b07-7c137a63f865.jsonl` (this session's transcript, inspected with `jq`) | 2026-09-20 | Shape of `type:"user"` records: `isMeta:true` injected lines, string content for real prompts (with `promptId`/`origin`), array content for tool results (`toolUseResult`), slash commands as `<command-name>…` wrapper strings, `<local-command-caveat>` blocks |
| S14 | web | https://github.com/brandon-fryslie/slopspot-paste/pull/173 | 2026-09-20 | Independent finding that a transcript `type` names the channel not the author; hook feedback, skill bodies, subagent prompts, command output all arrive as `user` records |
| S15 | web | https://github.com/xtermjs/xterm.js/issues/2565 and https://hayageek.com/xtermjs-tutorial/ | 2026-09-20 | xterm.js has no `onEnter`; Enter is surfaced via `onKey` or as `\r` in `onData`; the tutorial pattern buffers chars and runs on `\r` (a self-written shell, not an app-owned input line) |
| S16 | codebase | `frontend/src/components/LogTail.tsx` — `new Terminal(` (~L337) and `enqueue` / `sendInput` (~L553); `frontend/src/lib/terminalWebSocket.ts::sendInput` | 2026-09-20 | Direct Input uses xterm + a single `enqueue()` seam that forwards keystrokes over WS/HTTP |
| S17 | codebase | `raw/research/terminal-typed-command-persistence/index.md` | 2026-09-20 | Prior recommendation (keystroke line-buffer → localStorage), its lossiness analysis, open product question (retained vs. cleared-on-idle) |
| S18 | serena-memory | `claude-code/hooks-reference` §2, §4, §7.7 | 2026-09-20 | Project reference: `UserPromptSubmit` per-event field `prompt`; "drain stdin, fail soft" hook conventions |
| S19 | web | https://www.ksred.com/claude-code-hooks-a-complete-guide-to-automating-your-ai-coding-workflow/ | 2026-09-20 | Claude Code snapshots hook configuration at startup for the whole session, so hook edits need an agent restart |

## Excerpts

### S19 — Hook config snapshot
https://www.ksred.com/claude-code-hooks-a-complete-guide-to-automating-your-ai-coding-workflow/
> Claude Code snapshots your hook configuration at startup and uses that snapshot for the entire session. Edits mid-session have no effect, which prevents any modification of hooks while the agent is running.

### S8 — Claude Code hooks reference (via Context7)
https://code.claude.com/docs/en/hooks
> UserPromptSubmit hooks receive standard session fields along with the prompt field containing the user's submitted text.

> Runs when the user submits a prompt, before Claude processes it. This allows you to add additional context based on the prompt/conversation, validate prompts, or block certain types of prompts.

> In addition to the common input fields, UserPromptExpansion hooks receive `expansion_type`, `command_name`, `command_args`, `command_source`, and the original `prompt` string. The `expansion_type` field is `slash_command` for skill and custom commands, or `mcp_prompt` for MCP server prompts.

### S9 — Agent SDK types
https://code.claude.com/docs/en/agent-sdk/typescript
```typescript
type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
  session_title?: string;
};
```

### S10 — Hooks reference (web)
https://code.claude.com/docs/en/hooks
> UserPromptSubmit hooks have a default timeout of 30 seconds for command, http, and mcp_tool types, shorter than the 600-second default for those types on most other events.

### S2 — `write-state.js::writeState` (verbatim excerpts)
```js
let payload = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw && raw.trim()) payload = JSON.parse(raw);
} catch (_err) { /* no stdin, or not JSON — payload stays null */ }
...
if (payload.transcript_path) meta.transcript_path = payload.transcript_path;
if (payload.session_id) meta.session_id = payload.session_id;
if (payload.model) meta.model = payload.model;
meta.ts = new Date().toISOString();
```

### S1 — `hooks/on-prompt-submit.js` (verbatim)
```js
#!/usr/bin/env node
require('./lib/write-state').writeState('busy', 'prompt-submit');
```

### S14 — Transcript attribution caveat
https://github.com/brandon-fryslie/slopspot-paste/pull/173
> A Claude Code session JSONL's type field says which channel a line arrived on, not who wrote it. Claude Code pushes everything it injects into the model's context down the same user channel the person types into: hook feedback, task notifications, slash-command expansions and their output, skill bodies, /compact carry-overs, subagent spawn prompts.

### S15 — xterm.js Enter handling
https://hayageek.com/xtermjs-tutorial/
> term.onData(e => { if (e === '\r') { // Enter key handleCommand(command.trim()); command = ''; // Reset command buffer } else if (e === '\x7F') { // Backspace key …

https://github.com/xtermjs/xterm.js/issues/2565
> Using the latest version of xterm.js 4.2.0 i want to be able to detect key events and pass them on the terminal, i am not able to detect when ENTER or ALT or SHIFT is pressed like i used to with older version 3.x.x

### S12 — Codex UserPromptSubmit
https://codex.danielvaughan.com/2026/04/15/codex-cli-hooks-complete-guide-events-policy-patterns/
> payload = json.load(sys.stdin)
> prompt = payload["prompt"]

### S13 — Local transcript inspection (jq, this session)
Distinct `type:"user"` record shapes observed: `{isMeta:true, message.content:string}` (caveat/injected), `{message.content:string, promptId, origin, turnOrigin}` (real prompt/slash-command wrapper: `"<command-name>/clear</command-name>…"`, `"<command-message>research</command-message>\n<command-name>/research</command-name>…"`), `{isMeta:true, message.content:array, turnCompanion}`, and `{message.content:array, toolUseResult, sourceToolAssistantUUID}` (tool results).
