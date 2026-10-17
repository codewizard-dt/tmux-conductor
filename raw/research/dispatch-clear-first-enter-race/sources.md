---
topic: "Why a 'project scoped' task might not send properly — command text entered into the terminal but never sent; the /clear command was lumped in with the task command, neither submitted, but both sitting ready to press Enter"
slug: dispatch-clear-first-enter-race
researched: 2026-09-19
---

# Primary Sources — Why a project-scoped task dispatch doesn't submit

| ID | Type | Locator | Accessed | What it contributed |
|----|------|---------|----------|---------------------|
| S1 | codebase | `host-server/index.ts::dispatchTaskToAgent` (L495-542) and its two call sites (L951, L2640) | 2026-09-19 | The `clearFirst: task.kind === 'project'` gate; confirms project-scoped tasks chain two `sendTextToPane` calls (`/clear` then command), agent-scoped tasks chain only one |
| S2 | codebase | `host-server/state.ts::sendTextToPane` (L519-522) | 2026-09-19 | Confirms zero delay between the literal-text `spawnSync` and the `Enter` `spawnSync`; no comment explaining an intentional omission |
| S3 | codebase | `host-server/index.ts::sendDirectInput` (L574-642) | 2026-09-19 | Confirms the `POST /agents/:id/keys` Direct Input path has `await sleep(300)` before `Enter`, but only when `multiline` (paste-buffer) — the single-line `send-keys -l` shape (same as task dispatch) has no delay |
| S4 | codebase | `scripts/dispatch.sh` (full file, 18 lines) | 2026-09-19 | The bash dispatch tool's `sleep 0.3  # let the UI render before submitting` between literal-text send and `Enter` — the convention `sendTextToPane` was meant to follow but didn't fully carry forward |
| S5 | data (live log) | `logs/dispatch.jsonl` — records at `2026-09-19T05:40:06.862Z` and `2026-09-19T05:41:46.175Z` for agent `tmux-conductor-tmux-conductor-frontend-1` | 2026-09-19 | Real production evidence: a project-scoped `/tackle TASK-0181` dispatch with a stuck leftover prompt already present, followed ~100s later by a second `/tackle TASK-0180` dispatch to the same agent while TASK-0181's own background sub-agents were still actively running |
| S6 | codebase | `wiki/work/bugs/0001-false-idle-during-subagent-wait.md` (frontmatter + body, read earlier this session) | 2026-09-19 | Confirms BUG-0001's own documented gap: the sentinel-gate fix does not protect a background sub-agent that completes without ever calling `agent_needs_input` — the exact shape of the second dispatch seen in S5 |
| S7 | codebase | `wiki/work/bugs/` directory listing (`list_dir`) | 2026-09-19 | Confirms only `BUG-0001`, `BUG-0011`, `BUG-0012` are currently filed — none describe the missing render-delay finding, confirming it is new |
| S8 | codebase | `wiki/work/tasks/TASK-011-immediate-dispatch.md` (read earlier this session, task Approach section) | 2026-09-19 | TASK-011's own claim that its dispatch mechanism follows "the same tmux plumbing as `POST /agents/:agent/keys` (`send-keys -l` for the literal text, `Enter` as a separate invocation — repo-wide convention)" — the origin of `sendTextToPane`'s two-call shape, without the render-delay half of that convention |

## Excerpts

### S1 — `host-server/index.ts::dispatchTaskToAgent` and call sites
```ts
function dispatchTaskToAgent(
  db: Database.Database,
  conf: ConductorConf,
  agent: Agent,
  cmdText: string,
  detection: string,
  opts?: { clearFirst?: boolean },
): void {
  ...
  if (opts?.clearFirst) {
    sendTextToPane(conf.sessionName, win, '/clear');
  }
  sendTextToPane(conf.sessionName, win, cmdText);
}
```
Call site (immediate-enqueue, no `clearFirst`):
```ts
dispatchTaskToAgent(db, conf, foundAgent, cmdText, 'immediate-enqueue');
```
Call site (`pollAndDiff`, `clearFirst` gated on task kind):
```ts
dispatchTaskToAgent(db, conf, dbAgent, task.command, 'idle-transition-poll', { clearFirst: task.kind === 'project' });
```

### S2 — `host-server/state.ts::sendTextToPane`
```ts
export function sendTextToPane(sessionName: string, windowName: string, text: string): void {
  const target = `${sessionName}:${windowName}`;
  spawnSync('tmux', ['send-keys', '-t', target, '-l', '--', text], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
  spawnSync('tmux', ['send-keys', '-t', target, 'Enter'], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
}
```

### S3 — `host-server/index.ts::sendDirectInput` (relevant excerpt)
```ts
for (const args of sends) {
  if (multiline && args[args.length - 1] === 'Enter') await sleep(300);
  const started = performance.now();
  const r = spawnSync('tmux', args, { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
  ...
}
```

### S4 — `scripts/dispatch.sh`
```bash
#!/usr/bin/env bash
# Usage: dispatch.sh <target> <command>
# Example: dispatch.sh conductor:backend "/clear"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET="$1"
CMD="$2"

# -l = literal mode (preserves special chars in the prompt)
# Enter is ALWAYS a separate argument — never embed \n in the string
tmux send-keys -t "$TARGET" -l "$CMD"
sleep 0.3  # let the UI render before submitting
tmux send-keys -t "$TARGET" Enter

echo "[$(date +%H:%M:%S)] Dispatched to $TARGET: $CMD"
```

### S5 — `logs/dispatch.jsonl` (two consecutive records, same agent)
```json
{"ts":"2026-09-19T05:40:06.862Z","agent":"tmux-conductor-tmux-conductor-frontend-1","command":"/tackle wiki/work/tasks/TASK-0181-inactive-agents-inline-sidebar-toggle.md","state":"idle","state_age_s":0,"detection":"idle-transition-poll","queue":"none","queue_remaining":0,"pane_tail":"...❯ /research why\n..."}
```
```json
{"ts":"2026-09-19T05:41:46.175Z","agent":"tmux-conductor-tmux-conductor-frontend-1","command":"/tackle wiki/work/tasks/TASK-0180-queued-task-selectable-text-and-scope-to-project.md","state":"idle","state_age_s":0,"detection":"idle-transition-poll","queue":"none","queue_remaining":0,"pane_tail":"...  ◯ task-0181-step1-delete-panel  You are executing Step 1 of TASK-0181 in /Users/da...  idle\n  ◯ task-0181-step2-checkbox-me…  You are executing Step 2 of TASK-0181 in /Users/da...  2s · ↓ 49.6k tokens"}
```
(`pane_tail` truncated to the relevant lines here; full lines are very wide, padded with spaces to a fixed terminal width in the raw log.)
