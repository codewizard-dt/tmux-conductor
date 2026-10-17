import type { BgLastRestart as BgLastRestartValue } from '../lib/api'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { useNow } from '../lib/useNow'

interface BgLastRestartProps {
  /** Last successful restart; null/absent = none recorded (also an older host-server without the field). */
  lastRestart?: BgLastRestartValue | null | undefined
  className?: string
}

// One muted line: "Restarted 3m ago by <agent>" / "... from the dashboard" /
// "No restarts recorded". The caller is the self-reported X-Conductor-Agent
// value (a guardrail, not authentication), so the tooltip says so.
export function BgLastRestart({ lastRestart, className }: BgLastRestartProps) {
  const tick = useNow()
  const cls = `text-[11px] text-muted-2 ${className ?? ''}`

  if (!lastRestart) {
    return <span data-testid="bg-last-restart" className={cls}>No restarts recorded</span>
  }

  const { at, caller } = lastRestart
  // The useNow tick can be up to 30 s stale, while a restart that just landed carries a
  // fresher server timestamp; never let the clock trail `at`, or the label would degrade
  // to an absolute time (a "future" timestamp) until the next tick.
  const atMs = Date.parse(at)
  const now = Number.isNaN(atMs) ? tick : Math.max(tick, atMs)
  const title = caller === null
    ? `${at} - restarted from the dashboard`
    : `${at} - restarted by ${caller} (reported by the caller)`

  return (
    <span data-testid="bg-last-restart" className={cls} title={title}>
      {'Restarted '}
      <time dateTime={at}>{formatRelativeTime(at, now)}</time>
      {caller === null ? (
        ' from the dashboard'
      ) : (
        <>
          {' by '}
          <span className="font-mono">{caller}</span>
        </>
      )}
    </span>
  )
}
