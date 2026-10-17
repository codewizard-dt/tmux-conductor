import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bgTail } from '../lib/api'
import type { BgRestartResult, BgTail } from '../lib/api'
import type { BgProcess } from './AgentList'
import { BgLastRestart } from './BgLastRestart'
import { BgLivenessBadge } from './BgLivenessBadge'
import { BgRestartButton } from './BgRestartButton'

const POLL_INTERVAL_MS = 2000
const TAIL_LINES = 200
/** Distance from the bottom (px) within which the output keeps following new lines. */
const STICK_THRESHOLD_PX = 24
const RESTART_MARKER = /^--- restart .* ---$/

// ── Polling hook ───────────────────────────────────────────────────────────

interface TailState {
  slug: string
  tail: BgTail | null
  error: string | null
}

function sameTail(a: BgTail, b: BgTail): boolean {
  if (a.updatedAt !== b.updatedAt || a.sizeBytes !== b.sizeBytes) return false
  if (a.truncated !== b.truncated || a.lines.length !== b.lines.length) return false
  for (let i = 0; i < a.lines.length; i++) {
    if (a.lines[i] !== b.lines[i]) return false
  }
  return true
}

/**
 * Poll `GET /bg-processes/:slug/tail` while `enabled` and a slug is selected.
 * Fetches immediately, then every 2s, only while the document is visible; skips a
 * tick while a request is in flight; ignores late results after the effect is torn
 * down (slug change, disabled, unmount). State only changes when the tail did.
 */
export function useBgTail(
  slug: string | null,
  enabled: boolean,
): { tail: BgTail | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<TailState | null>(null)
  const fetchNowRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!enabled || !slug) return undefined

    let cancelled = false
    let inFlight = false

    const fetchOnce = (): void => {
      if (cancelled || inFlight || document.hidden) return
      inFlight = true
      bgTail(slug, TAIL_LINES)
        .then((next) => {
          if (cancelled) return
          setState((prev) => {
            const prevTail = prev?.slug === slug ? prev.tail : null
            if (prev?.slug === slug && prev.error === null && prevTail && sameTail(prevTail, next)) {
              return prev
            }
            return { slug, tail: next, error: null }
          })
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : 'Request failed'
          setState((prev) => {
            const prevTail = prev?.slug === slug ? prev.tail : null
            if (prev?.slug === slug && prev.error === message) return prev
            return { slug, tail: prevTail, error: message }
          })
        })
        .finally(() => {
          inFlight = false
        })
    }

    fetchNowRef.current = fetchOnce
    fetchOnce()
    const timer = setInterval(fetchOnce, POLL_INTERVAL_MS)
    const onVisibility = (): void => {
      if (!document.hidden) fetchOnce()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      fetchNowRef.current = null
    }
  }, [slug, enabled])

  const retry = useCallback(() => {
    fetchNowRef.current?.()
  }, [])

  // Never show another process's output for the current selection.
  const current = state && slug !== null && state.slug === slug ? state : null
  return { tail: current?.tail ?? null, error: current?.error ?? null, retry }
}

// ── Small helpers ──────────────────────────────────────────────────────────

