import { useCallback, useEffect, useState } from 'react'
import { fetchAgentDiff } from '../lib/api'

/**
 * Loading-state design choice: show a lightweight "Loading diff…" placeholder while the
 * initial fetch is in flight (satisfies "shows a loading state"), then once the fetch
 * completes, collapse to rendering nothing at all if the agent turns out to be non-git
 * (diff === null && base === null). This is simpler than pre-emptively hiding during load
 * (which would need a second signal to know "loading, but might still be non-git") and the
 * placeholder window is brief enough that it doesn't read as a flash for non-git agents.
 */
function DiffPanel({ agentId, onPresenceChange }: { agentId: number; onPresenceChange?: (present: boolean) => void }) {
  const [diff, setDiff] = useState<string | null>(null)
  const [base, setBase] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((signal: { cancelled: boolean }) => {
    queueMicrotask(() => {
      if (signal.cancelled) return
      setLoading(true)
      setError(null)
    })
    fetchAgentDiff(agentId)
      .then((data) => {
        if (signal.cancelled) return
        setDiff(data.diff)
        setBase(data.base)
        setTruncated(data.truncated ?? false)
      })
      .catch((err: unknown) => {
        if (signal.cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load diff')
      })
      .finally(() => {
        if (signal.cancelled) return
        setLoading(false)
        setLoaded(true)
      })
  }, [agentId])

  useEffect(() => {
    const signal = { cancelled: false }
    load(signal)
    return () => { signal.cancelled = true }
  }, [agentId, load])

  useEffect(() => {
    function handleDiffRefresh(event: Event) {
      const detail = (event as CustomEvent<{ agentId: number }>).detail
      if (detail.agentId === agentId) {
        load({ cancelled: false })
      }
    }
    window.addEventListener('conductor:diff-refresh', handleDiffRefresh)
    return () => { window.removeEventListener('conductor:diff-refresh', handleDiffRefresh) }
  }, [agentId, load])

  // Non-git agent (endpoint reports no base branch): this component owns its own visibility
  // gating, same condition as before — but now relayed outward via onPresenceChange (TASK-157)
  // so the parent tab list can omit the Diff tab entirely for non-git agents, instead of only
  // expressing absence as an internal `return null`. Never null out on top of an error, and
  // stay present while still loading (the loading branch below renders real content).
  const present = !(loaded && !error && diff === null && base === null)

  useEffect(() => {
    onPresenceChange?.(present)
  }, [present, onPresenceChange])

  if (!present) return null

  if (loading && !loaded) {
    return <p className="text-[12px] italic text-muted-2">Loading diff…</p>
  }

  const lines = diff ? diff.split('\n') : []

  function lineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'text-ink'
    if (line.startsWith('+')) return 'text-accent-green'
    if (line.startsWith('-')) return 'text-accent-red'
    if (line.startsWith('@@')) return 'text-accent-blue'
    return 'text-ink'
  }

  // TASK-157: no longer a standalone <details> accordion — this is now the Diff tab's whole
  // panel content, so the "Changes" heading is a plain label, not a collapsible summary.
  return (
    <div className="flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Changes</span>
        <button
          type="button"
          onClick={() => { load({ cancelled: false }) }}
          className="inline-flex h-6 cursor-pointer items-center rounded-[6px] border border-line bg-card px-2 text-[11px] font-medium text-muted transition hover:bg-canvas active:scale-[0.985]"
        >
          Refresh
        </button>
        {truncated && <span className="text-[11px] italic text-muted-2">Diff truncated</span>}
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-accent-red">{error}</p>
      ) : diff === '' ? (
        <p className="mt-2 text-[12px] italic text-muted-2">No changes yet</p>
      ) : (
        <pre className="mt-2 max-h-[400px] overflow-y-auto rounded-[7px] border border-line bg-canvas p-2 font-mono text-[11px] leading-snug">
          {lines.map((line, i) => (
            <div key={i} className={lineClass(line)}>{line}</div>
          ))}
        </pre>
      )}
    </div>
  )
}

export default DiffPanel
