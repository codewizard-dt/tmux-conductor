// usage-store.ts — fold per-poll UsageDeltas into absolute per-(agent, session)
// totals and persist them to the agent_usage table.
//
// Idempotency contract: usage.ts's bootstrap re-parses the transcript from
// byte offset 0 after any memo reset (host-server restart, session change,
// truncation) and RE-EMITS full-file deltas. Because this store also resets
// with the process, summing deltas here always yields the true absolute
// session totals, and upsertAgentUsage is an absolute overwrite
// (ON CONFLICT ... SET col=excluded.col) — so replays, restarts, and repeated
// polls never inflate the persisted values. An additive SQL upsert would
// double-count every restart; do not change the write to one.

import type Database from 'better-sqlite3';
import { upsertAgentUsage } from './db.ts';
import { getUsageSessionStart, type UsageDelta } from './usage.ts';
import { computeCostUsd } from './pricing.ts';

interface SessionTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

// agentId -> sessionKey -> running absolute totals
const store = new Map<number, Map<string, SessionTotals>>();

// Unknown models still get their tokens recorded (cost 0) — warn once each.
const warnedModels = new Set<string>();

/** Clear the accumulator for one agent (agent deletion) or all (tests). */
export function resetUsageStore(agentId?: number): void {
  if (agentId === undefined) store.clear();
  else store.delete(agentId);
}

/**
 * Fold this poll's deltas into the running session totals and upsert every
 * touched session's absolute totals into agent_usage. Cost per delta is
 * costUSD passthrough when the transcript carries it, else static
 * pricing-table math (ccusage "auto" semantics). Never throws.
 */
export function recordUsageDeltas(
  db: Database.Database,
  agent: { id: number; name: string },
  deltas: UsageDelta[],
): void {
  if (deltas.length === 0) return;
  try {
    let sessions = store.get(agent.id);
    if (!sessions) {
      sessions = new Map();
      store.set(agent.id, sessions);
    }

    const touched = new Set<string>();
    for (const delta of deltas) {
      // Restart-stable upsert key: first-record timestamp from the extraction
      // memo, falling back to the session UUID (see TASK-075 rationale).
      const sessionKey = getUsageSessionStart(agent.name) ?? delta.sessionId ?? 'unknown';
      let costUsd = delta.costUSD;
      if (costUsd === null) {
        costUsd = computeCostUsd(delta.model, delta);
        if (costUsd === null) {
          if (!warnedModels.has(delta.model)) {
            warnedModels.add(delta.model);
            console.warn(`[usage] no pricing entry for model '${delta.model}' — recording tokens with cost 0`);
          }
          costUsd = 0;
        }
      }
      const totals = sessions.get(sessionKey) ?? {
        inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUsd: 0,
      };
      totals.inputTokens += delta.inputTokens;
      totals.outputTokens += delta.outputTokens;
      totals.cacheCreationTokens += delta.cacheCreationTokens;
      totals.cacheReadTokens += delta.cacheReadTokens;
      totals.costUsd += costUsd;
      sessions.set(sessionKey, totals);
      touched.add(sessionKey);
    }

    let lastTouched: string | null = null;
    for (const sessionKey of touched) {
      const totals = sessions.get(sessionKey)!;
      upsertAgentUsage(db, {
        agentId: agent.id,
        sessionStart: sessionKey,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheCreationInputTokens: totals.cacheCreationTokens,
        cacheReadInputTokens: totals.cacheReadTokens,
        costUsd: totals.costUsd,
      });
      lastTouched = sessionKey;
    }

    // Bound memory: only the current session still receives deltas; a session
    // that stopped is final — its row already holds its last absolute totals.
    if (lastTouched !== null) {
      for (const key of [...sessions.keys()]) {
        if (key !== lastTouched) sessions.delete(key);
      }
    }
  } catch (err) {
    console.warn(`[usage] failed to record usage for agent '${agent.name}':`, err);
  }
}
