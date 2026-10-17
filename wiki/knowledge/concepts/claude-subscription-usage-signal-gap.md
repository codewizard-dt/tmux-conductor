---
id: claude-subscription-usage-signal-gap
title: Claude Subscription Usage-Signal Gap
updated: 2026-09-19
sources:
  - ../../raw/research/claude-usage-quota-signal/index.md
  - ../../../raw/research/multi-agent-infrastructure-requirements/index.md
confidence: extracted
tags: [claude-code, usage-monitoring, api]
---

# Claude Subscription Usage-Signal Gap

There is currently no official, non-interactively-scriptable way to check how much of a Claude Max/Pro/Team **subscription**'s usage allowance remains. This matters for any local automation (like `uses::[[tmux-conductor]]`'s `USAGE_CHECK_CMD`) that wants to pause or throttle work before a subscription-managed Claude Code session hits its limit.

Two metering models exist and must not be conflated:
1. **API-key pay-as-you-go billing** — RPM/TPM limits by Build Tier, surfaced via `anthropic-ratelimit-*` HTTP response headers on every Messages API response.
2. **Subscription usage (Pro/Max/Team, used via Claude Code CLI)** — a shared pool across claude.ai, Claude Desktop, and Claude Code, metered on a 5-hour rolling session window plus a weekly cap, with no published token-to-quota conversion formula.

Only (1) has a documented, header-based programmatic signal, and it doesn't apply to (2). The only official view into (2) is Claude Code's `/usage` slash command — interactive-only, and self-described in-product as a local estimate ("based on local sessions on this machine"). An open upstream issue, `anthropics/claude-code#33820`, explicitly requests exposing rate-limit/quota data to hooks and status-line scripts and confirms this does not exist today.

**Practical implication**: any local tool wanting to react to subscription usage limits has exactly two honest options — (a) do not attempt automated checking (the safe default), or (b) build a best-effort heuristic on top of local transcript parsing (`extracts_from::[[Host Server]]`'s existing `usage.ts` machinery), clearly labeled as an estimate and never used to silently gate behavior. A command that pretends to check subscription usage but doesn't (e.g. calling a nonexistent CLI subcommand and grepping the output of an unrelated fallback prompt) is worse than no check at all — see `derived_from::[[claude-usage-quota-signal]]` for how this was discovered as a live bug in `tmux-conductor`.

**Revisit condition**: if `anthropics/claude-code#33820` (or an equivalent feature) ships, it becomes the first authoritative, scriptable signal for this and should replace any heuristic.

See `decided_by::[[DEC-0001-usage-check-hardening|DEC-0001#D1]]` for the formal decision record built on this gap.

> **Orchestration update (2026-09-19):** [[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]] finds that DEC-0001's "no automated checking" default was chosen at low concurrency and stops being safe as automated load rises: the 5-hour and weekly windows are one shared pool across Claude Code, chat and Cowork, so parallel agents (or an orchestrator's own LLM calls) can exhaust it invisibly, and practitioner reports of parallel headless fleets describe rate limits burning in minutes and retry loops spending heavily without per-invocation caps. Because no server-side signal exists, the only honest controls are **local and static** — a max-concurrent-agents cap and a per-window token budget computed from the local usage data `usage.ts` already records — never a fake quota check. One second-hand coding-specific figure (Agent Teams ≈7x tokens in plan mode) exists; how programmatic (`claude -p`/SDK) usage is billed relative to the subscription is reportedly unsettled. See [[LLM Orchestrator Runtime Options (tmux Agent vs. claude -p vs. Agent SDK)]].

relates_to::[[Infrastructure Requirements for a Multi-Agent Architecture (the Orchestrator Agent)]]
