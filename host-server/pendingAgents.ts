import * as fs from 'fs';
import * as path from 'path';

/**
 * BUG-0001: Claude Code's background/async-agent feature (shipped v2.1.198)
 * lets a session's outer turn end — a genuine `Stop` hook firing, which
 * hooks/on-stop.js writes as `idle` unconditionally — while a background
 * sub-agent it spawned (e.g. /power-mode's UAT-auto sub-agents) keeps
 * running independently. The idle/busy state file has no way to represent
 * that, so a queued task could dispatch into an agent that is still
 * genuinely occupied waiting on its own background work.
 *
 * hooks/on-notification.js tracks outstanding background agents separately:
 * one sentinel file per outstanding agent under
 * `${stateDir}/<windowName>.pending-agents/`, created on the Notification
 * hook's `agent_needs_input` type and removed on `agent_completed`. A fresh
 * sentinel here means the agent is not really free yet even though its
 * idle/busy state file says idle.
 *
 * Sentinels older than staleMs are ignored (and logged) so a missed or
 * unsupported `agent_completed` notification can never wedge the queue
 * forever — mirrors the existing busy-older-than-2xPOLL_INTERVAL -> stalled
 * staleness fallback already used elsewhere in idle detection.
 */
export function hasPendingBackgroundAgents(stateDir: string, windowName: string, staleMs: number): boolean {
  const dir = path.join(stateDir, `${windowName}.pending-agents`);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }

  const now = Date.now();
  let sawStale = false;
  for (const entry of entries) {
    try {
      const stat = fs.statSync(path.join(dir, entry));
      if (now - stat.mtimeMs < staleMs) {
        return true;
      }
      sawStale = true;
    } catch {
      // entry vanished between readdir and stat (raced with the hook's own
      // cleanup on agent_completed) — nothing to do, just skip it
    }
  }

  if (sawStale) {
    console.warn(`[conductor] hasPendingBackgroundAgents: ignoring stale sentinel(s) in ${dir} (older than ${String(staleMs)}ms) — a missed agent_completed notification?`);
  }
  return false;
}
