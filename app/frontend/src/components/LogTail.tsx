import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { API_BASE, sendAgentKeys, uploadAgentImage, type KeysPayload } from '../lib/api'
import { useSSEEvent } from '../hooks/useSSE'

const DEFAULT_LINES = 100
const PAGE_SIZE = 100
const MAX_LINES = 1000

interface TailResponse {
  agent: string
  lines: number
  windowPresent: boolean
  text: string
}

/** Browser KeyboardEvent → /agents/:agent/keys payload, or null to let the browser handle it. */
function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
  if (e.ctrlKey) {
    return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
  }
  switch (e.key) {
    case 'Enter': return { keys: ['Enter'] }
    case 'Backspace': return { keys: ['BSpace'] }
    case 'Delete': return { keys: ['DC'] }
    case 'Tab': return { keys: [e.shiftKey ? 'BTab' : 'Tab'] }
    case 'ArrowUp': return { keys: ['Up'] }
    case 'ArrowDown': return { keys: ['Down'] }
    case 'ArrowLeft': return { keys: ['Left'] }
    case 'ArrowRight': return { keys: ['Right'] }
    case 'Home': return { keys: ['Home'] }
    case 'End': return { keys: ['End'] }
    case 'PageUp': return { keys: ['PPage'] }
    case 'PageDown': return { keys: ['NPage'] }
    default:
      return e.key.length === 1 ? { text: e.key } : null
  }
}

const pendingDeletes = new Map<number, ReturnType<typeof setTimeout>>()

