// context.ts — derive the live model and context-window fill for an agent from
// its Claude Code transcript JSONL.
//
// The transcript is the same data Claude Code's own `/context` meter reads.
// Every `type:"assistant"` line carries `message.model` (the live model id, which
// reflects mid-session `/model` switches) and `message.usage`. The context
// currently in the window is the sum of the LAST assistant turn's
//   input_tokens + cache_creation_input_tokens + cache_read_input_tokens
// divided by the model's context window.
//
// Locating the transcript (hybrid, see resolveTranscriptPath):
//   1. <stateDir>/<agent>.meta.json written by the hooks — exact transcript_path.
//   2. Fallback: derive ~/.claude/projects/<encoded-workdir>/ and pick the newest
//      *.jsonl by mtime (covers agents whose hooks haven't fired yet).
//
// Everything here is best-effort: any failure yields null context fields so the
// dashboard simply hides the indicator (e.g. non-Claude agents like Aider/Codex).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AgentContext {
  model: string | null;       // display name, e.g. "Opus 4.8"
  modelId: string | null;     // raw id, e.g. "claude-opus-4-8"
  contextTokens: number | null;
  contextPct: number | null;  // 0..100, capped
  contextLimit: number;
}

// Cache parsed transcript info keyed by path → invalidated when mtime/size change,
// so the 2s poll loop only re-parses a transcript that actually advanced.
interface CacheEntry { mtimeMs: number; size: number; info: TranscriptInfo | null; }
const transcriptCache = new Map<string, CacheEntry>();

interface TranscriptInfo { modelId: string | null; contextTokens: number; }

// Per-agent memo that (a) pins the agent to its MAIN-session transcript so a
// momentary mtime-fallback can't flap onto a sub-agent's separate transcript,
// and (b) retains the last good reading so the dashboard never blanks the meter
// while the agent is busy. Sub-agents (Task tool) write their own *.jsonl in the
// same workdir-derived project dir, so "newest by mtime" alone is unsafe.
interface AgentMemo {
  transcriptPath: string | null;   // currently pinned main-session transcript
  sessionId: string | null;        // sidecar session_id — detects a real new session
  lastGood: AgentContext | null;   // last reading with a non-null model/contextPct
}
const agentMemo = new Map<string, AgentMemo>();

interface ResolvedTranscript {
  path: string;
  source: 'sidecar' | 'derived';
  sessionId: string | null;
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Encode an absolute workdir into Claude Code's project-dir name: every `/` and
 * `.` becomes `-` (verified against ~/.claude/projects/ on disk). e.g.
 *   /Users/me/Repositories/tmux-conductor → -Users-me-Repositories-tmux-conductor
 *   /Users/me/.humanlayer/ws             → -Users-me--humanlayer-ws
 */
function encodeWorkdir(workdir: string): string {
  return workdir.replace(/[/.]/g, '-');
}

/**
 * Resolve the transcript JSONL for an agent. Prefers the hook-written sidecar's
 * exact transcript_path; falls back to the newest *.jsonl in the derived project
 * dir. Returns null when no transcript can be found.
 */
export function resolveTranscriptPath(
  agentName: string,
  workdir: string,
  stateDir: string,
): ResolvedTranscript | null {
  // 1. Hook-written sidecar with the exact path (authoritative: it always names
  //    the MAIN session's transcript, never a sub-agent's).
  try {
    const metaRaw = fs.readFileSync(path.join(stateDir, `${agentName}.meta.json`), 'utf8');
    const meta = JSON.parse(metaRaw) as { transcript_path?: string; session_id?: string };
    if (meta.transcript_path) {
      const tp = expandHome(meta.transcript_path);
      if (fs.existsSync(tp)) return { path: tp, source: 'sidecar', sessionId: meta.session_id ?? null };
    }
  } catch { /* no sidecar / unreadable — fall through to derivation */ }

  // 2. Derive the project dir from the workdir and pick the newest session file.
  //    Best-effort only: with no sidecar we cannot tell a sub-agent transcript
  //    apart from the main one, so the caller pins the first derived path and
  //    refuses to flap to a newer file (see getAgentContext).
  if (!workdir) return null;
  const projectDir = path.join(os.homedir(), '.claude', 'projects', encodeWorkdir(workdir));
  try {
    const newest = fs.readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(projectDir, f);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return newest ? { path: newest.full, source: 'derived', sessionId: null } : null;
  } catch {
    return null;
  }
}

/**
 * Parse the transcript and return the last *real* assistant turn's model + the
 * tokens currently occupying the context window. Cached by (mtime, size).
 *
 * We read the whole file (not just a tail) because a single trailing
 * user/tool-result message can exceed any fixed tail window and push the last
 * assistant line out of view. The mtime/size cache means we only re-parse when
 * the transcript actually advances. Parsing is lazy from the end — we stop at
 * the first qualifying line, so we never JSON.parse the whole file.
 *
 * Skipped while scanning backwards:
 *   - non-assistant event lines (the final line is often a user/meta event)
 *   - `isSidechain` turns (subagent/Task transcripts — not the main context)
 *   - `<synthetic>` model lines and zero-usage turns (compact boundaries, etc.)
 */
function readTranscriptInfo(transcriptPath: string): TranscriptInfo | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(transcriptPath); } catch { return null; }

  const cached = transcriptCache.get(transcriptPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.info;
  }

  let info: TranscriptInfo | null = null;
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.indexOf('"usage"') === -1) continue;
      interface TranscriptRec { type?: string; isSidechain?: boolean; message?: { usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }; model?: string } }
      let rec: TranscriptRec;
      try { rec = JSON.parse(line) as TranscriptRec; } catch { continue; }
      if (rec.type !== 'assistant' || rec.isSidechain) continue;
      const usage = rec.message?.usage;
      const modelId = rec.message?.model ?? null;
      if (!usage || modelId === '<synthetic>') continue;
      const tokens =
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      if (tokens <= 0) continue;
      info = { modelId, contextTokens: tokens };
      break;
    }
  } catch {
    info = null;
  }

  transcriptCache.set(transcriptPath, { mtimeMs: stat.mtimeMs, size: stat.size, info });
  return info;
}

