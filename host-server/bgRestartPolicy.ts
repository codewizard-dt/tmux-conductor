import * as fs from 'node:fs';
import * as path from 'node:path';

// TASK-0193: restart policy for `POST /bg-processes/:slug/restart` — caller
// identification, the per-bg-process agent cooldown, and the append-only audit
// log. Pure/injectable pieces only; the route wiring lives in index.ts.
//
// IMPORTANT — this is a runaway-loop GUARDRAIL, NOT authentication. The
// server is single-user localhost with no auth. Callers self-identify with the
// `X-Conductor-Agent` header (`callerKind: 'agent'`); a caller that omits the
// header is treated as the dashboard (`callerKind: 'dashboard'`) and is exempt
// from the cooldown. An agent that leaves the header off therefore bypasses the
// agent cooldown; it is still audit-logged, just as `dashboard`. The header is
// recorded verbatim (after trim / control-char strip / length cap) and never
// trusted for anything else.
//
// Time convention: every `now` / `lastRestartAt` / `at` here is epoch
// milliseconds (a number, `Date.now()`). Only the audit record's `ts` and
// `RestartHistory.lastRestart().at` are ISO strings.

/** Request header carrying the calling agent's window/agent name (Node lowercases header names). */
export const BG_CALLER_HEADER = 'x-conductor-agent';

/** Max length of a recorded caller identity, in UTF-16 code units. */
export const BG_CALLER_MAX_LENGTH = 128;

/** Audit log file name, under the conductor `LOG_DIR`. */
export const BG_RESTARTS_LOG_FILE = 'bg-restarts.jsonl';

/** Max bytes read from the tail of the audit log when seeding `RestartHistory`. */
export const BG_RESTARTS_TAIL_BYTES = 256 * 1024;

/**
 * Who is calling. `agent` = the request carried a non-empty `X-Conductor-Agent`
 * header (cooldown applies); `dashboard` = it did not (cooldown-exempt). This
 * is self-declared, not authenticated: see the module comment.
 */
export type BgCallerKind = 'agent' | 'dashboard';

/** Result of a restart attempt. `denied` is the same-project guard (TASK-0194, see bgAccess.ts). */
export type BgRestartOutcome = 'restarted' | 'cooldown' | 'failed' | 'denied';

/** Why a restart was `denied` (TASK-0194). */
export type BgRestartDenyReason = 'project-mismatch' | 'unknown-caller' | 'ambiguous-caller' | 'unscoped';

// Deliberately strips C0/C1 control chars and DEL.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Normalize the `X-Conductor-Agent` header value: an array header (repeated
 * header) uses its first element; non-strings, and strings that are empty after
 * trimming and stripping control characters, yield `null` (=> dashboard).
 * Otherwise the value is stripped of control characters, trimmed, capped at
 * {@link BG_CALLER_MAX_LENGTH} and returned verbatim.
 */
export function parseCallerHeader(raw: unknown): string | null {
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim().slice(0, BG_CALLER_MAX_LENGTH).trim();
  return cleaned === '' ? null : cleaned;
}

/** `agent` when a caller identity was supplied, else `dashboard`. */
export function callerKindFor(caller: string | null): BgCallerKind {
  return caller === null ? 'dashboard' : 'agent';
}

export interface EvaluateCooldownInput {
  /** Epoch ms. */
  now: number;
  /** Epoch ms of the last successful restart of this bg process; null/undefined = never. */
  lastRestartAt: number | null | undefined;
  /** Cooldown length in ms; <= 0 disables the cooldown. */
  cooldownMs: number;
  callerKind: BgCallerKind;
}

export type CooldownDecision =
  | { allowed: true }
  | { allowed: false; retryAfterS: number; cooldownRemainingS: number };

/**
 * Pure cooldown check. Only `agent` callers are limited; `dashboard` is always
 * allowed. The cooldown is armed by a successful restart by ANY caller kind
 * (the caller of this function passes the last such timestamp).
 * `retryAfterS` / `cooldownRemainingS` are the remaining whole seconds, rounded
 * up, minimum 1.
 */
export function evaluateCooldown(input: EvaluateCooldownInput): CooldownDecision {
  const { now, lastRestartAt, cooldownMs, callerKind } = input;
  if (callerKind !== 'agent') return { allowed: true };
  if (lastRestartAt === null || lastRestartAt === undefined) return { allowed: true };
  if (!(cooldownMs > 0)) return { allowed: true };
  const remainingMs = lastRestartAt + cooldownMs - now;
  if (remainingMs <= 0) return { allowed: true };
  const remainingS = Math.max(1, Math.ceil(remainingMs / 1000));
  return { allowed: false, retryAfterS: remainingS, cooldownRemainingS: remainingS };
}

export interface BgRestartAuditInput {
  /** Epoch ms or a Date; serialized as an ISO string. */
  ts: number | Date;
  /** Bg process slug / name. */
  bg: string;
  callerKind: BgCallerKind;
  caller: string | null;
  outcome: BgRestartOutcome;
  cooldownRemainingS?: number;
  mechanism?: string;
  step?: string;
  status?: number;
  /** Set when `outcome` is `denied`. */
  reason?: BgRestartDenyReason;
}

/** One JSONL line in `bg-restarts.jsonl`. Optional keys are omitted when not applicable. */
export interface BgRestartAuditRecord {
  ts: string;
  bg: string;
  callerKind: BgCallerKind;
  caller: string | null;
  outcome: BgRestartOutcome;
  cooldownRemainingS?: number;
  mechanism?: string;
  step?: string;
  status?: number;
  /** Set when `outcome` is `denied`. */
  reason?: BgRestartDenyReason;
}

