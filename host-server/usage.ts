// usage.ts — extract per-agent token usage from Claude Code transcript JSONL.
//
// Each poll, extractUsageDeltas() incrementally reads the agent's MAIN-session
// transcript (sidecar-pinned only — see resolveTranscriptPath) and emits
// per-model UsageDelta records for the requests that appeared or changed since
// the previous poll. Claude Code writes multiple JSONL entries per API response
// while streaming, all sharing one top-level `requestId` with growing
// `output_tokens` — naive line summation double-counts, so we keep only the
// latest usage per requestId (last-entry-wins; fallback keys message.id, uuid),
// the same accounting ccusage and `/cost` use.
//
// Bootstrap contract: after any memo reset (process restart, session change,
// truncation) the next call re-parses the transcript from byte offset 0 and
// RE-EMITS full-file deltas. The accumulator (usage-store.ts) owns idempotency:
// it folds deltas into in-memory absolute session totals and overwrite-upserts
// them, so replayed deltas never inflate the persisted values.
//
// Known caveat (by design, matches `/cost`): usage.input_tokens is sometimes a
// streaming placeholder (0/1) and output_tokens may exclude thinking tokens;
// the cache token fields are accurate. We report what the transcript says.
//
// Everything here is best-effort: any I/O or parse failure yields [] — this
// must never crash the poll loop.

import * as fs from 'fs';
import { resolveTranscriptPath } from './context.ts';

export interface UsageDelta {
  agentName: string;
  sessionId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUSD: number | null;
  ts: string;
}

interface RequestUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  model: string;
  costUSD: number | null;
}

interface UsageMemo {
  transcriptPath: string;
  sessionId: string | null;
  byteOffset: number;
  remainder: Buffer;          // trailing partial line (raw bytes — never split a UTF-8 char)
  sessionStart: string | null; // timestamp of the first parsed assistant record (restart-stable upsert key)
  perRequest: Map<string, RequestUsage>;
}

const usageMemo = new Map<string, UsageMemo>();

/** Drop the incremental-read memo for one agent (agent deletion, tests). */
export function resetUsageMemo(agentName: string): void {
  usageMemo.delete(agentName);
}

/**
 * Restart-stable session key for the agent's current session: the timestamp of
 * the first assistant record parsed from the transcript (bootstrap re-reads
 * from offset 0, so this survives host-server restarts). Null until the first
 * usage-bearing record is seen.
 */
export function getUsageSessionStart(agentName: string): string | null {
  return usageMemo.get(agentName)?.sessionStart ?? null;
}

interface TranscriptUsageRec {
  type?: string;
  isSidechain?: boolean;
  requestId?: string;
  uuid?: string;
  timestamp?: string;
  costUSD?: number;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

/**
 * Incrementally parse the agent's transcript and return per-model usage deltas
 * for requests newly seen (or whose last-entry usage changed) since the
 * previous call. Returns [] for non-Claude agents, agents without a hook
 * sidecar, unchanged transcripts, and on any error.
 */
export function extractUsageDeltas(agentName: string, workdir: string, stateDir: string): UsageDelta[] {
  try {
    const resolved = resolveTranscriptPath(agentName, workdir, stateDir);
    // Sidecar-pinned transcripts only: a derived newest-by-mtime path can point
    // at a foreign session when agents share a workdir — never count from it.
    if (!resolved || resolved.source !== 'sidecar') return [];

    let memo = usageMemo.get(agentName);
    if (memo && (memo.transcriptPath !== resolved.path || memo.sessionId !== resolved.sessionId)) {
      memo = undefined; // new session/transcript — full re-bootstrap
    }

    const stat = fs.statSync(resolved.path);
    if (memo && stat.size < memo.byteOffset) memo = undefined; // truncation/rotation
    if (!memo) {
      memo = {
        transcriptPath: resolved.path,
        sessionId: resolved.sessionId,
        byteOffset: 0,
        remainder: Buffer.alloc(0),
        sessionStart: null,
        perRequest: new Map(),
      };
      usageMemo.set(agentName, memo);
    }
    if (stat.size === memo.byteOffset) return []; // fast path: nothing appended

    const chunk = Buffer.alloc(stat.size - memo.byteOffset);
    const fd = fs.openSync(resolved.path, 'r');
    try {
      fs.readSync(fd, chunk, 0, chunk.length, memo.byteOffset);
    } finally {
      fs.closeSync(fd);
    }
    memo.byteOffset = stat.size;

    const combined = memo.remainder.length > 0 ? Buffer.concat([memo.remainder, chunk]) : chunk;
    const lastNl = combined.lastIndexOf(0x0a);
    if (lastNl === -1) {
      memo.remainder = combined;
      return [];
    }
    const complete = combined.subarray(0, lastNl).toString('utf8');
    memo.remainder = Buffer.from(combined.subarray(lastNl + 1));

    // Aggregate per model across this call's new/changed requests.
    const byModel = new Map<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; costUSD: number | null }>();

    for (const line of complete.split('\n')) {
      if (!line || line.indexOf('"usage"') === -1) continue;
      let rec: TranscriptUsageRec;
      try { rec = JSON.parse(line) as TranscriptUsageRec; } catch { continue; }
      if (rec.type !== 'assistant' || rec.isSidechain) continue;
      const usage = rec.message?.usage;
      const model = rec.message?.model;
      if (!usage || !model || model === '<synthetic>') continue;

      if (memo.sessionStart === null && rec.timestamp) memo.sessionStart = rec.timestamp;

      const key = rec.requestId ?? rec.message?.id ?? rec.uuid;
      if (!key) continue;
      const next: RequestUsage = {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        model,
        costUSD: typeof rec.costUSD === 'number' ? rec.costUSD : null,
      };
      const prev = memo.perRequest.get(key);
      const delta = {
        inputTokens: next.inputTokens - (prev?.inputTokens ?? 0),
        outputTokens: next.outputTokens - (prev?.outputTokens ?? 0),
        cacheCreationTokens: next.cacheCreationTokens - (prev?.cacheCreationTokens ?? 0),
        cacheReadTokens: next.cacheReadTokens - (prev?.cacheReadTokens ?? 0),
        costUSD: next.costUSD !== null ? next.costUSD - (prev?.costUSD ?? 0) : null,
      };
      memo.perRequest.set(key, next);
      if (delta.inputTokens === 0 && delta.outputTokens === 0 && delta.cacheCreationTokens === 0 &&
          delta.cacheReadTokens === 0 && (delta.costUSD === null || delta.costUSD === 0)) continue;

      const agg = byModel.get(model) ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, costUSD: null };
      agg.inputTokens += delta.inputTokens;
      agg.outputTokens += delta.outputTokens;
      agg.cacheCreationTokens += delta.cacheCreationTokens;
      agg.cacheReadTokens += delta.cacheReadTokens;
      if (delta.costUSD !== null) agg.costUSD = (agg.costUSD ?? 0) + delta.costUSD;
      byModel.set(model, agg);
    }

    if (byModel.size === 0) return [];
    const ts = new Date().toISOString();
    return [...byModel.entries()].map(([model, agg]) => ({
      agentName,
      sessionId: memo.sessionId,
      model,
      ...agg,
      ts,
    }));
  } catch {
    return [];
  }
}
