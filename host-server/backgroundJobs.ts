// backgroundJobs.ts — detect an outstanding Claude Code background/async job
// spawned by an agent's session, as a second, independent signal for status
// *display* (separate from pendingAgents.ts's dispatch-gating sentinel).
//
// TASK-0184 (relates_to BUG-0001): hasPendingBackgroundAgents() in
// pendingAgents.ts gates dispatch via a Notification-hook sentinel, but that
// sentinel never appears for a background job that doesn't call
// agent_needs_input, and nothing gates *status display* at all — an agent
// can badge `idle`/`empty` while a background job it spawned is still
// genuinely running. This module polls Claude Code's own per-job state at
// ~/.claude/jobs/<id>/state.json directly, with no dependency on any hook.
//
// Correlator (confirmed live against two real, unrelated jobs, 2026-09-19):
// a job's state.json has no field naming its parent session, but the
// *spawning* session's own transcript .jsonl gets a dedicated record when it
// dispatches one:
//   {"type":"continued-in","sessionId":"<parent>","continuedInSessionId":"<job>"}
// The job's own `sessionId` (from its state.json) exactly matches that
// `continuedInSessionId`. The job directory name (e.g. "5aa8a27d") must NOT
// be assumed to be sessionId.slice(0, 8) — unconfirmed as a stable rule;
// always match by the parsed `sessionId` field instead.
//
// Confirmed `state` enum (from state.json / timeline.jsonl, live investigation):
// "working" and "blocked" are non-terminal (busy — "blocked" was observed as
// a peer-coordination stall, not an error); "done" is terminal. Any other
// value is unrecognized and, mirroring pendingAgents.ts's stale-sentinel
// fallback, is treated as active only until its `updatedAt` ages past
// staleMs — so a future format change can never wedge an agent's status at
// "busy" forever.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTranscriptPath } from './context.ts';

const DEFAULT_JOBS_DIR = path.join(os.homedir(), '.claude', 'jobs');

interface ContinuedInCacheEntry { mtimeMs: number; size: number; sessionIds: string[]; }
const continuedInCache = new Map<string, ContinuedInCacheEntry>();

interface JobState { state?: string; sessionId?: string; updatedAt?: string; }

// Cached by (path, mtimeMs, size) — mirrors context.ts's readTranscriptInfo —
// so an unchanged transcript is never rescanned on repeat poll ticks.
function collectContinuedInSessionIds(transcriptPath: string): string[] {
  let stat: fs.Stats;
  try { stat = fs.statSync(transcriptPath); } catch { return []; }

  const cached = continuedInCache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.sessionIds;
  }

  const sessionIds: string[] = [];
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line || line.indexOf('"type":"continued-in"') === -1) continue;
      interface ContinuedInRec { type?: string; continuedInSessionId?: string }
      let rec: ContinuedInRec;
      try { rec = JSON.parse(line) as ContinuedInRec; } catch { continue; }
      if (rec.type === 'continued-in' && rec.continuedInSessionId) {
        sessionIds.push(rec.continuedInSessionId);
      }
    }
  } catch { /* unreadable transcript — treat as no continued-in records */ }

  continuedInCache.set(transcriptPath, { mtimeMs: stat.mtimeMs, size: stat.size, sessionIds });
  return sessionIds;
}

/**
 * True if the agent's transcript shows it spawned a background job (a
 * "continued-in" record) whose ~/.claude/jobs/<id>/state.json reports that
 * job as still outstanding — non-terminal per the confirmed enum above, or
 * an unrecognized state that hasn't yet aged past staleMs. A job directory
 * that fails to read or parse is skipped, not thrown.
 *
 * `jobsDir` defaults to the real ~/.claude/jobs and is only overridden in
 * tests, so callers never need to pass it.
 */
export function hasActiveBackgroundJob(
  stateDir: string,
  agentName: string,
  workdir: string,
  staleMs: number,
  jobsDir: string = DEFAULT_JOBS_DIR,
): boolean {
  const transcript = resolveTranscriptPath(agentName, workdir, stateDir);
  if (!transcript) return false;

  const sessionIds = collectContinuedInSessionIds(transcript.path);
  if (sessionIds.length === 0) return false;
  const sessionIdSet = new Set(sessionIds);

  let jobDirs: string[];
  try {
    jobDirs = fs.readdirSync(jobsDir);
  } catch {
    return false;
  }

  const now = Date.now();
  // Warn once per unrecognized `state` value per call, not once per job —
  // mirrors pendingAgents.ts's sawStale-after-the-loop style. Warning per
  // poll tick (this runs every 2s) for a persistently unrecognized value
  // would otherwise spam the log forever; once per call already surfaces it.
  const unrecognizedValues = new Set<string>();
  let foundActive = false;

  for (const dirName of jobDirs) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(jobsDir, dirName, 'state.json'), 'utf8');
    } catch {
      continue;
    }

    let job: JobState;
    try {
      job = JSON.parse(raw) as JobState;
    } catch {
      continue;
    }

    if (!job.sessionId || !sessionIdSet.has(job.sessionId)) continue;

    if (job.state === 'working' || job.state === 'blocked') {
      foundActive = true;
      break;
    }
    if (job.state === 'done') continue;

    if (job.state !== undefined) unrecognizedValues.add(job.state);
    const updatedAtMs = job.updatedAt ? Date.parse(job.updatedAt) : NaN;
    const age = Number.isNaN(updatedAtMs) ? Infinity : now - updatedAtMs;
    if (age < staleMs) {
      foundActive = true;
      break;
    }
  }

  for (const value of unrecognizedValues) {
    console.warn(`[conductor] hasActiveBackgroundJob: encountered unrecognized job state "${value}" in ${jobsDir} — treating as active only until updatedAt ages past ${String(staleMs)}ms`);
  }

  return foundActive;
}
