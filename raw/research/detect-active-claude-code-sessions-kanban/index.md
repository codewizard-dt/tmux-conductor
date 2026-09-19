---
topic: is there a way to detect all active claude code sessions and then show each session in the kanban?
slug: detect-active-claude-code-sessions-kanban
researched: 2026-09-13
sources: [./sources.md]
---

# Research: Detect all active Claude Code sessions and show each in the kanban

> Yes. The Claude Code CLI already exposes a documented, scriptable command — `claude agents --json` — that prints every active session on the machine (interactive and background) as a JSON array with `pid`, `cwd`, `name`, `sessionId`, `kind`, and a live `status`/`state`. This is a strictly better data source than tmux-conductor's current "registered agent" model, which only tracks sessions explicitly added to its own SQLite `agents` table and spawned into a tmux pane it controls. The recommended change adds a host-server poller that shells out to this command, correlates results against the existing `agents` table by `cwd`, and renders unmatched sessions as a new **read-only "Detected" section** in the existing kanban (`AgentList.tsx`) alongside the current Attention/Busy/Ready columns — without touching the existing dispatch/hook machinery for agents tmux-conductor itself manages.

## Research Questions
- Does Claude Code expose any way to list every active session on the machine, not just ones inside one project/cwd?
- What does tmux-conductor track today, and where would a "detect any session" feature plug in?
- Is there a live liveness/status signal per session, or only recency of a transcript file?
- What would it take to surface a detected-but-unmanaged session in the existing kanban UI?
- What are the risks (stability, privacy, control-loop gaps) of building on this?

## Current State (Codebase)

tmux-conductor's dashboard kanban (`frontend/src/components/AgentList.tsx:1022-1037`, `COLUMNS`) only renders rows from the `agents` array returned by the host-server's `GET /api/status` snapshot (`host-server/index.ts::buildSnapshot`). That array is sourced entirely from the SQLite `agents` table (`host-server/db.ts::Agent` — `id, name, workdir, launchCmd, projectId, worktreePath, branch, role`), populated only when a user explicitly registers an agent (`createAgent`) and it gets spawned into a tmux window (`spawnAgentWindow`) or a plain pane via `scripts/conductor.sh` / `scripts/spawn.sh`. There is **no discovery step** — an ad-hoc `claude` session started in a different terminal, a different tmux session, an IDE integrated terminal, or a background/cloud session is completely invisible to tmux-conductor today.

Model/context data for a *registered* agent is derived best-effort from `~/.claude/projects/<encoded-cwd>/*.jsonl` transcripts (`host-server/context.ts::resolveTranscriptPath`) — either from an exact `transcript_path` written by tmux-conductor's own hooks into a per-agent sidecar (`<agent>.meta.json`), or, absent that, by picking the newest `*.jsonl` by mtime in the workdir-derived project directory. This derivation is explicitly a fallback ("best-effort... any failure yields null") and cannot discover a session it doesn't already have a registered `agentName`/`workdir` for — it can only enrich an agent that already exists in the kanban.

tmux-conductor's Claude Code hooks (`hooks/on-session-start.js`, etc., via shared `hooks/lib/write-state.js`) are installed **globally** into `~/.claude/settings.json` by the repo-root `install-hooks.sh`, so they technically fire for *every* Claude Code session on the machine, not just ones spawned by `conductor.sh`. However, `write-state.js` requires `CONDUCTOR_AGENT_NAME`/`CONDUCTOR_STATE_DIR` env vars (only set by tmux-conductor's own spawn scripts) or, failing that, falls back to `tmux display-message -p '#W'` for the window name and a hardcoded default `STATE_DIR` (`/conductor-state`) that is not created/writable outside a container context. In practice this means the existing hook mechanism, as coded today, does **not** already give tmux-conductor a working global session registry — it silently no-ops for any session it didn't spawn itself.

## Key Findings

**F1 — `claude agents --json` is a documented, stable, machine-wide session listing command.** Verified directly against the installed CLI (`claude agents --help`): `--json` "Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)." `--all` additionally includes completed background sessions; `--cwd <path>` filters to sessions started under a directory [S1]. Running it live on the research machine returned 14 concurrent sessions spanning 6 different project directories and both `interactive` and `background` kinds, e.g.:
```json
{"pid":8995,"cwd":"/Users/davidtaylor/Repositories/bootstrap-claude","kind":"interactive",
 "startedAt":1789017086346,"sessionId":"11984a21-...","name":"bootstrap-claude-bc","status":"busy"}
```
Fields observed: `id` (background sessions), `pid` (interactive/some background), `cwd`, `kind` (`interactive`|`background`), `startedAt` (epoch ms), `sessionId`, `name` (human/derived label), `status` (`idle`|`busy`, interactive) and/or `state` (`working`|`blocked`, background) [S1].

