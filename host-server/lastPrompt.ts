// Reader for the hook-written `last_prompt` field of the per-agent sidecar
// (`<stateDir>/<windowName>.meta.json`). The UserPromptSubmit hook persists the
// exact prompt the user submitted as `last_prompt: { text, ts }`; the host-server
// surfaces it to the dashboard as `agent.lastPrompt` on the snapshot.
//
// Storage rules (TASK-0220): text is capped at 2000 UTF-16 units total (1999 +
// one '…' marker at most, never splitting a surrogate pair), re-applied here
// idempotently; empty prompts are never stored; unknown keys (e.g. `prompt_id`)
// are tolerated and ignored. The value is retained until the hook writes a newer
// one: no age expiry, no clearing on idle.
//
// The stored prompt may contain secrets: never log its value.
import * as fs from 'fs';
import * as path from 'path';

export interface LastPrompt {
  text: string;
  ts: string;
}

export const LAST_PROMPT_MAX_CHARS = 2000;

const ELLIPSIS = '…';

/** Cap `text` to LAST_PROMPT_MAX_CHARS; idempotent on an already-capped value. */
export function capLastPromptText(text: string): string {
  if (text.length <= LAST_PROMPT_MAX_CHARS) return text;
  let cut = text.slice(0, LAST_PROMPT_MAX_CHARS - 1);
  const last = cut.charCodeAt(cut.length - 1);
  // Drop a dangling high surrogate so the cut never splits a pair.
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: LastPrompt | null;
}

// Keyed by sidecar path; re-parsed only when mtime/size change, so the 2 s
// buildSnapshot tick costs one statSync per agent.
const cache = new Map<string, CacheEntry>();

function sidecarPath(stateDir: string, windowName: string): string {
  return path.join(stateDir, `${windowName}.meta.json`);
}

function parseLastPrompt(raw: string): LastPrompt | null {
  let meta: unknown;
  try {
    meta = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof meta !== 'object' || meta === null) return null;
  const lp = (meta as { last_prompt?: unknown }).last_prompt;
  if (typeof lp !== 'object' || lp === null || Array.isArray(lp)) return null;
  const { text, ts } = lp as { text?: unknown; ts?: unknown };
  if (typeof text !== 'string' || text === '') return null;
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  return { text: capLastPromptText(text), ts };
}

/** Never throws; null on any missing/unreadable/malformed sidecar or field. */
export function readLastPrompt(stateDir: string, windowName: string): LastPrompt | null {
  const file = sidecarPath(stateDir, windowName);
  try {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
    const value = parseLastPrompt(fs.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
    return value;
  } catch {
    cache.delete(file);
    return null;
  }
}

/**
 * Best-effort removal of an agent's sidecar (DELETE /agents/:id), so a
 * re-created same-named agent does not inherit the deleted agent's last_prompt.
 * Also drops the reader's cache entry. Never throws.
 */
export function removeLastPromptSidecar(stateDir: string, windowName: string): void {
  const file = sidecarPath(stateDir, windowName);
  cache.delete(file);
  try {
    fs.unlinkSync(file);
  } catch { /* ENOENT or unremovable: best-effort */ }
}

export function __resetLastPromptCacheForTests(): void {
  cache.clear();
}