/** Build a JSON-serializable audit record, dropping undefined optional keys. */
export function buildAuditRecord(input: BgRestartAuditInput): BgRestartAuditRecord {
  const record: BgRestartAuditRecord = {
    ts: new Date(input.ts).toISOString(),
    bg: input.bg,
    callerKind: input.callerKind,
    caller: input.caller,
    outcome: input.outcome,
  };
  if (input.cooldownRemainingS !== undefined) record.cooldownRemainingS = input.cooldownRemainingS;
  if (input.mechanism !== undefined) record.mechanism = input.mechanism;
  if (input.step !== undefined) record.step = input.step;
  if (input.status !== undefined) record.status = input.status;
  if (input.reason !== undefined) record.reason = input.reason;
  return record;
}

/** Filesystem seam for {@link appendAuditRecord}. */
export interface AuditDeps {
  mkdir(dir: string): void;
  appendFile(filePath: string, text: string): void;
}

export const defaultAuditDeps: AuditDeps = {
  mkdir: (dir) => {
    fs.mkdirSync(dir, { recursive: true });
  },
  appendFile: (filePath, text) => {
    fs.appendFileSync(filePath, text);
  },
};

/**
 * Append one record to `<logDir>/bg-restarts.jsonl`. Swallows every error —
 * audit logging must never break the control plane — and returns whether the
 * write succeeded.
 */
export function appendAuditRecord(deps: AuditDeps, logDir: string, record: BgRestartAuditRecord): boolean {
  try {
    deps.mkdir(logDir);
    deps.appendFile(path.join(logDir, BG_RESTARTS_LOG_FILE), JSON.stringify(record) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Default tail reader: the last {@link BG_RESTARTS_TAIL_BYTES} of the file,
 * dropping the first (possibly partial) line when the file was truncated to fit.
 * Returns null when the file is missing/unreadable.
 */
export function readLogTail(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - BG_RESTARTS_TAIL_BYTES);
    const length = size - start;
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buf, read, length - read, start + read);
      if (n <= 0) break;
      read += n;
    }
    let text = buf.subarray(0, read).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return text;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

export interface RestartHistoryOptions {
  /** Path to `bg-restarts.jsonl`; when absent, nothing is seeded. */
  logPath?: string;
  /** Injectable tail reader; returns the log's tail text, or null if unavailable. */
  readTail?: (filePath: string) => string | null;
}

interface LastRestart {
  /** Epoch ms. */
  at: number;
  caller: string | null;
}

/**
 * In-memory "last successful restart per bg" map. Seeded lazily, once, from the
 * tail of the audit JSONL so the cooldown survives a host-server restart. Only
 * `outcome === 'restarted'` lines arm it; `cooldown` / `failed` / `denied`
 * lines are ignored.
 */
export class RestartHistory {
  private readonly logPath: string | undefined;
  private readonly readTail: (filePath: string) => string | null;
  private readonly map = new Map<string, LastRestart>();
  private seeded = false;

  constructor(options: RestartHistoryOptions = {}) {
    this.logPath = options.logPath;
    this.readTail = options.readTail ?? readLogTail;
  }

  private seed(): void {
    if (this.seeded) return;
    this.seeded = true;
    if (this.logPath === undefined) return;
    let text: string | null = null;
    try {
      text = this.readTail(this.logPath);
    } catch {
      text = null;
    }
    if (text === null) return;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const rec = parsed as Record<string, unknown>;
      if (rec['outcome'] !== 'restarted') continue;
      if (typeof rec['bg'] !== 'string' || typeof rec['ts'] !== 'string') continue;
      const at = Date.parse(rec['ts']);
      if (Number.isNaN(at)) continue;
      const caller = typeof rec['caller'] === 'string' ? rec['caller'] : null;
      const existing = this.map.get(rec['bg']);
      if (existing === undefined || at >= existing.at) this.map.set(rec['bg'], { at, caller });
    }
  }

  /** Last successful restart of `bg` (epoch ms), or null. */
  last(bg: string): LastRestart | null {
    this.seed();
    return this.map.get(bg) ?? null;
  }

  /** Record a successful restart; arms the cooldown for every caller kind. */
  recordSuccess(bg: string, atMs: number, caller: string | null): void {
    this.seed();
    this.map.set(bg, { at: atMs, caller });
  }

  /** Status-payload shape: last successful restart with an ISO timestamp, or null. */
  lastRestart(bg: string): { at: string; caller: string | null } | null {
    const last = this.last(bg);
    return last === null ? null : { at: new Date(last.at).toISOString(), caller: last.caller };
  }
}

const restartHistoryCache = new Map<string, RestartHistory>();

/**
 * Shared, lazily-seeded {@link RestartHistory} per `logDir`. The restart route
 * and `buildBgStatuses` use the same instance, and it seeds from the on-disk
 * audit log on first use, so a host-server restart does not reset the cooldown.
 */
export function getRestartHistory(logDir: string): RestartHistory {
  let history = restartHistoryCache.get(logDir);
  if (history === undefined) {
    history = new RestartHistory({ logPath: path.join(logDir, BG_RESTARTS_LOG_FILE) });
    restartHistoryCache.set(logDir, history);
  }
  return history;
}

/** Test seam: drop all cached {@link RestartHistory} instances. */
export function clearRestartHistoryCache(): void {
  restartHistoryCache.clear();
}
