---
id: claude-subscription-usage-signal-gap
title: Claude Subscription Usage-Signal Gap
updated: 2026-08-15
sources:
  - ../../raw/research/claude-usage-quota-signal/index.md
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
