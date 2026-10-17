---
topic: "Why a 'project scoped' task might not send properly — command text entered into the terminal but never sent; the /clear command was lumped in with the task command, neither submitted, but both sitting ready to press Enter"
slug: dispatch-clear-first-enter-race
researched: 2026-09-19
sources: [./sources.md]
---

# Research: Why a project-scoped task dispatch doesn't submit (`/clear` + task text concatenated, unsent)

> Two independent, compounding bugs explain the screenshot. (1) `host-server/state.ts`'s `sendTextToPane()` — the only function that dispatches a queued task's command text into a tmux pane — sends literal text then `Enter` back-to-back via two synchronous `spawnSync` calls with **zero delay**, unlike `scripts/dispatch.sh`'s equivalent, which has an explicit `sleep 0.3` commented `# let the UI render before submitting`. This gap is silently doubled for **project-scoped** tasks specifically, because `dispatchTaskToAgent()` chains a `/clear` send and the real command send back-to-back (`opts.clearFirst`, set only when `task.kind === 'project'`) — exactly matching the screenshot's `/clear` + task-command concatenation. (2) Real production evidence in `logs/dispatch.jsonl` shows a second, already-known bug compounding it: the same agent pane received a *second* task dispatch while its own `/tackle` sub-agents from the first dispatch were still actively running in the background — this is **BUG-0001** (filed, `in-progress`, tracked by `TASK-133`), whose own investigation already documents that its sentinel-gate fix does not protect a sub-agent that runs to completion without ever calling `agent_needs_input` — exactly what a `/tackle` step's `general-purpose` sub-agent does.

## Research Questions

- What code path actually types a dispatched command into an agent's tmux pane, and does it match `scripts/dispatch.sh`'s documented `sleep 0.3` "let the UI render" protection?
- Why does the `/clear` command specifically get lumped in with the task command, and why only for some tasks?
- Is there direct evidence in this environment's own logs of the reported incident, and does it corroborate a specific mechanism?
- Is the missing-delay issue isolated to task dispatch, or does it also affect the Direct Input (`POST /agents/:id/keys`) send path?
- Is this a new, previously unfiled bug, or does it overlap with an already-tracked one?

## Current State (Codebase)

**Task dispatch → tmux pane.** `dispatchTaskToAgent()` (`host-server/index.ts:495-542`) is the single function that types a queued task's command into an agent's pane. It writes the `busy` state file and a `dispatch.jsonl` record *before* sending anything, then:
```ts
if (opts?.clearFirst) {
  sendTextToPane(conf.sessionName, win, '/clear');
}
sendTextToPane(conf.sessionName, win, cmdText);
```
`sendTextToPane()` (`host-server/state.ts:519-522`) is:
```ts
export function sendTextToPane(sessionName: string, windowName: string, text: string): void {
  const target = `${sessionName}:${windowName}`;
  spawnSync('tmux', ['send-keys', '-t', target, '-l', '--', text], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
  spawnSync('tmux', ['send-keys', '-t', target, 'Enter'], { encoding: 'utf8', timeout: TMUX_SYNC_TIMEOUT_MS });
}
```
No comment explains an intentional omission — there is simply no delay between the literal-text `spawnSync` and the `Enter` `spawnSync`, and none between two chained calls to `sendTextToPane` either. `sendTextToPane` has exactly one caller: `dispatchTaskToAgent`.

**Contrast: `scripts/dispatch.sh`** (the bash CLI dispatch tool, documented in `CLAUDE.md`'s Key Design Decisions and used by `monitor.sh`'s legacy poll loop):
```bash
tmux send-keys -t "$TARGET" -l "$CMD"
sleep 0.3  # let the UI render before submitting
tmux send-keys -t "$TARGET" Enter
```
This is the "repo-wide convention" `TASK-011`'s own approach section claims to follow ("sends the command using the same tmux plumbing as `POST /agents/:agent/keys` (`send-keys -l` for the literal text, `Enter` as a separate invocation — repo-wide convention)") — but the 0.3s render delay, the one detail `dispatch.sh`'s own comment calls out as load-bearing, was not carried over when the dispatch logic was reimplemented in TypeScript for host-server's own immediate-dispatch fast path (`TASK-011`) and later reused when dispatch ownership fully moved into host-server (`TASK-120`/`TASK-121`, superseding `monitor.sh`'s own dispatch loop).

**`opts.clearFirst` — why this hits project-scoped tasks specifically.** `dispatchTaskToAgent` has exactly two call sites:
- The immediate-enqueue fast path (`host-server/index.ts:951`) — `dispatchTaskToAgent(db, conf, foundAgent, cmdText, 'immediate-enqueue')` — **never** passes `clearFirst`.
- `pollAndDiff`'s idle-transition dispatch (`host-server/index.ts:2640`) — `dispatchTaskToAgent(db, conf, dbAgent, task.command, 'idle-transition-poll', { clearFirst: task.kind === 'project' })` — passes `clearFirst: true` **only** when the popped task's `kind` is `'project'` (as opposed to agent-scoped or global).

