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
interface CodexInfo { modelId: string | null; contextTokens: number | null; contextLimit: number | null; }
interface CodexSessionCandidate { path: string; mtimeMs: number; }
interface CodexCacheEntry { mtimeMs: number; size: number; info: CodexInfo | null; }

// Per-agent memo that (a) pins the agent to its MAIN-session transcript so a
// momentary mtime-fallback can't flap onto a sub-agent's separate transcript,
// and (b) retains the last good reading so the dashboard never blanks the meter
// while the agent is busy. Sub-agents (Task tool) write their own *.jsonl in the
// same workdir-derived project dir, so "newest by mtime" alone is unsafe.
interface AgentMemo {
  transcriptPath: string | null;   // currently pinned main-session transcript
  sessionId: string | null;        // sidecar session_id — detects a real new session
  trusted: boolean;                // pinned path came from the sidecar (this agent's own
                                   // session), not the derived newest-by-mtime fallback
  lastGood: AgentContext | null;   // last reading with a non-null model/contextPct
  prevModel: string | null;        // model from last good read; survives lastGood reset on /clear
}
const agentMemo = new Map<string, AgentMemo>();
const codexCache = new Map<string, CodexCacheEntry>();
let codexSessionScan: { ts: number; sessions: CodexSessionCandidate[] } | null = null;
const CODEX_SESSION_SCAN_TTL_MS = 5000;

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

function codexModelDisplayName(modelId: string | null): string | null {
  if (!modelId) return null;
  const parts = modelId.toLowerCase().split('-').filter(Boolean);
  if (parts.length === 0) return modelId;
  return parts.map((part) => part === 'gpt' ? 'GPT' : part.toUpperCase()).join('-');
}

function collectCodexSessions(dir: string, out: CodexSessionCandidate[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCodexSessions(full, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    try {
      out.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch {
      // ignore races while Codex rotates/writes files
    }
  }
}

function listCodexSessions(): CodexSessionCandidate[] {
  const now = Date.now();
  if (codexSessionScan && now - codexSessionScan.ts < CODEX_SESSION_SCAN_TTL_MS) {
    return codexSessionScan.sessions;
  }
  const sessions: CodexSessionCandidate[] = [];
  collectCodexSessions(path.join(os.homedir(), '.codex', 'sessions'), sessions);
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  codexSessionScan = { ts: now, sessions };
  return sessions;
}

function codexSessionCwd(sessionPath: string): string | null {
  try {
    const first = fs.readFileSync(sessionPath, 'utf8').split('\n', 1)[0];
    if (!first) return null;
    const rec = JSON.parse(first) as { type?: string; payload?: { cwd?: string } };
    return rec.type === 'session_meta' && typeof rec.payload?.cwd === 'string'
      ? rec.payload.cwd
      : null;
  } catch {
    return null;
  }
}

function resolveCodexSessionPath(workdir: string): string | null {
  if (!workdir) return null;
  const resolvedWorkdir = path.resolve(workdir);
  for (const candidate of listCodexSessions()) {
    const cwd = codexSessionCwd(candidate.path);
    if (cwd && path.resolve(cwd) === resolvedWorkdir) return candidate.path;
  }
  return null;
}

function readCodexInfo(sessionPath: string): CodexInfo | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(sessionPath); } catch { return null; }

  const cached = codexCache.get(sessionPath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.info;
  }

  let modelId: string | null = null;
  let contextTokens: number | null = null;
  let contextLimit: number | null = null;
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let rec: {
        type?: string;
        payload?: {
          model?: string;
          info?: {
            model_context_window?: number;
            last_token_usage?: {
              input_tokens?: number;
              output_tokens?: number;
              reasoning_output_tokens?: number;
              total_tokens?: number;
            };
          };
          model_context_window?: number;
        };
      };
      try { rec = JSON.parse(line) as typeof rec; } catch { continue; }
      if (rec.type === 'turn_context' && typeof rec.payload?.model === 'string') {
        modelId = rec.payload.model;
      }
      if (rec.type === 'event_msg' && rec.payload?.info?.model_context_window) {
        contextLimit = rec.payload.info.model_context_window;
        const usage = rec.payload.info?.last_token_usage;
        if (usage) {
          contextTokens = usage.total_tokens ??
            ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.reasoning_output_tokens ?? 0));
        }
      } else if (rec.type === 'event_msg' && rec.payload?.model_context_window) {
        contextLimit = rec.payload.model_context_window;
      }
    }
  } catch {
    codexCache.set(sessionPath, { mtimeMs: stat.mtimeMs, size: stat.size, info: null });
    return null;
  }

  const info = modelId || contextTokens !== null || contextLimit !== null
    ? { modelId, contextTokens, contextLimit }
    : null;
  codexCache.set(sessionPath, { mtimeMs: stat.mtimeMs, size: stat.size, info });
  return info;
}

interface PaneInfo {
  model: string | null;
  contextLimit: number | null;  // parsed from "(1M context)" / "(200k context)"
  hasSwitch: boolean;           // true when "Set model to X" is visible
}

