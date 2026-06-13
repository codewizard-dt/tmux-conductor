import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { API_BASE, sendAgentKeys, uploadAgentImage, type KeysPayload } from '../lib/api'
import { useSSEEvent } from '../hooks/useSSE'

const LINE_OPTIONS = [10, 20, 50, 100]
const DEFAULT_LINES = 20

interface TailResponse {
  agent: string
  lines: number
  windowPresent: boolean
  text: string
}

function storageKey(agentName: string): string {
  return `conductor:logLines:${agentName}`
}

function readStoredLines(agentName: string): number {
  if (typeof window === 'undefined') return DEFAULT_LINES
  const raw = window.localStorage.getItem(storageKey(agentName))
  const parsed = raw === null ? NaN : parseInt(raw, 10)
  return LINE_OPTIONS.includes(parsed) ? parsed : DEFAULT_LINES
}

/** Browser KeyboardEvent → /agents/:agent/keys payload, or null to let the browser handle it. */
function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if (e.metaKey) return null // keep Cmd+R, Cmd+W, …
  if (e.ctrlKey) {
    return /^[a-zA-Z]$/.test(e.key) ? { keys: [`C-${e.key.toLowerCase()}`] } : null
  }
  switch (e.key) {
    case 'Enter': return { keys: ['Enter'] }
    case 'Escape': return { keys: ['Escape'] } // forwarded to the agent — exit interact via Stop/blur
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

const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()

export default function LogTail({ agentName, maxHeightClass, focused, interactSignal, onInteractChange }: {
  agentName: string
  maxHeightClass?: string | undefined
  /** When true, registers with the backend focus endpoint so the agent gets 200 ms SSE pushes instead of 2 s. */
  focused?: boolean | undefined
  /** Increment to (re)enable Direct Input mode from outside (banner button, needs-attention CTA). */
  interactSignal?: number | undefined
  /** Notifies the parent (e.g. a modal that closes on Escape) when Direct Input toggles. */
  onInteractChange?: ((interacting: boolean) => void) | undefined
}) {
  const [lines, setLines] = useState<number>(() => readStoredLines(agentName))
  const [tail, setTail] = useState<TailResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const [interacting, setInteracting] = useState(false)
  const [sendText, setSendText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  // Serializes POSTs so keystroke order survives key repeat; .catch keeps the chain alive.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const captureRef = useRef<HTMLDivElement>(null)

  // One-shot backfill on mount/lines change; live updates arrive via the SSE subscription below.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/agents/${encodeURIComponent(agentName)}/tail?lines=${String(lines)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<TailResponse>
      })
      .then((data) => { if (!cancelled) { setTail(data); setFailed(false) } })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [agentName, lines])

  useEffect(() => {
    if (!focused) return
    const pending = pendingDeletes.get(agentName)
    if (pending !== undefined) {
      // StrictMode remount: cancel the queued DELETE — backend is already focused
      clearTimeout(pending)
      pendingDeletes.delete(agentName)
    } else {
      fetch(`${API_BASE}/agents/${encodeURIComponent(agentName)}/focus`, { method: 'POST' }).catch(() => {})
    }
    return () => {
      pendingDeletes.set(agentName, setTimeout(() => {
        pendingDeletes.delete(agentName)
        fetch(`${API_BASE}/agents/${encodeURIComponent(agentName)}/focus`, { method: 'DELETE' }).catch(() => {})
      }, 0))
    }
  }, [agentName, focused])

  useSSEEvent<{ agent: string; text: string; lines: number }>(
    focused ? 'terminal-output-focus' : 'terminal-output',
    (payload) => {
      if (payload.agent !== agentName) return
      setTail({ agent: agentName, lines: payload.lines, windowPresent: true, text: payload.text })
    },
  )

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
      .then(() => sendAgentKeys(agentName, payload))
      .then(() => { setSendError(null) })
      .catch((err: unknown) => { setSendError(err instanceof Error ? err.message : 'Failed to send input') })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || e.key === 'Process') return // IME — use the send field instead
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
        .then(() => uploadAgentImage(agentName, file))
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
  }

  function handleLinesChange(value: string) {
    const next = parseInt(value, 10)
    if (!LINE_OPTIONS.includes(next)) return
    setLines(next)
    try { window.localStorage.setItem(storageKey(agentName), String(next)) } catch { /* storage unavailable — fine */ }
  }

  const windowPresent = tail?.windowPresent ?? false

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
          Log output
          {uploading && <span className="ml-2 normal-case tracking-normal text-accent-blue">uploading image…</span>}
        </p>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          lines
          <select
            value={lines}
            onChange={(e) => { handleLinesChange(e.target.value) }}
            className="cursor-pointer rounded-[5px] border border-line bg-white px-1 py-0.5 text-[11px] text-ink"
            aria-label="Number of log lines"
          >
            {LINE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
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
          className={dragOver
            ? 'rounded-[10px] outline-none ring-[3px] ring-accent-blue'
            : interacting
              ? 'rounded-[10px] outline-none ring-[3px] ring-[#e0901a]'
              : 'outline-none'}
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
            className={`scrollbar-none m-0 overflow-auto whitespace-pre ${interacting ? 'rounded-b-[10px]' : 'rounded-[10px]'} bg-[#0b0b0d] p-3 font-mono text-[11px] leading-[1.3] text-[#e7e8ea] ${maxHeightClass ?? ''} ${!interacting && onInteractChange !== undefined ? 'cursor-text' : ''}`}
            onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}
          >{tail.text || ' '}</pre>
        </div>
      )}
      {windowPresent && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleSendSubmit() }}
          className="mt-1.5 flex items-center gap-1.5"
        >
          <input
            value={sendText}
            onChange={(e) => { setSendText(e.target.value) }}
            placeholder={`Send one-off text commands to ${agentName}…`}
            className="h-7 min-w-0 flex-1 rounded-[7px] border border-line bg-white px-2 font-mono text-[11px] text-ink placeholder:text-muted-2"
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