An agent-scoped task therefore only ever risks the single-call version of the missing-delay race (one literal-text send, one Enter, zero gap). A project-scoped task risks it **twice in the same dispatch** — once for `/clear`, once for the real command — with zero gap between the two chained `sendTextToPane` calls as well as within each one. This precisely matches the reported symptom being specific to a project-scoped task, and precisely matches the screenshot's literal content: `/clear /tackle wiki/work/tasks/TASK-0181-inactive-agents-inline-sidebar-toggle.md` sitting concatenated and unsubmitted.

**The Direct Input path has the same gap, but recognized it once — for multiline only.** `sendDirectInput()` (`host-server/index.ts:574-642`, backing `POST /agents/:id/keys`) builds a list of `tmux` invocations and, right before executing them, has:
```ts
for (const args of sends) {
  if (multiline && args[args.length - 1] === 'Enter') await sleep(300);
  ...
}
```
The 300ms sleep exists — but it is gated on `multiline` (the `set-buffer`/`paste-buffer` path for text containing a newline). A **single-line** literal `send-keys -l` followed by `Enter` — the exact same shape `sendTextToPane` uses for task dispatch — gets **no** sleep here either. This shows the render-delay requirement was understood and deliberately implemented for the paste-buffer case, but the same underlying race in the plain single-line case was not recognized as needing the same protection.

**Corroborating evidence in `logs/dispatch.jsonl` (this environment, this session).** Two consecutive real records for the same agent, `tmux-conductor-tmux-conductor-frontend-1`:
- `2026-09-19T05:40:06.862Z` — `/tackle wiki/work/tasks/TASK-0181-inactive-agents-inline-sidebar-toggle.md` dispatched via `idle-transition-poll`. The `pane_tail` captured *immediately before* this dispatch's own `sendTextToPane` calls (per `dispatchTaskToAgent`'s ordering — `capturePaneTail` runs before any send) already shows `❯ /research why` sitting unsubmitted at the live prompt — i.e. a leftover, previously-stuck dispatch from an earlier, unrelated incident of the same class of bug.
- `2026-09-19T05:41:46.175Z`, ~100 seconds later — `/tackle wiki/work/tasks/TASK-0180-queued-task-selectable-text-and-scope-to-project.md` dispatched to the **same** agent, also via `idle-transition-poll`. Its own pre-dispatch `pane_tail` shows the TASK-0181 dispatch's own `/tackle` **sub-agents actively still running** in the background (`task-0181-step1-delete-panel` idle, `task-0181-step2-checkbox-me…` showing `2s · ↓49.6k tokens` — live, mid-turn).

This second record is real evidence of a **second, distinct** bug compounding the first: the agent was dispatched into again while genuinely still busy with background sub-agent work from the prior dispatch.

## Key Findings

1. `sendTextToPane` (task dispatch) has zero delay between the literal-text send and the `Enter` send, and zero delay between chained calls — unlike `scripts/dispatch.sh`, whose explicit `sleep 0.3` is commented as necessary "to let the UI render before submitting." [S1], [S2]
2. `dispatchTaskToAgent`'s `clearFirst` option — set only for `task.kind === 'project'` — chains **two** such sends back-to-back for a project-scoped task, doubling exposure to the same race and exactly reproducing the screenshot's literal `/clear` + task-command concatenation. [S1]
3. The Direct Input send path (`sendDirectInput`) independently discovered and fixed this exact class of race, but only for the multiline paste-buffer case (`await sleep(300)` gated on `multiline`) — the single-line `send-keys -l` + `Enter` shape used by both Direct Input *and* task dispatch has no such protection anywhere in the codebase. [S3]
4. Real `dispatch.jsonl` records from this environment corroborate a second, already-known, already-tracked bug compounding the first: a second task dispatched into an agent pane while that agent's own background sub-agents (from a `/tackle` run) were still actively executing. This is **BUG-0001** (`wiki/work/bugs/0001-false-idle-during-subagent-wait.md`, `status: in-progress`, `P1`, tracked by `TASK-133`), whose file already documents — as of the last investigation — that the sentinel-gate fix "does not protect the scenario that motivated BUG-0001's original report": a background agent that runs to completion without ever calling `agent_needs_input`, which is exactly what a `/tackle` step's `general-purpose` sub-agent typically does. [S4], [S5]
5. No bug is currently filed for finding #1/#2 (the missing render-delay) — `wiki/work/bugs/` contains only `BUG-0001`, `BUG-0011`, `BUG-0012`, none of which describe this. This is a new finding. [S6]

