---
topic: a way to ensure context window is always correct. Sonnet 5 context window is inaccurate
slug: context-window-accuracy
researched: 2026-08-15
---

# Primary Sources — Ensuring the dashboard's context-window percentage is always correct

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | web | https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5 | 2026-08-15 | Confirms Sonnet 5's 1M-token context window is the default and only option; auto-compact behavior; new tokenizer implications |
| S2 | web | https://code.claude.com/docs/en/model-config | 2026-08-15 | Confirms Sonnet 5 always runs at 1M context in Claude Code with no `[1m]` variant; documents the two configs (LLM gateway, `CLAUDE_CODE_DISABLE_1M_CONTEXT`) that still cap it at 200k; auto-compact threshold (~967K) |
| S3 | web | https://github.com/anthropics/claude-code/issues/84310 | 2026-08-15 | Anthropic's own Claude Code v2.1.222 independently shipped the same bug — Sonnet 5 evaluated on the "legacy Sonnet extended-context entitlement path," enforced (not just displayed) a 200K cap |
| S4 | web | https://github.com/anthropics/claude-code/issues/76155 (title only, not deep-read) | 2026-08-15 | Corroborating: "Claude Desktop app reports 200k context for Sonnet 5; CLI reports 1M (same account/model)" — same class of bug observed elsewhere in Anthropic's own tooling |
| S5 | web | https://openrouter.ai/anthropic/claude-sonnet-5 + general Models API docs, via web search | 2026-08-15 | `GET /v1/models` schema (`id`, `display_name`, `type`, `created_at`) has no `context_window` field — no live API exists to query a model's context size |
| S6 | web | https://platform.claude.com/docs/en/build-with-claude/context-windows | 2026-08-15 | "Context awareness" section: `<budget:token_budget>` and `<system_warning>Token usage: X/Y remaining</system_warning>` are API-injected at request time for context-aware models (Sonnet 5, Sonnet 4.6, Sonnet 4.5, Haiku 4.5) |
| S7 | codebase | `host-server/context.ts::modelContextLimit` (lines 344-351) | 2026-08-15 | The root-cause function: family-substring match, hardcodes only `opus` → 1M, comment asserts sonnet/haiku/fable fit in 200k |
| S8 | codebase | `host-server/context.ts::parsePaneTail` (lines 353-378) | 2026-08-15 | Existing higher-priority signal: scrapes an explicit `(N context)` annotation from the Claude Code pane banner when present |
| S9 | codebase | `host-server/context.ts::getAgentContext` (lines 388-499), specifically the `resolvedLimit`/`contextPct` computation at lines 495-498 | 2026-08-15 | Shows the percentage is clamped with `Math.min(100, ...)`, silently absorbing an over-limit reading into a maxed red bar instead of surfacing the wrong assumption |
| S10 | codebase | `conductor.conf` lines 134-139; `host-server/config.ts:173`; `frontend/src/components/AgentList.tsx:317` | 2026-08-15 | The three independent hardcoded `200000` fallbacks across conf, server, and frontend layers |
| S11 | local test | `grep -o "token_budget>[0-9]*" ~/.claude/projects/-Users-davidtaylor-Repositories-tmux-conductor/26d2a67b-bc89-49cd-861a-9a7a614f047b.jsonl` run against this session's own live transcript | 2026-08-15 | Negative result: only hits were verbatim quotes of S6's documentation example (`200000`) pulled in via an earlier WebFetch tool result — no genuine API-injected budget tag was found in the transcript, arguing against using the transcript as a source for the real injected value |

## Excerpts

### S1 — What's new in Claude Sonnet 5
https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5
> Claude Sonnet 5 supports the 1M token context window by default (1M tokens is both the default and the maximum; there is no smaller context variant), 128k max output tokens, adaptive thinking, and the same set of tools and platform features as Claude Sonnet 4.6...

### S2 — Model configuration (Claude Code docs)
https://code.claude.com/docs/en/model-config
> On the Anthropic API, Sonnet 5 always runs with the 1M context window. There is no 200K variant, no `[1m]` suffix to select, and no usage credits required on any plan. Sessions auto-compact before the window fills, at about 967K tokens by default; set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to choose a different threshold.
>
> Two configurations budget the window at 200K instead:
> * **LLM gateway**: when `ANTHROPIC_BASE_URL` points at a gateway, Claude Code can't verify 1M support. To use the full window, select Sonnet 5 (1M context) in the model picker, which maps to `sonnet[1m]`.
> * **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`**: holds sessions on every model with a native 1M window to a 200K window...

### S3 — GitHub issue #84310
https://github.com/anthropics/claude-code/issues/84310
> Claude Code v2.1.222 is incorrectly limiting Claude Sonnet 5 to a 200K context window instead of its native 1M context window. The `/context` command reports `42.2k/200k tokens` when it should show approximately 967K usable tokens... Sonnet 5 is being evaluated using the legacy Sonnet extended-context entitlement path instead of being recognized as a native 1M-context model... sessions genuinely fail with "Context limit reached" errors when approaching the reported 200K limit, demonstrating the restriction is enforced, not just reported incorrectly.

### S6 — Context windows (Claude Platform docs)
https://platform.claude.com/docs/en/build-with-claude/context-windows
> In the system prompt of every request, the API gives Claude its total context window:
> ```xml
> <budget:token_budget>200000</budget:token_budget>
> ```
> The budget matches the context window available to your request: 1M tokens for Claude Sonnet 5 and Claude Sonnet 4.6, and 200k tokens for Claude Sonnet 4.5 and Claude Haiku 4.5... After each tool call, the API gives Claude an update on its remaining capacity:
> ```xml
> <system_warning>Token usage: 35000/200000; 165000 remaining</system_warning>
> ```
