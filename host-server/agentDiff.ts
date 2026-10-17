// Pure predicate deciding whether an agent's snapshot changed enough between two
// status ticks to warrant broadcasting an `agent-update` SSE event. Extracted
// from index.ts's pollAndDiff so it can be unit-tested (index.ts has top-level
// side effects and cannot be imported in a test).
//
// Types are structural on purpose: index.ts's Snapshot agent record is a
// supertype-compatible superset of DiffableAgent, so no import from index.ts is
// needed (and none must be added — that would create a cycle).

export interface DiffableAgent {
  state: string;
  status: { display: string; reason: string; needsAttention: boolean };
  mode: string;
  queuedTasks: number;
  windowPresent: boolean;
  activeTask: string | null;
  modelId: string | null;
  contextPct: number | null;
  label: string | null;
  usage: { costUsd?: number; outputTokens?: number } | null;
  worktreePath: string | null;
  branch: string | null;
  // Optional so callers/fixtures that predate the field still type-check;
  // undefined and null compare equal (both mean "no prompt").
  lastPrompt?: { text: string; ts: string } | null | undefined;
}

/**
 * True when `next` differs from `prev` in any field that is broadcast to
 * clients, or when there is no previous snapshot for the agent (first sight).
 *
 * worktreePath/branch are included so a worktree created (or cleared by the
 * self-heal path) via POST /agents/:id/worktree propagates to every connected
 * client within one status tick, not just the requesting client.
 */
export function agentSnapshotChanged(prev: DiffableAgent | undefined, next: DiffableAgent): boolean {
  if (!prev) return true;
  return (
    prev.state !== next.state ||
    prev.status.display !== next.status.display ||
    prev.status.reason !== next.status.reason ||
    prev.status.needsAttention !== next.status.needsAttention ||
    prev.mode !== next.mode ||
    prev.queuedTasks !== next.queuedTasks ||
    prev.windowPresent !== next.windowPresent ||
    prev.activeTask !== next.activeTask ||
    prev.modelId !== next.modelId ||
    prev.contextPct !== next.contextPct ||
    prev.label !== next.label ||
    prev.usage?.costUsd !== next.usage?.costUsd ||
    prev.usage?.outputTokens !== next.usage?.outputTokens ||
    prev.worktreePath !== next.worktreePath ||
    prev.branch !== next.branch ||
    // Compare ts AND text: two prompts can share a second-resolution ts, and an
    // identical resubmit differs by ts.
    prev.lastPrompt?.ts !== next.lastPrompt?.ts ||
    prev.lastPrompt?.text !== next.lastPrompt?.text
  );
}
