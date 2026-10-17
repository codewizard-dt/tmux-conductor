// Pure predicate deciding whether a background process's status changed enough
// between two status ticks to warrant broadcasting a `bg-update` SSE event.
// Extracted from index.ts's pollAndDiff so it can be unit-tested (index.ts has
// top-level side effects and cannot be imported in a test).
//
// Types are structural on purpose: index.ts's BgStatus is a supertype-compatible
// superset of DiffableBg, so no import from index.ts is needed (and none must be
// added — that would create a cycle).

export interface DiffableBg {
  windowPresent: boolean;
  state: string | null;
  liveness: string;
  // Optional so callers/fixtures that predate the field still type-check;
  // undefined and null compare equal (both mean "never restarted").
  lastRestart?: { at: string; caller: string | null } | null | undefined;
}

/**
 * True when `next` differs from `prev` in any field the dashboard renders live,
 * or when there is no previous snapshot for the process (first sight).
 *
 * lastRestart is included because a restart that lands while the window stays
 * present and liveness stays `running` changes only that field; without it the
 * UI would show a stale "last restarted" line until reload.
 */
export function bgStatusChanged(prev: DiffableBg | undefined, next: DiffableBg): boolean {
  if (!prev) return true;
  if (
    prev.windowPresent !== next.windowPresent ||
    prev.state !== next.state ||
    prev.liveness !== next.liveness
  ) {
    return true;
  }
  const a = prev.lastRestart ?? null;
  const b = next.lastRestart ?? null;
  if (a === null || b === null) return a !== b;
  return a.at !== b.at || a.caller !== b.caller;
}
