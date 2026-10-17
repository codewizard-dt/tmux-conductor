import { useEffect, useRef, useState } from 'react'
import { restartBgProcess, type BgRestartResult } from '../lib/api'
import { bgQualifiedLabel } from '../lib/bgLabel'
import ConfirmDialog from './ConfirmDialog'

const NOTICE_MS = 3000

interface BgRestartButtonProps {
  /** Route identity (`<projectName>-<name>`, TASK-0196). */
  slug: string
  /** Display name of the process (unique per project only). */
  label: string
  /** When false the action is a start (the window is not running), not a restart. */
  windowPresent: boolean
  /** Owning project; shown in the confirmation so same-named processes are unambiguous. */
  projectName: string
  onRestarted?: (result: BgRestartResult) => void
  className?: string
}

// Shared by the Background tab rows and the bg process tile so both call the
// same server-side restart route (one code path with the agent-facing script).
export function BgRestartButton({ slug, label, windowPresent, projectName, onRestarted, className }: BgRestartButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Synchronous guard: state updates are async, so a fast second confirm could
  // otherwise slip a duplicate request in before `restarting` renders.
  const inFlight = useRef(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
  }, [])

  const verb = windowPresent ? 'Restart' : 'Start'
  const qualified = bgQualifiedLabel({ name: label, projectName })
  const message = windowPresent
    ? `Stops the running process and starts it again with its saved launch command. Everyone in project ${projectName} who is using it will be interrupted. Its earlier output is kept in the log, with a restart marker.`
    : `Starts ${label}; its window is not running.`

  async function doRestart() {
    if (inFlight.current) return
    inFlight.current = true
    setConfirming(false)
    setError(null)
    setNotice(null)
    setRestarting(true)
    try {
      const result = await restartBgProcess(slug)
      onRestarted?.(result)
      setNotice(windowPresent ? 'Restarted' : 'Started')
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null
        setNotice(null)
      }, NOTICE_MS)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Restart failed')
    } finally {
      inFlight.current = false
      setRestarting(false)
    }
  }

  return (
    <span className="inline-flex flex-shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label={`${verb} ${label}`}
        aria-busy={restarting}
        disabled={restarting}
        onClick={() => {
          setError(null)
          setConfirming(true)
        }}
        className={`inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-line bg-card px-3 text-[12px] font-medium text-ink-2 transition hover:bg-canvas active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40 ${className ?? ''}`}
      >
        {restarting ? `${verb === 'Restart' ? 'Restarting' : 'Starting'}…` : verb}
      </button>
      <span aria-live="polite" className="text-[12px] text-muted">{notice}</span>
      {error && <span role="alert" className="text-[12px]" style={{ color: '#e5484d' }}>{error}</span>}
      <ConfirmDialog
        open={confirming}
        title={`${verb} ${qualified}?`}
        message={message}
        confirmLabel={verb}
        onConfirm={() => { void doRestart() }}
        onCancel={() => { setConfirming(false) }}
      />
    </span>
  )
}