export default function LogTail({ agentId, agentName, maxHeightClass, focused, fillContainer, interactSignal, onInteractChange, onCloseModal }: {
  /** Globally-unique agent id — used for all API calls and SSE filtering. */
  agentId: number
  /** Display name only (not unique across projects). */
  agentName: string
  maxHeightClass?: string | undefined
  /** When true, registers with the backend focus endpoint so the agent gets 200 ms SSE pushes instead of 2 s. */
  focused?: boolean | undefined
  /** When true, the component grows to fill its flex parent and the <pre> scrolls internally. */
  fillContainer?: boolean | undefined
  /** Increment to (re)enable Direct Input mode from outside (banner button, needs-attention CTA). */
  interactSignal?: number | undefined
  /** Notifies the parent (e.g. a modal that closes on Escape) when Direct Input toggles. */
  onInteractChange?: ((interacting: boolean) => void) | undefined
  /** Called when the user presses Esc twice in Direct Input mode to close the modal. */
  onCloseModal?: (() => void) | undefined
}) {
  const [lines, setLines] = useState<number>(DEFAULT_LINES)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [tail, setTail] = useState<TailResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [interacting, setInteracting] = useState(false)
  const [sendText, setSendText] = useState(() => {
    try { return localStorage.getItem(`conductor:sendDraft:${agentId.toString()}`) ?? '' } catch { return '' }
  })
  const [sendError, setSendError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [escHint, setEscHint] = useState(false)
  // Serializes POSTs so keystroke order survives key repeat; .catch keeps the chain alive.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const captureRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const autoScrollRef = useRef(true)
  const sendTextareaRef = useRef<HTMLTextAreaElement>(null)
  const escHintAtRef = useRef<number | null>(null)
  const escHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLoadingMoreRef = useRef(false)
  const prevScrollHeightRef = useRef(0)
  const prevScrollTopRef = useRef(0)
  const hasMoreRef = useRef(true)

  useEffect(() => {
    const el = sendTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 80 // ~4 lines of 11px mono + 8px vertical padding
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [sendText, tail?.windowPresent])

  function handleScroll() {
    if (!preRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = preRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 8
    if (scrollTop < 20 && hasMoreRef.current && !isLoadingMoreRef.current) {
      loadMore()
    }
  }

  function loadMore() {
    const nextLines = lines + PAGE_SIZE
    if (nextLines > MAX_LINES || isLoadingMoreRef.current) return
    isLoadingMoreRef.current = true
    setIsLoadingMore(true)
    prevScrollHeightRef.current = preRef.current?.scrollHeight ?? 0
    prevScrollTopRef.current = preRef.current?.scrollTop ?? 0
    setLines(nextLines)
  }

  // One-shot backfill on mount/lines change; live updates arrive via the SSE subscription below.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/agents/${agentId.toString()}/tail?lines=${String(lines)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<TailResponse>
      })
      .then((data) => {
        if (!cancelled) {
          const lineCount = data.text ? data.text.split('\n').length : 0
          hasMoreRef.current = lineCount >= lines && lines < MAX_LINES
          setTail(data)
          setFailed(false)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [agentId, lines])

  useEffect(() => {
    if (!focused) return
    const pending = pendingDeletes.get(agentId)
    if (pending !== undefined) {
      // StrictMode remount: cancel the queued DELETE — backend is already focused
      clearTimeout(pending)
      pendingDeletes.delete(agentId)
    } else {
      fetch(`${API_BASE}/agents/${agentId.toString()}/focus`, { method: 'POST' }).catch(() => { })
    }
    return () => {
      pendingDeletes.set(agentId, setTimeout(() => {
        pendingDeletes.delete(agentId)
        fetch(`${API_BASE}/agents/${agentId.toString()}/focus`, { method: 'DELETE' }).catch(() => { })
      }, 0))
    }
  }, [agentId, focused])

  useSSEEvent<{ agentId: number; agent: string; text: string; lines: number }>(
    focused ? 'terminal-output-focus' : 'terminal-output',
    (payload) => {
      if (payload.agentId !== agentId) return
      if (lines > payload.lines) {
        // Re-fetch at the expanded line count so SSE doesn't collapse the history view
        fetch(`${API_BASE}/agents/${agentId.toString()}/tail?lines=${String(lines)}`)
          .then((r) => r.json() as Promise<TailResponse>)
          .then((data) => { setTail(data); setFailed(false) })
          .catch(() => { /* non-fatal; next poll will retry */ })
      } else {
        setTail({ agent: agentName, lines: payload.lines, windowPresent: true, text: payload.text })
      }
    },
  )

  useEffect(() => {
    if (focused) {
      autoScrollRef.current = true
      if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [focused])

  useEffect(() => {
    if (tail === null || !preRef.current) return
    if (isLoadingMoreRef.current) {
      const delta = preRef.current.scrollHeight - prevScrollHeightRef.current
      preRef.current.scrollTop = prevScrollTopRef.current + delta
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    } else if (autoScrollRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [tail])

  useEffect(() => {
    if (interactSignal !== undefined && interactSignal > 0) {
      setTimeout(() => {
        setInteracting(true)
        captureRef.current?.focus() // refocus even when already interacting
      }, 0)
    }
  }, [interactSignal])

  useEffect(() => {
    onInteractChange?.(interacting)
    if (interacting) captureRef.current?.focus()
  }, [interacting, onInteractChange])

  function enqueue(payload: KeysPayload) {
    queueRef.current = queueRef.current
      .then(() => sendAgentKeys(agentId, payload))
      .then(() => { setSendError(null) })
      .catch((err: unknown) => { setSendError(err instanceof Error ? err.message : 'Failed to send input') })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || e.key === 'Process') return // IME — use the send field instead

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // Cmd/Ctrl + Esc → forward Esc to the agent
      if (e.metaKey || e.ctrlKey) {
        enqueue({ keys: ['Escape'] })
        return
      }
      // Double-esc within 800 ms → close the modal
      const now = Date.now()
      if (escHintAtRef.current !== null && now - escHintAtRef.current < 800) {
        escHintAtRef.current = null
        if (escHintTimerRef.current !== null) { clearTimeout(escHintTimerRef.current); escHintTimerRef.current = null }
        setEscHint(false)
        onCloseModal?.()
        return
      }
      // First Esc: show hint toast
      escHintAtRef.current = now
      setEscHint(true)
      if (escHintTimerRef.current !== null) clearTimeout(escHintTimerRef.current)
      escHintTimerRef.current = setTimeout(() => {
        setEscHint(false)
        escHintAtRef.current = null
        escHintTimerRef.current = null
      }, 3000)
      return
    }

    const payload = mapKey(e)
    if (!payload) return
    e.preventDefault()
    e.stopPropagation()
    enqueue(payload)
  }

  /** Uploads any image files through the keystroke queue (path lands in the pane in order). Returns false when none were images. */
  function enqueueImageUploads(files: FileList): boolean {
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return false
    setUploading(true)
    for (const file of images) {
      queueRef.current = queueRef.current
        .then(() => uploadAgentImage(agentId, file))
        .then(() => { setSendError(null) })
        .catch((err: unknown) => { setSendError(err instanceof Error ? err.message : 'Failed to upload image') })
    }
    queueRef.current = queueRef.current.then(() => { setUploading(false) })
    return true
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.clipboardData.files.length > 0 && enqueueImageUploads(e.clipboardData.files)) return
    const firstLine = e.clipboardData.getData('text').replace(/\r/g, '').split('\n')[0] ?? ''
    if (firstLine !== '') enqueue({ text: firstLine })
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(true)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (!enqueueImageUploads(e.dataTransfer.files)) {
      setSendError('Only image files can be dropped onto the terminal')
    }
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    // Click-outside / focus-loss ends interact mode; focus moving within the
    // container (e.g. onto the stop button) doesn't.
    if (!(e.relatedTarget instanceof Node) || !captureRef.current?.contains(e.relatedTarget)) {
      setInteracting(false)
    }
  }

  function handleSendSubmit() {
    const text = sendText.trim()
    if (text === '') return
    enqueue({ text, enter: true })
    setSendText('')
    try { localStorage.removeItem(`conductor:sendDraft:${agentId.toString()}`) } catch { /**/ }
  }

  const windowPresent = tail?.windowPresent ?? false

  return (
    <div className={fillContainer ? 'flex flex-col flex-1 min-h-0' : undefined}>
      <div className={`mb-1.5 flex items-center gap-2${fillContainer ? ' flex-shrink-0' : ''}`}>
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
          Log output
          {uploading && <span className="ml-2 normal-case tracking-normal text-accent-blue">uploading image…</span>}
          {isLoadingMore && <span className="ml-2 normal-case tracking-normal text-muted-2">loading older output…</span>}
        </p>
      </div>
      {tail === null ? (
        <p className="text-[12px] italic text-muted-2">{failed ? 'Could not load log output.' : 'Loading…'}</p>
      ) : !tail.windowPresent ? (
        <p className="text-[12px] italic text-muted-2">Window not present.</p>
      ) : (
        <div
          ref={captureRef}
          tabIndex={interacting ? 0 : -1}
          onKeyDown={interacting ? handleKeyDown : undefined}
          onPaste={interacting ? handlePaste : undefined}
          onBlur={interacting ? handleBlur : undefined}
          onDragOver={handleDragOver}
          onDragLeave={() => { setDragOver(false) }}
          onDrop={handleDrop}
          className={`relative ${fillContainer ? 'flex flex-col flex-1 min-h-0 ' : ''}${dragOver
            ? 'rounded-[10px] outline-none ring-[3px] ring-accent-blue'
            : interacting
              ? 'rounded-[10px] outline-none ring-[3px] ring-[#e0901a]'
              : 'outline-none'}`}
        >
          {interacting && (
            <div className="flex items-center gap-2 rounded-t-[10px] bg-[#e0901a] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Direct Input — keys go to {agentName}
              <button
                type="button"
                onClick={() => { setInteracting(false) }}
                className="ml-auto cursor-pointer font-bold underline"
              >stop</button>
            </div>
          )}
          <pre
            ref={preRef}
            onScroll={handleScroll}
            className={`${fillContainer ? 'scrollbar-dark' : 'scrollbar-none'} m-0 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] selection:bg-accent-blue selection:text-white ${interacting ? 'rounded-b-[10px]' : 'rounded-[10px]'} bg-[#0b0b0d] p-3 font-mono text-[11px] leading-[1.3] text-[#e7e8ea] ${fillContainer ? 'flex-1 min-h-0' : (maxHeightClass ?? '')} ${!interacting && onInteractChange !== undefined ? 'cursor-text' : ''}`}
            onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}
          >{tail.text || ' '}</pre>
          {interacting && escHint && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-x-4 bottom-4 z-10 rounded-[10px] bg-[#e0901a] px-5 py-4 text-center shadow-lg"
            >
              <p className="m-0 text-[15px] font-bold text-white">Press esc again to close the modal</p>
              <p className="m-0 mt-1.5 text-[13px] font-medium text-white/80">Press ⌘/ctrl + esc to send esc to the agent</p>
            </div>
          )}
        </div>
      )}
      {windowPresent && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleSendSubmit() }}
          className="mt-1.5 flex items-end gap-1.5"
        >
          <textarea
            ref={sendTextareaRef}
            value={sendText}
            rows={1}
            onChange={(e) => {
              const v = e.target.value
              setSendText(v)
              try { localStorage.setItem(`conductor:sendDraft:${agentId.toString()}`, v) } catch { /**/ }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendSubmit()
              }
            }}
            placeholder={`Send one-off text commands to ${agentName}…`}
            className="min-h-7 min-w-0 flex-1 resize-none overflow-hidden rounded-[7px] border border-line bg-white px-2 py-1 font-mono text-[11px] text-ink placeholder:text-muted-2"
            aria-label={`Send one-off text commands to ${agentName}`}
          />
          <button
            type="submit"
            disabled={sendText.trim() === ''}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >Send</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault() }} // keep focus on the capture div so blur doesn't pre-toggle
            onClick={() => { setInteracting((prev) => !prev) }}
            className={interacting
              ? 'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] bg-[#e0901a] px-3 text-[12px] font-semibold text-white transition hover:opacity-85 active:scale-[0.985]'
              : 'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[#e0901a]/40 bg-white px-3 text-[12px] font-semibold text-[#c07a10] transition hover:bg-[#e0901a]/10 active:scale-[0.985]'}
            aria-pressed={interacting}
          >
            <span aria-hidden="true">⌨</span>
            {interacting ? 'Stop Direct Input' : 'Direct Input'}
          </button>
        </form>
      )}
      {sendError && <p className="mt-1 text-[11px] text-accent-red">{sendError}</p>}
    </div>
  )
}