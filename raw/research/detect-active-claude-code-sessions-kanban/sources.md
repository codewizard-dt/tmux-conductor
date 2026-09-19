---
topic: is there a way to detect all active claude code sessions and then show each session in the kanban?
slug: detect-active-claude-code-sessions-kanban
researched: 2026-09-13
---

# Primary Sources — Detect all active Claude Code sessions and show each in the kanban

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase (CLI, installed locally) | `claude agents --help` / `claude agents --json` (Claude Code CLI, local install) | 2026-09-13 | Documented `--json` flag text; live output schema (`pid`, `id`, `cwd`, `kind`, `startedAt`, `sessionId`, `name`, `status`, `state`) captured from a real run with 14 concurrent sessions |
| S2 | codebase (local filesystem) | `~/.claude/sessions/<pid>.json`, `~/.claude/daemon/roster.json`, `~/.claude/daemon.lock`, `~/.claude/daemon.status.json` | 2026-09-13 | Internal per-process session registry format; cross-checked against `ps`/`kill -0` — all 14 file entries matched live PIDs with no stale entries, confirming daemon-side cleanup on exit |
| S3 | codebase | `host-server/context.ts::resolveTranscriptPath`, `readTranscriptInfo`, `listCodexSessions` (lines 1-238) | 2026-09-13 | Current transcript-derivation logic: sidecar-first, mtime-fallback pattern; TTL-cache shape (`CODEX_SESSION_SCAN_TTL_MS`) worth reusing for the new session-list poller |
| S4 | codebase | `host-server/db.ts::Agent` interface (lines 17-28) | 2026-09-13 | Confirms `workdir` is the natural correlation key between registered agents and `claude agents --json`'s `cwd` field |
| S5 | codebase | `frontend/src/components/AgentList.tsx` lines 1010-1037 (`COLUMNS`, `columnFor`) | 2026-09-13 | Current kanban structure: 3 status-driven columns (attention/busy/ready) plus a separate inactive section — the natural insertion point for a new "Detected" section |
| S6 | codebase | `hooks/lib/write-state.js` (full file), `hooks/on-session-start.js` | 2026-09-13 | Shows tmux-conductor's hooks are installed globally (`install-hooks.sh` merges into `~/.claude/settings.json`) but are no-ops for any session lacking `CONDUCTOR_AGENT_NAME`/`CONDUCTOR_STATE_DIR` env vars or a real writable default `STATE_DIR` — ruling out "the existing hooks already solve this" |
| S7 | codebase (tool output) | `ListAgents` tool output, this session, 2026-09-13 | 2026-09-13 | Confirms Claude Code's own multi-agent tooling already renders a live, machine-wide session list (with tmux-pane correlation and Remote Control/cloud session status) built on the same underlying registry as S1/S2 |
| S8 | Serena memory | `claude-code/hooks-reference` (project memory) | 2026-09-13 | Hooks lifecycle reference (SessionStart/SessionEnd semantics, "state via files" pattern, §7.7 fail-soft guidance) used to frame Option C's risk profile |
| S9 | Serena memory | `architecture/agent-identity` (project memory) | 2026-09-13 | Confirms agent identity/addressing conventions (DB `id` vs. project-scoped `name`) relevant to how a detected session would need to be keyed if later "adopted" |

## Excerpts

### S1 — `claude agents --help` (local CLI, v2.1.x line)
```
$ claude agents --help
Usage: claude agents [options]

Manage background agents

Options:
  ...
  --all                                 With --json: also include completed
                                        background sessions
  --cwd <path>                          Show only background sessions started
                                        under <path>
  --json                                Print active sessions (interactive and
                                        background) as a JSON array and exit
                                        (for scripting; does not require a TTY)
  ...
```
Live sample from `claude agents --json`:
```json
{"pid":8995,"cwd":"/Users/davidtaylor/Repositories/bootstrap-claude","kind":"interactive",
 "startedAt":1789017086346,"sessionId":"11984a21-2bcd-4cba-9ceb-c31ef0689dda",
 "name":"bootstrap-claude-bc","status":"busy"}
```

### S2 — `~/.claude/sessions/45551.json`
```json
{"pid":45551,"sessionId":"e3975de0-8d13-4a52-85ca-b8798687c60a","cwd":"/Users/davidtaylor/Repositories/cryptwiz_py","startedAt":1789278170725,"procStart":"Sun Sep 13 05:42:50 2026","version":"2.1.269","peerProtocol":1,"peerFeatures":["notify_idle","reply_across_default_dirs","artifact_yield"],"kind":"interactive","entrypoint":"cli","pidDomain":"darwin","messagingSocketPath":"/tmp/cc-socks/45551.sock","name":"cryptwiz-py-13","nameSource":"derived","nameSince":1789278170725,"status":"idle","updatedAt":1789278468973,"statusUpdatedAt":1789278468973,"bridgeSessionId":"session_01UwR5aKvpmSqoyxDGrMRK9s"}
```
Cross-check: all 14 pids named by files under `~/.claude/sessions/*.json` returned success on `kill -0 <pid>` — no stale/dead entries found.

### S6 — `hooks/lib/write-state.js` (excerpt)
```js
const STATE_DIR = process.env.CONDUCTOR_STATE_DIR || '/conductor-state';
let AGENT_NAME = process.env.CONDUCTOR_AGENT_NAME || '';
if (!AGENT_NAME && process.env.TMUX) {
  try {
    AGENT_NAME = execFileSync('tmux', ['display-message', '-p', '#W'], ...).trim();
  } catch (_err) { /* swallow */ }
}
...
if (!AGENT_NAME) { process.exit(0); }
```
Shows the hook silently no-ops (exit 0, nothing written) for any session without a conductor-assigned name or a tmux window — which is the majority of ad-hoc, non-conductor-spawned Claude Code sessions.
