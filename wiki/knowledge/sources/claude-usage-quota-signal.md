---
id: claude-usage-quota-signal
title: Claude Usage/Quota Signal Research
updated: 2026-08-15
sources:
  - ../../../raw/research/claude-usage-quota-signal/index.md
confidence: extracted
tags: [claude-code, usage-monitoring, api]
---

# Claude Usage/Quota Signal Research

**No reliable, non-interactively-scriptable signal exists today** for a locally-running shell script to determine whether a Claude Max/Pro subscription (used via Claude Code CLI) is near or has hit its usage limit. This was researched to find a replacement for tmux-conductor's `USAGE_CHECK_CMD`, which had been calling the nonexistent `claude usage` subcommand (see [[usage-check-and-detection-bugs]] on `conductor/usage-check-and-detection-bugs`).

The Claude/Anthropic **API** does expose `anthropic-ratelimit-*` response headers on every Messages API response (requests and tokens, limit/remaining/reset) — but these describe API-key-based pay-as-you-go rate limits (RPM/TPM by Build Tier), a different metering model from a Max/Pro **subscription**'s session/weekly usage allowance. Claude Code's own `/usage` slash command is the official subscription-usage surface, but it is interactive-only (typed inside a live session, not a shell-invocable command) and is explicitly self-described as a local estimate ("based on local sessions on this machine, does not include other devices or claude.ai"). An open issue on `anthropics/claude-code` (#33820) confirms Claude Code does not expose rate-limit/quota data to hooks or status-line scripts — decisive negative-capability evidence that this gap is a real, currently-unaddressed product limitation, not a documentation-lookup failure.

`claude auth status` and `claude doctor` carry no usage data (verified directly: `auth status` returns login/subscription-tier only). No Admin/Organization usage-query API surfaced in the `claude-api` skill's cached documentation for this use case either. Community tools (SessionWatcher, ccusage-style trackers) approximate usage via local transcript parsing — the same technique `uses::[[Host Server]]`'s `host-server/usage.ts` already implements for token/cost tracking — but even their own authors disclaim it as "not the source of truth."

**Recommendation**: treat `USAGE_CHECK_CMD='true'` (no automated checking, already deployed) as the correct current state, not a stopgap. Revisit only if `anthropics/claude-code#33820` or an equivalent feature ships. Full findings: `raw/research/claude-usage-quota-signal/index.md`.

This research directly backs `decided_by::[[ADR-0001-usage-check-hardening|ADR-0001#D1]]`, the decision record documenting why `USAGE_CHECK_CMD='true'` was chosen over both the previous broken command and a rejected transcript-heuristic alternative.