function parseContextSize(s: string): number | null {
  const lower = s.toLowerCase();
  const num = parseFloat(lower);
  if (isNaN(num)) return null;
  if (lower.endsWith('m')) return Math.round(num * 1_000_000);
  if (lower.endsWith('k')) return Math.round(num * 1_000);
  return Math.round(num);
}

/**
 * Parse model display name and context window size from a pane tail capture.
 * Matches two patterns Claude Code writes to the terminal:
 *   "Set model to Sonnet 4.6 and saved as…"  (after /model switch)
 *   "Opus 4.8 (1M context) with high effort…" (session header on start or /clear)
 * Returns LAST match so the most-recent event wins.
 */
// Known context-window sizes by model family. Used as a fallback when the
// session header has scrolled off the pane and is not in the 15-line tail.
function modelContextLimit(modelIdOrDisplay: string | null): number | null {
  if (!modelIdOrDisplay) return null;
  const id = modelIdOrDisplay.toLowerCase();
  if (id.includes('opus')) return 1_000_000;
  return null; // sonnet/haiku/fable all fit within the conf default (200k)
}

function parsePaneTail(tail: string): PaneInfo {
  const lines = tail.split('\n');
  let model: string | null = null;
  let contextLimit: number | null = null;
  let hasSwitch = false;
  for (const line of lines) {
    const switchM = line.match(/Set model to ((Opus|Sonnet|Haiku|Fable) \d+\.\d+)/);
    if (switchM) { model = switchM[1] ?? null; hasSwitch = true; continue; }
    // Header: "Opus 4.8 (1M context)" or "Sonnet 4.6 (200k context)"
    const headerM = line.trim().match(/^((Opus|Sonnet|Haiku|Fable) \d+\.\d+) \((\d+(?:\.\d+)?[KkMm]?) context\)/);
    if (headerM) {
      model = headerM[1] ?? null;
      contextLimit = parseContextSize(headerM[3] ?? '');
      // /model switch clears hasSwitch when a fresh header follows it
      hasSwitch = false;
      continue;
    }
    // Startup/post-clear banner without explicit context size, e.g.
    // "▝▜█████▛▘  Sonnet 4.6 with high effort · Claude Max".
    // The ASCII logo may prefix the line so don't anchor to start-of-line.
    // Only set model; contextLimit stays null (modelContextLimit() fills Opus).
    const bannerM = line.match(/((?:Opus|Sonnet|Haiku|Fable) \d+\.\d+) with (?:high|normal) effort/);
    if (bannerM) { model = bannerM[1] ?? null; hasSwitch = false; continue; }
  }
  return { model, contextLimit, hasSwitch };
}

/**
 * Full context snapshot for an agent. Returns null-valued fields (with the
 * configured limit) when no transcript is found so the UI hides the indicator.
 *
 * paneTail: optional recent pane output used to extract the model when the
 * transcript has no assistant turns yet (new session, after /clear) or when an
 * explicit /model switch is still visible in the pane.
 */