function formatRelative(iso: string, nowMs: number): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'
  const secs = Math.max(0, Math.round((nowMs - then) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${String(secs)}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${String(mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${String(hours)}h ago`
  return `${String(Math.floor(hours / 24))}d ago`
}

/** Self-ticking "updated <relative>" label, isolated so only it re-renders. */
function UpdatedAt({ updatedAt }: { updatedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 5000)
    return () => {
      clearInterval(timer)
    }
  }, [])
  if (!updatedAt) return <span>no output yet</span>
  return <span title={updatedAt}>updated {formatRelative(updatedAt, now)}</span>
}

function pickDefaultSlug(bgs: BgProcess[]): string | null {
  const exited = bgs.find((b) => b.liveness === 'exited')
  return (exited ?? bgs[0])?.slug ?? null
}

// ── Output panel ───────────────────────────────────────────────────────────

function OutputPanel({ slug, tail, error, retry }: {
  slug: string
  tail: BgTail | null
  error: string | null
  retry: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  // A newly selected process starts pinned to the bottom again.
  useEffect(() => {
    stickRef.current = true
  }, [slug])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [tail, slug])

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-2">
        <span>
          {tail?.truncated ? `Output truncated to last ${String(tail.lines.length)} lines` : ''}
        </span>
        <UpdatedAt updatedAt={tail?.updatedAt ?? null} />
      </div>
      {error && (
        <div role="status" className="flex items-center gap-2 text-[12px] text-muted">
          <span>Could not load output</span>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="region"
        aria-label={`Output of ${slug}`}
        tabIndex={0}
        className="max-h-[50vh] min-h-[6rem] overflow-y-auto rounded border border-line bg-canvas p-2"
      >
        {tail === null ? (
          error === null && <p className="text-[12px] text-muted-2">Loading output…</p>
        ) : tail.lines.length === 0 ? (
          <p className="text-[12px] text-muted-2">No output yet</p>
        ) : (
          <pre className="font-mono text-[11px] leading-snug text-ink whitespace-pre-wrap break-all">
            {tail.lines.map((line, i) =>
              RESTART_MARKER.test(line) ? (
                <span
                  key={i}
                  data-restart-marker="true"
                  className="my-1 block border-y border-line py-0.5 text-center text-muted-2"
                >
                  {line}
                </span>
              ) : (
                <span key={i} className="block">
                  {line === '' ? ' ' : line}
                </span>
              ),
            )}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Tab ────────────────────────────────────────────────────────────────────

interface BackgroundProcessesTabProps {
  /** The agent's project's bg processes (already filtered by the caller). */
  bgs: BgProcess[]
  projectName: string
  /** Whether this tab is the active one; polling only runs while true. */
  active: boolean
  /** Called with the slug and server result after a successful Restart/Start from a row (TASK-0206). */
  onBgRestarted?: ((slug: string, result: BgRestartResult) => void) | undefined
}

export function BackgroundProcessesTab({ bgs, projectName, active, onBgRestarted }: BackgroundProcessesTabProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => pickDefaultSlug(bgs))

  // Keep the selection by slug; reset to the default only if it disappears.
  const selected = bgs.find((b) => b.slug === selectedSlug) ?? null
  if (!selected) {
    const fallback = pickDefaultSlug(bgs)
    if (fallback !== selectedSlug) setSelectedSlug(fallback)
  }

  const { tail, error, retry } = useBgTail(selected?.slug ?? null, active && selected !== null)

  if (bgs.length === 0) {
    return (
      <section aria-label="Background processes" className="p-4 text-[13px] text-muted">
        {`No background processes in ${projectName}. Add one from the navbar.`}
      </section>
    )
  }

  return (
    <section aria-label="Background processes" className="flex flex-col gap-3 p-3">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {bgs.map((bg) => {
          const isSelected = bg.slug === selected?.slug
          return (
            <li key={bg.slug} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedSlug(bg.slug)
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue ${
                    isSelected ? 'border-line bg-canvas' : 'border-transparent hover:bg-canvas'
                  }`}
                >
                  <span className="flex-shrink-0 font-mono text-[12px] text-ink">{bg.slug}</span>
                  <span className="flex-shrink-0">
                    <BgLivenessBadge liveness={bg.liveness} windowPresent={bg.windowPresent} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-2" title={bg.launchCmd}>
                    {bg.launchCmd}
                  </span>
                </button>
                {/* A sibling of the select button, not a child: buttons cannot nest. */}
                <BgRestartButton
                  slug={bg.slug}
                  label={bg.name}
                  windowPresent={bg.windowPresent}
                  projectName={bg.projectName}
                  onRestarted={(result) => {
                    // The restart marker is already in the log: refresh the visible tail now.
                    if (bg.slug === selected?.slug) retry()
                    onBgRestarted?.(bg.slug, result)
                  }}
                />
              </div>
              {/* Outside the select button so it stays out of the button's accessible name. */}
              <BgLastRestart lastRestart={bg.lastRestart} className="truncate px-2" />
            </li>
          )
        })}
      </ul>
      {selected && <OutputPanel slug={selected.slug} tail={tail} error={error} retry={retry} />}
    </section>
  )
}
