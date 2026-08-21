---
topic: "Does Claude Code (the CLI) or the Claude/Anthropic API expose a genuine, machine-checkable usage/quota-limit signal that a shell script could poll cheaply and reliably — as a replacement for tmux-conductor's broken USAGE_CHECK_CMD?"
slug: claude-usage-quota-signal
researched: 2026-08-15
---

# Primary Sources — Claude usage/quota signal research

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | claude-api skill | `shared/error-codes.md` (bundled `claude-api` skill, v2.1.233) | 2026-08-15 | `anthropic-ratelimit-*` headers and `retry-after` documented on 429 responses; confirms these describe API-key RPM/TPM limits, not subscription usage |
| S2 | web | https://sessionwatcher.com/guides/how-to-check-claude-code-usage | 2026-08-15 | `/usage` is run inside the Claude Code CLI for current session stats; distinct from a shell-invocable command |
| S3 | web | https://seawork.ai/en/blogs/claude-code-usage/ | 2026-08-15 | Two-clock model (5-hour rolling window + weekly cap); no published token-to-quota formula; community trackers explicitly "not the source of truth" |
| S4 | web | https://www.sitepoint.com/claude-code-rate-limits-explained/ | 2026-08-15 | Confirms `anthropic-ratelimit-*` headers present on every API response, not only 429s; lists the specific header names |
| S5 | web | https://github.com/anthropics/claude-code/issues/33820 | 2026-08-15 | Open issue on the vendor's own repo, titled "Expose API rate-limit response headers to hooks and status line scripts" — states Claude Code does not currently expose these headers to any external/scriptable surface. Decisive negative-capability evidence. |
| S6 | web | https://wmedia.es/en/tips/claude-code-usage-limits-5-hour-weekly | 2026-08-15 | Quotes Claude Code's own `/usage` disclaimer ("based on local sessions on this machine, does not include other devices or claude.ai"); confirms shared pool across claude.ai/Desktop/Claude Code |
| S7 | web | https://claudelog.com/claude-code-limits/ | 2026-08-15 | Confirms `/usage` command and `Settings → Usage` web dashboard as the two official surfaces; no CLI/script-facing equivalent documented |
| S8 | codebase | `host-server/usage.ts::extractUsageDeltas`, `::getUsageSessionStart` | 2026-08-15 | Confirms existing local transcript-parsing infrastructure already extracts token deltas per session — the substrate any future heuristic would extend |
| S9 | codebase (direct verification, same session) | `claude --help`, `claude auth status`, `claude auth --help`, `claude doctor --help` (installed v2.1.233) | 2026-08-15 | No `usage` subcommand exists; `auth status` returns login/tier only (`subscriptionType: "max"`, no quota fields); `doctor` is installation health only |

## Excerpts

### S2 — SessionWatcher: How to Check Claude Code Usage
https://sessionwatcher.com/guides/how-to-check-claude-code-usage
> Run /usage in the Claude Code CLI for current session stats, or visit the Anthropic dashboard.

### S3 — SeaWork: Claude Code Usage (2026)
https://seawork.ai/en/blogs/claude-code-usage/
> You pay a flat monthly seat and Anthropic meters shared usage across Claude Code and the Claude apps. The product does not publish a permanent "you get N million tokens" number for Pro or Max. ... Optional community trackers (ccusage-style CLIs, usage monitors, VS Code extensions) add history and local cost views but are not the source of truth for whether you can start another turn.

### S4 — SitePoint: Claude Code Rate Limits Explained 2026
https://www.sitepoint.com/claude-code-rate-limits-explained/
> Every API response from Anthropic includes the following rate limit headers (the exact set may vary by API version): anthropic-ratelimit-requests-limit: Maximum requests permitted per minute ... anthropic-ratelimit-tokens-reset: ISO 8601 timestamp when the token counter resets.

### S5 — GitHub anthropics/claude-code#33820
https://github.com/anthropics/claude-code/issues/33820
> Summary: The Anthropic API returns detailed rate-limit headers on every response (anthropic-ratelimit-tokens-remaining, anthropic-ratelimit-requests-remaining, anthropic-ratelimit-input-tokens-remaining, etc.), but Claude Code does not expose these to hooks or status line scripts.

### S6 — wmedia.es: Claude Code usage limits, demystified
https://wmedia.es/en/tips/claude-code-usage-limits-5-hour-weekly
> Your plan is one shared pool: what you spend on claude.ai, the desktop app, and Claude Code all goes to the same place. But the CLI's /usage is computed locally, and it says so itself: "based on local sessions on this machine, does not include other devices or claude.ai."

### S7 — ClaudeLog: Claude Code Limits
https://claudelog.com/claude-code-limits/
> Tracking: View reset timing via /usage command in Claude Code or Settings → Usage in Claude apps.

### S9 — Direct CLI verification (this session)
`claude --help` (installed v2.1.233), full `Commands:` list: `agents`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `mcp`, `plugin|plugins`, `project`, `setup-token`, `ultrareview`, `update|upgrade` — no `usage` entry. `claude auth status` output: `{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"dt@davidtaylor.codes","orgId":"...","orgName":"...","subscriptionType":"max"}` — no quota/remaining-usage fields.