export function getAgentContext(
  agentName: string,
  workdir: string,
  stateDir: string,
  contextLimit: number,
  isBusy: boolean,
  paneTail?: string,
): AgentContext {
  const pane = paneTail ? parsePaneTail(paneTail) : { model: null, contextLimit: null, hasSwitch: false };
  const effectiveLimit = pane.contextLimit ?? modelContextLimit(pane.model) ?? contextLimit;
  const emptyWithLimit: AgentContext = { model: null, modelId: null, contextTokens: null, contextPct: null, contextLimit: effectiveLimit };

  const memo = agentMemo.get(agentName) ?? { transcriptPath: null, sessionId: null, trusted: false, lastGood: null, prevModel: null };
  agentMemo.set(agentName, memo);

  // Decide which transcript to read. The sidecar is authoritative (always the
  // MAIN session); a derived path is best-effort and must not override a path
  // we've already pinned, or a busy agent's meter would flap onto a sub-agent's
  // transcript that happens to be the newest file.
  const resolved = resolveTranscriptPath(agentName, workdir, stateDir);
  let pinnedPath: string | null;
  if (resolved?.source === 'sidecar') {
    // A genuine new main session (session_id changed) resets the retained value.
    // Likewise a path change *into* the sidecar — e.g. healing off a derived
    // fallback that had pinned (and cached lastGood from) a foreign session's
    // transcript — must discard that poisoned reading so it can't survive here.
    if (
      (memo.sessionId && resolved.sessionId && resolved.sessionId !== memo.sessionId) ||
      (memo.transcriptPath && resolved.path !== memo.transcriptPath)
    ) {
      memo.prevModel = memo.lastGood?.model ?? memo.prevModel ?? null;
      memo.lastGood = null;
    }
    memo.transcriptPath = resolved.path;
    memo.sessionId = resolved.sessionId;
    memo.trusted = true;
    pinnedPath = resolved.path;
  } else if (memo.transcriptPath && fs.existsSync(memo.transcriptPath)) {
    // Keep the path we already locked onto (and its trust level); ignore a newer
    // derived candidate.
    pinnedPath = memo.transcriptPath;
  } else if (resolved) {
    // First sighting (or pinned file gone): adopt the derived path and pin it.
    // Derived = newest-by-mtime in a workdir-keyed project dir that may be shared
    // with other live sessions, so it is NOT trusted for the token count.
    if (memo.transcriptPath && resolved.path !== memo.transcriptPath) memo.lastGood = null;
    memo.transcriptPath = resolved.path;
    memo.sessionId = null;
    memo.trusted = false;
    pinnedPath = resolved.path;
  } else {
    pinnedPath = memo.transcriptPath;
  }

  if (!pinnedPath) {
    if (pane.model) {
      const ctx = { ...emptyWithLimit, model: pane.model };
      memo.lastGood = ctx;
      memo.prevModel = pane.model;
      return ctx;
    }
    return isBusy && memo.lastGood ? memo.lastGood : emptyWithLimit;
  }

  // Only read a token count from a sidecar-pinned transcript (this agent's own
  // main session). A derived newest-by-mtime path can point at a FOREIGN session
  // sharing the same workdir-keyed project dir (e.g. another agent, or the
  // conductor's own session in this repo) — reading its tokens makes a freshly
  // spawned agent report a bogus non-zero %. Treat untrusted paths as "no turns
  // yet" so the meter falls through to the pane-derived 0%/empty state below.
  const info = memo.trusted ? readTranscriptInfo(pinnedPath) : null;
  if (!info) {
    // Session header visible in pane → context was just cleared (or fresh start).
    // Show 0% bar so the user sees the reset; discard any stale lastGood.
    if (pane.model && pane.contextLimit !== null) {
      memo.lastGood = null;
      memo.prevModel = pane.model;
      return { ...emptyWithLimit, model: pane.model, contextPct: 0 };
    }
    // Transient miss mid-conversation: keep last good value while busy so the
    // meter doesn't blink out during a tool call.
    if (isBusy && memo.lastGood) return memo.lastGood;
    if (pane.model) {
      // Model visible in the pane but no transcript turns.
      // Trusted path (sidecar pinned): context is genuinely empty (fresh start /
      // post-/clear) — show 0% so the user sees the reset.
      // Untrusted derived path: we can't distinguish "actually empty" from "wrong
      // transcript" — show model chip only (contextPct: null) so we don't
      // falsely imply 0% for an agent that's been working for minutes. Also skip
      // caching into lastGood so `isBusy && lastGood` can't get stuck at 0%.
      if (memo.lastGood) {
        memo.prevModel = memo.lastGood.model ?? memo.prevModel ?? null;
        memo.lastGood = null;
      }
      const contextPct = memo.trusted ? 0 : null;
      const ctx = { ...emptyWithLimit, model: pane.model, contextPct };
      if (contextPct !== null) memo.lastGood = ctx;
      memo.prevModel = pane.model;
      return ctx;
    }
    // /clear transition: pane header not yet visible but model is known from the
    // previous session. Show the chip at 0% until parsePaneTail finds the header.
    if (memo.prevModel) {
      return { ...emptyWithLimit, model: memo.prevModel, contextPct: 0 };
    }
    return emptyWithLimit;
  }

  const resolvedLimit = pane.contextLimit ?? modelContextLimit(info.modelId) ?? (effectiveLimit > 0 ? effectiveLimit : contextLimit);
  const contextPct = resolvedLimit > 0
    ? Math.min(100, Math.round((info.contextTokens / resolvedLimit) * 100))
    : null;
  // When a /model switch is explicitly visible in the pane, it's more recent
  // than the last transcript assistant turn — use the pane-derived display name
  // until the next assistant response overwrites lastGood from the transcript.
  const ctx: AgentContext = {
    model: (pane.hasSwitch && pane.model) ? pane.model : modelDisplayName(info.modelId),
    modelId: (pane.hasSwitch && pane.model) ? null : info.modelId,
    contextTokens: info.contextTokens,
    contextPct,
    contextLimit: resolvedLimit,
  };
  if (ctx.model != null || ctx.contextPct != null) memo.lastGood = ctx;
  if (ctx.model) memo.prevModel = ctx.model;
  return ctx;
}

export function getCodexAgentContext(
  workdir: string,
  contextLimit: number,
): AgentContext {
  const sessionPath = resolveCodexSessionPath(workdir);
  const empty: AgentContext = { model: null, modelId: null, contextTokens: null, contextPct: null, contextLimit };
  if (!sessionPath) return empty;

  const info = readCodexInfo(sessionPath);
  if (!info) return empty;

  const resolvedLimit = info.contextLimit ?? contextLimit;
  const contextTokens = info.contextTokens;
  return {
    model: codexModelDisplayName(info.modelId),
    modelId: info.modelId,
    contextTokens,
    contextPct: contextTokens !== null && resolvedLimit > 0
      ? Math.min(100, Math.round((contextTokens / resolvedLimit) * 100))
      : null,
    contextLimit: resolvedLimit,
  };
}
