import { useCallback, useEffect, useState } from 'react'
import { fetchAgentCheckpoints, rollbackAgent, type AgentCheckpoint } from '../lib/api'
import ConfirmDialog from './ConfirmDialog'

/**
 * Relative-time formatting: the codebase has no shared relative-time utility module — the only
 * existing implementation is a pair of local (non-exported) formatRelative/formatDuration
 * helpers inside ScheduleList.tsx. Rather than import a private helper from a sibling component
 * or add a new shared module for one caller, this mirrors that same local-helper convention.
 */
function formatRelativeTimestamp(tsSeconds: number): string {
  const deltaMs = Date.now() - tsSeconds * 1000
  if (deltaMs < 0) return 'just now'
  const seconds = Math.round(deltaMs / 1000)
  if (seconds < 60) return `${seconds.toString()}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes.toString()}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours.toString()}h ago`
  const days = Math.round(hours / 24)
  return `${days.toString()}d ago`
}

/**
 * Structural mirror of DiffPanel.tsx (both are agent-scoped <details> panels rendered
 * side-by-side in AgentDetailModal, alongside UsageBreakdown — all three share the same
 * "mt-3 flex-shrink-0" / uppercase summary label styling for visual consistency).
 */
function CheckpointList({ agentId }: { agentId: number }) {
  const [checkpoints, setCheckpoints] = useState<AgentCheckpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingRollback, setPendingRollback] = useState<number | null>(null)

  const load = useCallback((signal: { cancelled: boolean }) => {
    queueMicrotask(() => {
      if (signal.cancelled) return
      setLoading(true)
      setError(null)
    })
    fetchAgentCheckpoints(agentId)
      .then((data) => {
        if (signal.cancelled) return
        setCheckpoints(data.checkpoints)
      })
      .catch((err: unknown) => {
        if (signal.cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load checkpoints')
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

  function doRollback(checkpointId: number) {
    setPendingRollback(null)
    rollbackAgent(agentId, checkpointId)
      .then(() => {
        load({ cancelled: false })
        // Cross-component refresh: the codebase has no existing event bus, shared context, or
        // dispatchEvent/addEventListener convention for one panel to notify a sibling (checked
        // AgentList.tsx, DiffPanel.tsx, and the rest of frontend/src — none found). Broadcasting
        // a CustomEvent here so DiffPanel can opt in later; DiffPanel does not yet listen for
        // this event, so post-rollback the diff panel will not auto-refresh until a follow-up
        // adds a matching `window.addEventListener('conductor:diff-refresh', ...)` there. Not
        // wiring that listener is intentional — out of scope for this component.
        window.dispatchEvent(new CustomEvent('conductor:diff-refresh', { detail: { agentId } }))
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to roll back')
      })
  }

  if (loading && !loaded) {
    return <p className="mt-3 text-[12px] italic text-muted-2">Loading checkpoints…</p>
  }

  return (
    <details className="mt-3 flex-shrink-0">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted select-none">
        Checkpoints
      </summary>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => { load({ cancelled: false }) }}
          className="inline-flex h-6 cursor-pointer items-center rounded-[6px] border border-line bg-white px-2 text-[11px] font-medium text-muted transition hover:bg-canvas active:scale-[0.985]"
        >
          Refresh
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-accent-red">{error}</p>
      ) : checkpoints.length === 0 ? (
        <p className="mt-2 text-[12px] italic text-muted-2">No checkpoints yet — checkpoints are taken before each task dispatch.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {checkpoints.map((cp) => (
            <li
              key={cp.id}
              className="flex items-center justify-between gap-2 rounded-[6px] border border-line bg-canvas px-2 py-1 text-[11px]"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-ink">{formatRelativeTimestamp(cp.ts)}</span>
                <span className="truncate font-mono text-muted-2" title={cp.stashRef}>{cp.stashRef}</span>
              </div>
              <button
                type="button"
                onClick={() => { setPendingRollback(cp.id) }}
                className="inline-flex h-6 flex-shrink-0 cursor-pointer items-center rounded-[6px] border border-line bg-white px-2 text-[11px] font-medium text-muted transition hover:bg-canvas active:scale-[0.985]"
              >
                Rollback
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingRollback !== null}
        message="Roll back to this checkpoint? This will overwrite uncommitted work in the worktree."
        confirmLabel="Roll back"
        onConfirm={() => { if (pendingRollback !== null) doRollback(pendingRollback) }}
        onCancel={() => { setPendingRollback(null) }}
      />
    </details>
  )
}

export default CheckpointList