**F2 — There's also an internal, per-process file-based registry, but it's undocumented.** `~/.claude/sessions/<pid>.json` (one file per live session, world-readable, keyed by OS pid) carries a superset of fields plus `status`, `updatedAt`/`statusUpdatedAt`, `messagingSocketPath` (a Unix socket for IPC), `peerProtocol`/`peerFeatures`, and `bridgeSessionId`. Cross-checked every entry against `ps`/`kill -0` on the research machine: all 14 files corresponded 1:1 to live PIDs with no stale entries, implying the CLI's own daemon (`~/.claude/daemon/roster.json`, `daemon.lock`, `daemon.status.json`) garbage-collects the directory on process exit [S2]. This is clearly the internal implementation `claude agents --json` is itself built on — it should be treated as a private format that can change without notice between CLI versions, not integrated against directly.

**F3 — Claude Code's own multi-agent tooling (the `ListAgents`/`SendMessage` tool surface available inside a session) already renders this exact same data as a live "kanban-like" peer list**, including tmux pane coordinates for sessions it can trace into a tmux window (e.g. `tmux conductor:@1.%1`) and "Remote Control"/cloud sessions with an `offline` status distinct from local ones. This is UI-tool-level correlation on top of the same session registry (F1/F2), not something exposed by `claude agents --json` itself — the JSON output has no tmux-location field. Replicating the tmux-pane linkage in the host-server would need a separate `tmux list-panes -a` walk correlating `pane_pid`'s descendant processes to a `claude` session pid *(inference — no primary source, this is standard process-tree correlation, not a documented Claude Code feature)*.

