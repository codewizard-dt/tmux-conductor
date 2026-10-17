/** A timestamp this far ahead of `now` is treated as clock skew ("just now"), not the future. */
const SKEW_TOLERANCE_MS = 5000

/**
 * Compact relative time for an ISO timestamp: `just now` (< 5 s), then `Ns`,
 * `Nm`, `Nh`, `Nd` ago. An unparseable timestamp yields `unknown time`; a
 * timestamp further in the future than the skew tolerance degrades to the
 * absolute local time rather than a misleading "ago".
 *
 * TASK-0207: `CheckpointList.tsx` (`formatRelativeTimestamp`), `ScheduleList.tsx`
 * (`formatRelative`) and `BackgroundProcessesTab.tsx` (`formatRelative`) keep
 * private near-duplicates of this; they could migrate to this helper.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown time'
  const deltaMs = now - then
  if (deltaMs < -SKEW_TOLERANCE_MS) return new Date(then).toLocaleString()
  const secs = Math.max(0, Math.floor(deltaMs / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${String(secs)}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${String(mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${String(hours)}h ago`
  return `${String(Math.floor(hours / 24))}d ago`
}