## Constraints

- `sendTextToPane`/`dispatchTaskToAgent` run inside host-server's Node.js process — `spawnSync` blocks the event loop for its own duration, but that duration is only how long `tmux send-keys` itself takes to hand keystrokes to the pane's pty, **not** how long the target program (Claude Code CLI) takes to read, parse, and render them. The fix must add a real wall-clock gap (e.g. `sleep`/`setTimeout` equivalent), not just rely on `spawnSync` "returning" as a readiness signal — `spawnSync` returning already provides zero such guarantee today, which is the root cause.
- Any fix must not regress the immediate-enqueue fast path's actual purpose (TASK-011: dispatch in under a second) — a 300ms addition is negligible against that budget and is already accepted practice elsewhere in this same file (`sendDirectInput`'s multiline case).
- `clearFirst`'s two-send chain is a legitimate design (clear context before a project-scoped/context-switching task) — the fix should preserve the `/clear`-then-command ordering, just add delay(s) so each half actually lands.
- BUG-0001 is a separate, already-tracked, already-scoped issue (`TASK-133`) — this research should not re-litigate it, only flag that this incident is corroborating evidence for its still-open primary-case gap.

## Recommendation

**Fix the render-delay gap in `sendTextToPane` and `dispatchTaskToAgent`'s `clearFirst` chain — this is the direct, concrete cause of the reported symptom and has no existing tracking.**

Implementation outline:
1. In `host-server/state.ts`'s `sendTextToPane`, add a delay between the literal-text `spawnSync` and the `Enter` `spawnSync` — mirror `scripts/dispatch.sh`'s `sleep 0.3` (300ms) and `sendDirectInput`'s existing `await sleep(300)` precedent for consistency. Since `sendTextToPane` is currently synchronous (`void` return, no `async`), either make it `async` (small ripple: its one caller, `dispatchTaskToAgent`, and *that* function's own two callers, would need `await`/`async` threaded through — check whether `pollAndDiff` and the immediate-enqueue route handler are already `async` before deciding whether this is trivial or requires broader signature changes) or use a blocking sleep equivalent consistent with the rest of the function's synchronous `spawnSync` style (e.g. a tiny synchronous busy-wait is not idiomatic Node — converting to `async`/`await sleep(300)` is the cleaner match to `sendDirectInput`'s existing pattern and should be preferred).
2. In `dispatchTaskToAgent`, when `opts?.clearFirst` is true, also ensure a delay *between* the `/clear` call fully landing and the second `sendTextToPane` call starting — if step 1 makes `sendTextToPane` itself reliably wait after every `Enter`, this may already be sufficient; verify rather than assume, since `/clear` specifically triggers a fuller-screen redraw than a normal message send and may warrant its own slightly longer settle time.
3. Add a regression test/guard (or at minimum a code comment cross-referencing `scripts/dispatch.sh`'s comment) so a future refactor doesn't silently drop the delay again — this has now happened once already (dispatch.sh → `sendTextToPane` did not carry it forward).
4. File this as a new bug (not folded into BUG-0001) since it is a distinct, independently-reproducible mechanism with its own fix — reference this research file and cite the two `dispatch.jsonl` records as evidence, and cross-link to BUG-0001 as a compounding, separately-tracked factor in the specific incident that prompted this research.

Risks and mitigations:
- Adding `await`/`async` to `sendTextToPane` could ripple into caller signatures — audit `dispatchTaskToAgent`'s two call sites (`index.ts:951`, `index.ts:2640`) before implementing, confirm both are already inside `async` contexts (the immediate-enqueue route handler almost certainly is, being a Fastify route handler; `pollAndDiff`'s dispatch branch needs direct confirmation).
- A 300ms delay inside `pollAndDiff` (which iterates all agents every poll tick) is per-dispatch, not per-tick, so it should not meaningfully slow the overall poll loop unless many agents transition idle→dispatch in the exact same tick — worth a quick sanity check of `pollAndDiff`'s loop structure (sequential vs. per-agent-independent) before shipping.

Alternative if constraints change: if `sendTextToPane` cannot easily become `async`, a Node-native synchronous sleep (busy-wait) is the only alternative and is a worse fit for this codebase's style — prefer the `async`/`await sleep()` route already established by `sendDirectInput`.

## Next Steps

- `/bug-file` a new bug describing the missing render-delay in `sendTextToPane`/`dispatchTaskToAgent`, citing this research file and the two `dispatch.jsonl` records as evidence.
- `/task-add` (once the bug is triaged) to implement the delay fix in `sendTextToPane` and verify the `clearFirst` chain, per the Recommendation above.
- No action needed on BUG-0001/TASK-133 from this research — they already correctly describe their own gap; this research only adds corroborating live evidence to an already-open, already-scoped issue.