**F4 — No official `SessionEnd`-driven registry is needed** — F1/F2 show Claude Code already maintains one internally and exits it out via `claude agents --json`. Building a parallel registry via `SessionStart`/`SessionEnd` hooks (as tmux-conductor's *own* per-agent `.state` files already do, just scoped to registered agents) would be redundant and reintroduce the exact "stale entry after a crash/SIGKILL" class of bug that a battle-tested, daemon-maintained roster already avoids.

## Constraints

- Any integration must be **best-effort and fail soft**, matching the existing pattern in `context.ts` (null fields on any parse/exec failure so the UI just hides the affected data) — `claude agents --json` output shape is not covered by semver guarantees the same way public docs are, and correlating tmux panes involves extra process-tree work that can legitimately fail.
- A discovered session has **no known tmux pane by default** (only `pid`/`cwd`, not a pane coordinate), so it cannot be driven through the existing `send-keys`/`dispatch.sh` control path without extra correlation work (F3) — it must initially be **read-only** in the kanban.
- Surfacing every Claude Code session on the whole machine is a privacy/scope question: today the dashboard only ever shows work the user explicitly registered in *this* project's SQLite DB. A "Detected" section would, by default, reveal cwd/status for **every unrelated project** the user has open (per the live sample: `davill`, `cryptwiz_py`, `site_goodhealth`, `bootstrap-claude`, `workout-tracker`, alongside `tmux-conductor` itself) — this likely wants a scope filter (e.g. `--cwd <root>` or a config-level allowlist of directories) rather than showing everything unconditionally.
- `claude` must be resolvable on `$PATH` from the host-server process — true in this dev environment but should be treated as an optional feature that degrades gracefully (e.g. binary missing → detected-section simply empty) per `CLAUDE.md`'s general local-only, no-daemon architecture.

## Solution Comparison

| Criteria | A. Shell out to `claude agents --json` | B. Parse `~/.claude/sessions/<pid>.json` directly | C. Extend the existing hook/state-file mechanism to be truly global |
|---|---|---|---|
| **Approach** | Poll (or on-demand fetch) via `execFile('claude', ['agents','--json'])`, cache briefly, correlate by `cwd` | Glob the per-pid JSON files, verify liveness with `kill(pid,0)` | Fix `write-state.js`'s default `STATE_DIR`/agent-name fallback so hooks meaningfully record state for *any* Claude session, then scan that directory |
| **Pros** | Documented, stable public contract; zero reverse-engineering; gives `status`/`state` for free; works for non-tmux sessions too | No subprocess spawn per poll; same data, slightly lower latency | Reuses 100% of existing infra (`monitor.sh`, `.state` files); no new dependency on the `claude` binary |
| **Cons** | Small subprocess cost per poll (mitigate with a TTL cache, mirroring the existing `CODEX_SESSION_SCAN_TTL_MS` pattern in `context.ts`) | Undocumented internal format (F2) — could silently change or move between CLI versions with zero warning | Still needs a filesystem scan across *all* project dirs since it isn't cwd-scoped by a caller; doesn't natively expose `busy`/`idle` for sessions with no matching workdir hook install; more code to build and maintain for something the CLI already gives you |
| **Complexity** | Low | Low-Medium (extra liveness/pid-reuse guarding) | Medium (touches shared hook code every future Claude Code session on the machine depends on) |
| **Dependencies** | `claude` CLI on `$PATH` (already required by this whole project) | None beyond fs access | None beyond fs access, but risks regressing hook behavior globally |
| **Codebase fit** | Slots next to `getCodexAgentContext`'s existing "scan a well-known directory on a TTL cache, fail soft" pattern | Same shape as A but reading a private path instead of a public command | Fits the "state via files" hook pattern (`claude-code/hooks-reference` memory §7.2) but expands its blast radius to every session on the machine, which the memory's own §7.7 ("a hook that crashes the harness... is worse than no hook") flags as exactly the kind of change to be conservative about |
| **Maintenance** | Tracks Claude Code's own documented CLI surface — lowest ongoing burden | Must be re-verified against every CLI upgrade | Ongoing burden of keeping a second, parallel session-liveness system in sync with the first-party one |

## Recommendation

**Recommended: Option A — shell out to `claude agents --json`.** It is the only approach backed by an explicit, documented CLI contract ("for scripting; does not require a TTY") rather than an internal file format, and it already reports the live `status`/`state` field the kanban needs, with no additional plumbing.

**Implementation outline:**
1. `host-server`: add a small module (mirroring `context.ts`'s `listCodexSessions`/TTL-cache shape) that runs `execFile('claude', ['agents', '--json'])` on a short TTL (e.g. 3-5s, refreshed by the existing status-poll loop), parses the array, and fails soft to `[]` on any error (binary missing, non-zero exit, bad JSON).
2. Correlate each returned session's `cwd` against the `workdir` column of registered `agents` (and optionally `projects`) rows. Sessions that match an existing registered agent are **suppressed** from the new section (they're already a tile); everything else becomes a `DetectedSession` entry: `{ pid, cwd, name, status, kind, startedAt }`.
3. `buildSnapshot`/the `/api/status` payload gains a `detectedSessions: DetectedSession[]` array; broadcast it over the existing SSE channel the same way `agent-update` events already are.
4. `AgentList.tsx`: add a new, visually distinct, **read-only** "Detected" section below the existing three kanban columns (reuse the existing status-color badges — Busy/Idle/Waiting map directly from `status`/`state`), grouped by inferred project name (basename of `cwd`). No dispatch controls, no queue — just visibility, plus perhaps a "Register as agent" affordance that pre-fills `AddAgentForm` with the discovered `workdir`.
5. Ship it behind a config toggle (`conductor.conf`, e.g. `SHOW_DETECTED_SESSIONS=true`) defaulting to **off**, given the cross-project visibility/privacy constraint above; when on, optionally scope via `claude agents --json --cwd <SOME_ROOT>` to limit to a directory tree the user cares about.

**Risks and mitigations:**
- *CLI output shape drift* — treat every field as optional, log-and-skip malformed entries, never let a parse error affect existing registered-agent rendering (matches the project's established best-effort philosophy in `context.ts`/`pendingAgents.ts`).
- *Privacy/noise* — default off, add the `--cwd` scoping and/or a directory allowlist before enabling by default.
- *PID reuse false-positives if ever falling back to F2's file registry* — not applicable to Option A since the CLI does its own liveness bookkeeping; if a future iteration ever reads `~/.claude/sessions/*.json` directly for lower latency, cross-check `procStart`/`startedAt` against actual process start time, not just `kill(pid,0)`.
- *No control channel for detected sessions* — explicitly out of scope for v1; a follow-up could add tmux-pane correlation (F3) to enable "attach"/dispatch for detected sessions that do happen to live in a tmux pane.

**Alternative if constraints change:** if `claude` ever stops being guaranteed on `$PATH` for the host-server's environment (e.g. a hardened deploy target), fall back to Option B (`~/.claude/sessions/*.json`) with the pid-reuse guard above — it carries the same information, just via an unsupported path.

## Next Steps
- `/task-add Add a read-only "Detected Sessions" section to the kanban sourced from \`claude agents --json\`, correlated by cwd against the registered agents table, gated behind a conductor.conf toggle (default off)`
- If the cross-project visibility question needs a product decision before building (show everything vs. scope to a directory allowlist by default): `/decision-create` for that single question before implementation.