/**
 * Map a raw model id to a short display name, e.g.
 *   claude-opus-4-8 → "Opus 4.8", claude-haiku-4-5-20251001 → "Haiku 4.5",
 *   claude-3-5-sonnet-20241022 → "Sonnet 3.5", claude-fable-5 → "Fable 5".
 * Falls back to the raw id for anything unrecognised.
 */
export function modelDisplayName(modelId: string | null): string | null {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  const fam =
    id.includes('opus') ? 'Opus' :
    id.includes('sonnet') ? 'Sonnet' :
    id.includes('haiku') ? 'Haiku' :
    id.includes('fable') ? 'Fable' : null;
  if (!fam) return modelId;
  // family-major-minor (claude-opus-4-8) or major-minor-family (claude-3-5-sonnet)
  const mm = id.match(/(?:opus|sonnet|haiku|fable)-(\d+)-(\d+)/) ||
             id.match(/(\d+)-(\d+)-(?:opus|sonnet|haiku|fable)/);
  if (mm) return `${fam} ${mm[1] ?? ''}.${mm[2] ?? ''}`;
  const single = id.match(/(?:opus|sonnet|haiku|fable)-(\d+)/);
  if (single) return `${fam} ${single[1] ?? ''}`;
  return fam;
}

/**
 * Full context snapshot for an agent. Returns null-valued fields (with the
 * configured limit) when no transcript is found so the UI hides the indicator.
 */
export function getAgentContext(
  agentName: string,
  workdir: string,
  stateDir: string,
  contextLimit: number,
  isBusy: boolean,
): AgentContext {
  const empty: AgentContext = { model: null, modelId: null, contextTokens: null, contextPct: null, contextLimit };

  const memo = agentMemo.get(agentName) ?? { transcriptPath: null, sessionId: null, lastGood: null };
  agentMemo.set(agentName, memo);

  // Decide which transcript to read. The sidecar is authoritative (always the
  // MAIN session); a derived path is best-effort and must not override a path
  // we've already pinned, or a busy agent's meter would flap onto a sub-agent's
  // transcript that happens to be the newest file.
  const resolved = resolveTranscriptPath(agentName, workdir, stateDir);
  let pinnedPath: string | null;
  if (resolved?.source === 'sidecar') {
    // A genuine new main session (session_id changed) resets the retained value.
    if (memo.sessionId && resolved.sessionId && resolved.sessionId !== memo.sessionId) {
      memo.lastGood = null;
    }
    memo.transcriptPath = resolved.path;
    memo.sessionId = resolved.sessionId;
    pinnedPath = resolved.path;
  } else if (memo.transcriptPath && fs.existsSync(memo.transcriptPath)) {
    // Keep the path we already locked onto; ignore a newer derived candidate.
    pinnedPath = memo.transcriptPath;
  } else if (resolved) {
    // First sighting (or pinned file gone): adopt the derived path and pin it.
    if (memo.transcriptPath && resolved.path !== memo.transcriptPath) memo.lastGood = null;
    memo.transcriptPath = resolved.path;
    memo.sessionId = null;
    pinnedPath = resolved.path;
  } else {
    pinnedPath = memo.transcriptPath;
  }

  if (!pinnedPath) return empty;

  const info = readTranscriptInfo(pinnedPath);
  if (!info) {
    // Transient miss (mid-write read, partial line, momentary no-usage tail):
    // keep showing the last good value while the agent is busy so the meter
    // never blinks out. When idle/exited, allow it to clear normally.
    return isBusy && memo.lastGood ? memo.lastGood : empty;
  }

  const contextPct = contextLimit > 0
    ? Math.min(100, Math.round((info.contextTokens / contextLimit) * 100))
    : null;
  const ctx: AgentContext = {
    model: modelDisplayName(info.modelId),
    modelId: info.modelId,
    contextTokens: info.contextTokens,
    contextPct,
    contextLimit,
  };
  if (ctx.model != null || ctx.contextPct != null) memo.lastGood = ctx;
  return ctx;
}
