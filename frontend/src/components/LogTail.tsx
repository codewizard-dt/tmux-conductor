import { Fragment, useEffect, useRef, useState, type DragEvent, type FocusEvent, type KeyboardEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { API_BASE, sendAgentKeys, uploadAgentImage, type KeysPayload } from '../lib/api'
import { fitWithRightEdgeMargin, TERMINAL_FONT_OPTIONS } from '../lib/terminalTheme'
import { maybeProbeOnFirstRender, registerResizeListener } from '../lib/terminalSizeProbe'
import { connectTerminalWebSocket, type TerminalWebSocketClient } from '../lib/terminalWebSocket'
import { useSSEEvent } from '../hooks/useSSE'

const TAIL_LINES = 500

// Resting the viewport at the literal bottom (viewportY === baseY) is what triggers xterm.js's
// scrollbar-flicker-on-every-repaint issue (known upstream — see wiki/knowledge/sources/
// xterm-scrollbar-flicker.md): each full-reset repaint churns .xterm-viewport's scrollTop, and
// the browser's native "scrollbar visible while at the max-scroll edge" indicator flashes on
// every occurrence. Keeping a small offset short of the true bottom avoids ever landing exactly
// on that boundary. `atBottom` (the follow-mode check) must treat "within this many lines of the
// bottom" as still-following, or the offset itself would immediately kick follow-mode off.
const BOTTOM_OFFSET_LINES = 2

// Live updates (WebSocket/SSE) can arrive far faster than a human reads, and each one drives a
// full-reset repaint (see applySnapshot) that churns the scrollbar thumb's size/position even
// though BOTTOM_OFFSET_LINES already stops the content from visibly jumping (see
// wiki/knowledge/sources/xterm-scrollbar-flicker.md, "Recommended fix"). Coalescing bursts of
// live updates into one repaint at this bounded rate cuts how often that churn happens.
const LIVE_REPAINT_DEBOUNCE_MS = 200

interface TailResponse {
  agent: string
  lines: number
  windowPresent: boolean
  text: string
}

interface HistoryLogEntry {
  id: number
  agentId: number
  ts: string
  chunk: string
}

interface HistoryLogResponse {
  agent: string
  log: HistoryLogEntry[]
}

/** Browser KeyboardEvent → /agents/:agent/keys payload, or null to let the browser handle it. */
export function mapKey(e: KeyboardEvent<HTMLDivElement>): KeysPayload | null {
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.ctrlKey || e.metaKey || e.altKey)) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      return { keys: [e.key === 'ArrowLeft' ? 'C-Left' : 'C-Right'] }
    }
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      return { keys: [e.key === 'ArrowLeft' ? 'Home' : 'End'] }
    }
    if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      return { keys: [e.key === 'ArrowLeft' ? 'M-Left' : 'M-Right'] }
    }
  }
  if (e.key === 'Backspace' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return { keys: ['C-u'] }
  if (e.key === 'Backspace' && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) return { keys: ['C-w'] }
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

export function formatChunkTs(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const pendingDeletes = new Map<number, ReturnType<typeof setTimeout>>()

type FocusedLatencyTransport = 'websocket' | 'sse'

interface FocusedLatencySample {
  transport: FocusedLatencyTransport
  agentId: number
  receivedAt: number
  paintedAt: number
  receiptToPaintMs: number
  bytes: number
  lines: number | null
  windowPresent: boolean | null
}

interface FocusedInputAckSample {
  agentId: number
  inputId: number
  sentAt: number
  acknowledgedAt: number
  ackLatencyMs: number
}

interface FocusedLatencyProbe {
  enabled?: boolean
  samples?: FocusedLatencySample[]
  inputAcks?: FocusedInputAckSample[]
}

function recordFocusedLatencySample(
  transport: FocusedLatencyTransport,
  agentId: number,
  text: string,
  lines: number | null,
  windowPresent: boolean | null,
  receivedAt: number,
): void {
  const probe = (window as Window & { __focusedTerminalLatencyBaseline?: FocusedLatencyProbe }).__focusedTerminalLatencyBaseline
  if (probe?.enabled !== true || !Array.isArray(probe.samples)) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const paintedAt = performance.now()
      probe.samples?.push({
        transport,
        agentId,
        receivedAt,
        paintedAt,
        receiptToPaintMs: Math.round((paintedAt - receivedAt) * 1000) / 1000,
        bytes: text.length,
        lines,
        windowPresent,
      })
    })
  })
}

function recordFocusedInputAck(agentId: number, inputId: number | undefined, sentAt: number | undefined): void {
  const probe = (window as Window & { __focusedTerminalLatencyBaseline?: FocusedLatencyProbe }).__focusedTerminalLatencyBaseline
  if (probe?.enabled !== true || !Array.isArray(probe.inputAcks)) return
  if (inputId === undefined || sentAt === undefined) return
  const acknowledgedAt = performance.now()
  probe.inputAcks.push({
    agentId,
    inputId,
    sentAt,
    acknowledgedAt,
    ackLatencyMs: Math.round((acknowledgedAt - sentAt) * 1000) / 1000,
  })
}

export default function LogTail({ agentId, agentName, maxHeightClass, focused, fillContainer, interactSignal, onInteractChange, onCloseModal }: {
  /** Globally-unique agent id — used for all API calls and SSE filtering. */
  agentId: number
  /** Display name only (not unique across projects). */
  agentName: string
  maxHeightClass?: string | undefined
  /** When true, registers with the backend focus endpoint so the agent gets 200 ms SSE pushes instead of 2 s. */
  focused?: boolean | undefined
  /** When true, the component grows to fill its flex parent and the terminal scrolls internally. */
  fillContainer?: boolean | undefined
  /** Increment to (re)enable Direct Input mode from outside (banner button, needs-attention CTA). */
  interactSignal?: number | undefined
  /** Notifies the parent (e.g. a modal that closes on Escape) when Direct Input toggles. */
  onInteractChange?: ((interacting: boolean) => void) | undefined
  /** Called when the user presses Esc twice in Direct Input mode to close the modal. */
  onCloseModal?: (() => void) | undefined
}) {
  const [loaded, setLoaded] = useState(false)
  const [windowPresent, setWindowPresent] = useState(false)
  const [failed, setFailed] = useState(false)
  const [interacting, setInteracting] = useState(false)
  const [sendText, setSendText] = useState(() => {
    try { return localStorage.getItem(`conductor:sendDraft:${agentId.toString()}`) ?? '' } catch { return '' }
  })
  const [sendError, setSendError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [terminalWsConnected, setTerminalWsConnected] = useState(false)
  const [escHint, setEscHint] = useState(false)
  const [viewMode, setViewMode] = useState<'live' | 'history'>('live')
  const [historyLog, setHistoryLog] = useState<HistoryLogEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)
  // Serializes POSTs so keystroke order survives key repeat; .catch keeps the chain alive.
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const captureRef = useRef<HTMLDivElement>(null)
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  // One-shot guard for the default-Direct-Input-on effect below: ensures it arms at most
  // once per mount, even if loaded/windowPresent were to toggle again later (e.g. reconnect).
  const defaultInteractArmedRef = useRef(false)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initialTextRef = useRef('')
  // Follow-mode: while the user is at the bottom we repaint live; once they scroll up we stop
  // repainting so their scrollback view holds still, then re-apply the latest snapshot when they
  // return to the bottom. This is what makes scrollback usable despite full-screen repaints.
  const followRef = useRef(true)
  const pendingTextRef = useRef<string | null>(null)
  const lastWrittenRef = useRef('')
  const writingRef = useRef(false)
  const sendTextareaRef = useRef<HTMLTextAreaElement>(null)
  const escHintAtRef = useRef<number | null>(null)
  const escHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Trailing-edge debounce for the live-update repaint: while this is running, further live
  // updates just overwrite pendingTextRef (see below) instead of resetting the countdown, so a
  // sustained burst still repaints at least once every LIVE_REPAINT_DEBOUNCE_MS rather than
  // stalling indefinitely.
  const liveRepaintDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const terminalWsRef = useRef<TerminalWebSocketClient | null>(null)
  const [terminalDebug, setTerminalDebug] = useState({
    wsStatus: 'idle',
    lastAckMs: null as number | null,
    lastEchoMs: null as number | null,
    lastOutputAt: null as string | null,
    lastOutputChars: 0,
  })

  // Repaint the terminal from a full pane snapshot in a SINGLE write: the leading ESC c (RIS)
  // resets/clears and the content redraws in the same render frame, so there's no blank
  // intermediate frame — that two-frame reset()+write() gap was the periodic flicker. Records the
  // text written so follow-mode can re-apply a snapshot that arrived while scrolled up.
  // Focuses captureRef and verifies the focus actually landed, retrying across a few animation
  // frames instead of a single unverified setTimeout(0) — captureRef.current can still be null
  // on the very first frame this fires (e.g. arriving before the loaded/windowPresent-gated
  // terminal-creation effect has rendered it), and a lost race previously failed silently.
  function focusCaptureWithRetry(attemptsLeft = 5) {
    const el = captureRef.current
    if (el) el.focus()
    if (document.activeElement !== el && attemptsLeft > 0) {
      requestAnimationFrame(() => { focusCaptureWithRetry(attemptsLeft - 1) })
    }
  }

  // Scrolls to just short of the true bottom (see BOTTOM_OFFSET_LINES) instead of the exact
  // last line, so the viewport never rests at the scrollTop boundary that triggers the
  // repaint-flicker issue. scrollLines(-N) is a no-op-clamped-to-0 when there's less than N
  // lines of scrollback yet, so this is safe on a freshly-opened terminal too.
  function scrollNearBottom(term: Terminal) {
    term.scrollToBottom()
    term.scrollLines(-BOTTOM_OFFSET_LINES)
  }

  function applySnapshot(text: string) {
    const term = termRef.current
    if (!term) return
    writingRef.current = true
    term.write('\x1bc' + text, () => {
      scrollNearBottom(term)
      lastWrittenRef.current = text
      writingRef.current = false
    })
  }

  // Debounced entry point for the live-update repaint (WebSocket/SSE handlers below), scoped to
  // follow-mode only. pendingTextRef already tracks the latest live text (set by both callers
  // right before this runs, and consumed by the onScroll catch-up path too), so coalescing to
  // "latest wins" needs no extra ref: a call while the timer is already pending is a no-op here
  // — it just leaves pendingTextRef holding the newer text for the pending timer to pick up.
  // The "catch up on return to bottom" applySnapshot call (onScroll) and the first snapshot on
  // mount are NOT routed through this — those are one-shot/user-initiated repaints that should
  // stay instant, not the sustained update stream this exists to coalesce.
  function scheduleLiveRepaint() {
    if (liveRepaintDebounceRef.current !== null) return
    liveRepaintDebounceRef.current = setTimeout(() => {
      liveRepaintDebounceRef.current = null
      if (pendingTextRef.current !== null) applySnapshot(pendingTextRef.current)
    }, LIVE_REPAINT_DEBOUNCE_MS)
  }

  useEffect(() => {
    const el = sendTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxH = 80
    el.style.height = `${String(Math.min(el.scrollHeight, maxH))}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [sendText, windowPresent])

  // Fetch initial tail to determine windowPresent and capture the first text snapshot.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoaded(false)
      setWindowPresent(false)
    })
    fetch(`${API_BASE}/agents/${agentId.toString()}/tail?lines=${String(TAIL_LINES)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<TailResponse>
      })
      .then((data) => {
        if (!cancelled) {
          initialTextRef.current = data.text
          setWindowPresent(data.windowPresent)
          setLoaded(true)
          setFailed(false)
        }
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [agentId])

  // Fetch the persisted history log when History mode is selected.
  useEffect(() => {
    if (viewMode !== 'history') return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setHistoryLoading(true)
    })
    fetch(`${API_BASE}/agents/${agentId.toString()}/log`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status.toString()}`)
        return r.json() as Promise<HistoryLogResponse>
      })
      .then((data) => {
        if (!cancelled) setHistoryLog(data.log)
      })
      .catch(() => { if (!cancelled) setHistoryError(true) })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [viewMode, agentId])

  // Create the xterm.js terminal once the tail has loaded, the tmux window is
  // present, and the container div is in the DOM.
  useEffect(() => {
    if (!loaded || !windowPresent || !xtermContainerRef.current) return
    const term = new Terminal({
      theme: { background: '#0b0b0d', foreground: '#e7e8ea', cursor: '#e7e8ea', cursorAccent: '#0b0b0d' },
      ...TERMINAL_FONT_OPTIONS,
      scrollback: 1000,
      convertEol: true,
      disableStdin: true,
      // Read-only mirror: the xterm textarea never holds focus (keys are captured by the
      // wrapper div), so force a steady block cursor that stays visible while blurred — this
      // is what makes the browser cursor track the tmux pane's cursor.
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'block',
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(xtermContainerRef.current)
    fitWithRightEdgeMargin(term, fitAddon)
    termRef.current = term
    fitAddonRef.current = fitAddon
    // Global pane-size sync (unrelated to the local xterm fit below): probes the widest
    // realistic panel width once per browser session and re-probes on window resize, so
    // the shared tmux window size matches the browser instead of the tmux factory default.
    maybeProbeOnFirstRender()
    registerResizeListener()
    // The DOM renderer only paints the (inactive) cursor after the terminal has been focused
    // once, but this read-only mirror never holds focus. Focus+blur once, restoring the prior
    // focus, so the block cursor mirrors the pane's cursor position from the first frame.
    {
      const prevActive = document.activeElement as HTMLElement | null
      term.focus()
      term.blur()
      if (prevActive && prevActive !== document.body) prevActive.focus()
    }
    term.onScroll(() => {
      if (writingRef.current) return // ignore scroll events caused by our own repaint
      const atBottom = term.buffer.active.baseY - term.buffer.active.viewportY <= BOTTOM_OFFSET_LINES
      followRef.current = atBottom
      // Returned to the bottom: catch up on whatever snapshot arrived while scrolled up.
      if (atBottom && pendingTextRef.current !== null && pendingTextRef.current !== lastWrittenRef.current) {
        applySnapshot(pendingTextRef.current)
      }
    })
    const firstSnapshot = pendingTextRef.current ?? initialTextRef.current
    if (firstSnapshot) {
      applySnapshot(firstSnapshot)
      initialTextRef.current = ''
      pendingTextRef.current = firstSnapshot
    }
    const ro = new ResizeObserver(() => { if (termRef.current && fitAddonRef.current) fitWithRightEdgeMargin(termRef.current, fitAddonRef.current) })
    ro.observe(xtermContainerRef.current)
    return () => {
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      if (liveRepaintDebounceRef.current !== null) {
        clearTimeout(liveRepaintDebounceRef.current)
        liveRepaintDebounceRef.current = null
      }
    }
  }, [loaded, windowPresent, agentId])

  useEffect(() => {
    if (!focused) return
    const pending = pendingDeletes.get(agentId)
    if (pending !== undefined) {
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

  useEffect(() => {
    if (!focused) {
      terminalWsRef.current?.close()
      terminalWsRef.current = null
      queueMicrotask(() => {
        setTerminalWsConnected(false)
        setTerminalDebug((prev) => ({ ...prev, wsStatus: 'idle' }))
      })
      return
    }
    let cancelled = false
    let client: TerminalWebSocketClient | null = null
    queueMicrotask(() => {
      setTerminalWsConnected(false)
      setTerminalDebug((prev) => ({ ...prev, wsStatus: 'connecting' }))
    })
    const openTimer = setTimeout(() => {
      if (cancelled) return
      client = connectTerminalWebSocket(
        agentId,
        (message) => {
          const receivedAt = performance.now()
          if (message.type === 'ack') {
            recordFocusedInputAck(agentId, message.inputId, message.sentAt)
            setTerminalDebug((prev) => ({ ...prev, wsStatus: 'open', lastAckMs: message.latencyMs ?? prev.lastAckMs }))
            return
          }
          if (message.type === 'echo') {
            setTerminalDebug((prev) => ({ ...prev, wsStatus: 'open', lastEchoMs: message.latencyMs ?? prev.lastEchoMs }))
            return
          }
          if (message.type === 'error') {
            setTerminalDebug((prev) => ({ ...prev, wsStatus: 'error' }))
            return
          }
          if (message.agentId !== agentId || typeof message.text !== 'string') return
          const outputText = message.text
          setTerminalDebug((prev) => ({
            ...prev,
            wsStatus: 'open',
            lastOutputAt: new Date().toLocaleTimeString(),
            lastOutputChars: outputText.length,
          }))
          pendingTextRef.current = outputText
          setWindowPresent(message.windowPresent ?? true)
          if (followRef.current) {
            scheduleLiveRepaint()
            recordFocusedLatencySample('websocket', agentId, outputText, message.lines ?? null, message.windowPresent ?? null, receivedAt)
          }
        },
        () => {
          if (terminalWsRef.current === client) {
            terminalWsRef.current = null
            setTerminalWsConnected(false)
          }
          setTerminalDebug((prev) => ({ ...prev, wsStatus: 'closed' }))
        },
        () => {
          setTerminalWsConnected(true)
          setTerminalDebug((prev) => ({ ...prev, wsStatus: 'open' }))
        },
      )
      terminalWsRef.current = client
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(openTimer)
      if (client !== null && terminalWsRef.current === client) {
        terminalWsRef.current = null
        setTerminalWsConnected(false)
      }
      client?.close()
    }
  }, [agentId, focused])

  useSSEEvent<{ agentId: number; agent: string; text: string; lines: number }>(
    focused ? 'terminal-output-focus' : 'terminal-output',
    (payload) => {
      const receivedAt = performance.now()
      if (payload.agentId !== agentId) return
      pendingTextRef.current = payload.text
      // Only repaint while following the live tail; if the user scrolled up to read history,
      // leave the buffer untouched (the snapshot is applied when they scroll back to the bottom).
      if (followRef.current) {
        scheduleLiveRepaint()
        if (focused) recordFocusedLatencySample('sse', agentId, payload.text, payload.lines, null, receivedAt)
      }
    },
    !focused || !terminalWsConnected,
  )

  useEffect(() => {
    if (focused && termRef.current) {
      followRef.current = true
      scrollNearBottom(termRef.current)
    }
  }, [focused])

   
  useEffect(() => {
    if (interactSignal === undefined || interactSignal <= 0) return
    // Defer setState to avoid cascading renders (interactive mode is triggered by external signal)
    queueMicrotask(() => {
      setInteracting(true)
      focusCaptureWithRetry()
    })
  }, [interactSignal])

  // Default Direct Input to on once the terminal is actually ready to receive it: LogTail's
  // sole consumer is AgentDetailView, so arming interact mode makes the detail pane terminal-first
  // without an extra gating prop. Gated the same way the terminal-creation effect above gates
  // itself (loaded && windowPresent), so captureRef is guaranteed to be mounted, and guarded by
  // a one-shot ref so it never re-arms after the first successful arm.
  useEffect(() => {
    if (!loaded || !windowPresent || defaultInteractArmedRef.current) return
    defaultInteractArmedRef.current = true
    setInteracting(true)
    focusCaptureWithRetry()
  }, [loaded, windowPresent])

  useEffect(() => {
    onInteractChange?.(interacting)
    if (interacting) focusCaptureWithRetry()
  }, [interacting, onInteractChange])

  // Capture-phase (not bubble-phase JSX onPaste): xterm.js's own paste listener on this
  // element runs in the bubble phase and calls stopPropagation(), which would otherwise
  // swallow the event before a bubble-phase handler ever sees it.
  useEffect(() => {
    if (!interacting) return
    const el = captureRef.current
    if (!el) return
    el.addEventListener('paste', handlePaste, { capture: true })
    return () => { el.removeEventListener('paste', handlePaste, { capture: true }) }
  }, [interacting, handlePaste])

  function enqueue(payload: KeysPayload) {
    if (focused && terminalWsRef.current?.sendInput(payload)) {
      setSendError(null)
      return
    }
    queueRef.current = queueRef.current
      .then(() => sendAgentKeys(agentId, payload))
      .then(() => { setSendError(null) })
      .catch((err: unknown) => { setSendError(err instanceof Error ? err.message : 'Failed to send input') })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || e.key === 'Process') return

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (e.metaKey || e.ctrlKey) {
        enqueue({ keys: ['Escape'] })
        return
      }
      const now = Date.now()
      if (escHintAtRef.current !== null && now - escHintAtRef.current < 800) {
        escHintAtRef.current = null
        if (escHintTimerRef.current !== null) { clearTimeout(escHintTimerRef.current); escHintTimerRef.current = null }
        setEscHint(false)
        onCloseModal?.()
        return
      }
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

  function handlePaste(e: globalThis.ClipboardEvent) {
    if (!e.clipboardData) return
    e.preventDefault()
    if (e.clipboardData.files.length > 0 && enqueueImageUploads(e.clipboardData.files)) return
    const pastedText = e.clipboardData.getData('text').replace(/\r\n?/g, '\n')
    if (pastedText !== '') enqueue({ text: pastedText })
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

  return (
    <div className={fillContainer ? 'flex flex-col flex-1 min-h-0' : undefined}>
      <div className={`mb-1.5 flex items-center gap-2${fillContainer ? ' flex-shrink-0' : ''}`}>
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-2">
          Log output
          {uploading && <span className="ml-2 normal-case tracking-normal text-accent-blue">uploading image…</span>}
        </p>
        <div className="inline-flex items-center gap-1">
          {(['live', 'history'] as const).map((key) => {
            const active = key === viewMode
            const label = key === 'live' ? 'Live' : 'History'
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (key === 'history') setHistoryError(false)
                  if (key === 'live' && interacting) setInteracting(false)
                  setViewMode(key)
                }}
                aria-pressed={active}
                className={`inline-flex h-5 cursor-pointer items-center rounded-[5px] px-1.5 text-[11px] font-medium transition active:scale-[0.985] ${active
                  ? 'bg-accent-blue text-white'
                  : 'border border-line bg-card text-ink-2 hover:bg-canvas'}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      {focused && (
        <details className={`mb-1.5 rounded-[7px] border border-line bg-canvas px-2 py-1 text-[10px] text-muted-2${fillContainer ? ' flex-shrink-0' : ''}`}>
          <summary className="cursor-pointer select-none font-semibold uppercase tracking-[0.06em] text-muted">
            Debug
          </summary>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 font-mono">
            <dt>ws</dt>
            <dd className="m-0 text-ink">{terminalDebug.wsStatus}</dd>
            <dt>ack</dt>
            <dd className="m-0 text-ink">{terminalDebug.lastAckMs === null ? '-' : `${terminalDebug.lastAckMs.toFixed(1)} ms`}</dd>
            <dt>echo</dt>
            <dd className="m-0 text-ink">{terminalDebug.lastEchoMs === null ? '-' : `${terminalDebug.lastEchoMs.toFixed(1)} ms`}</dd>
            <dt>output</dt>
            <dd className="m-0 text-ink">{terminalDebug.lastOutputAt ?? '-'} · {terminalDebug.lastOutputChars.toLocaleString()} chars</dd>
          </dl>
        </details>
      )}
      {!loaded ? (
        <p className="text-[12px] italic text-muted-2">{failed ? 'Could not load log output.' : 'Loading…'}</p>
      ) : !windowPresent ? (
        <p className="text-[12px] italic text-muted-2">Window not present.</p>
      ) : (
        <>
        <div
          ref={captureRef}
          data-terminal-capture="true"
          tabIndex={interacting ? 0 : -1}
          onKeyDown={interacting ? handleKeyDown : undefined}
          onBlur={interacting ? handleBlur : undefined}
          onDragOver={handleDragOver}
          onDragLeave={() => { setDragOver(false) }}
          onDrop={handleDrop}
          className={`relative overflow-hidden rounded-[10px] border-2 outline-none bg-[#0b0b0d] ${fillContainer ? 'flex flex-col flex-1 min-h-0 ' : ''}${dragOver
            ? 'border-accent-blue'
            : interacting
              ? 'border-[#e0901a]'
              : 'border-line'}${viewMode === 'history' ? ' hidden' : ''}`}
        >
          {interacting && (
            <div className="flex items-center gap-2 bg-[var(--color-accent-amber-on-solid)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Direct Input — keys go to {agentName}
              <button
                type="button"
                onClick={() => { setInteracting(false) }}
                className="ml-auto cursor-pointer font-bold underline"
              >stop</button>
            </div>
          )}
          <div
            ref={xtermContainerRef}
            className={`overflow-hidden rounded-[10px] bg-[#0b0b0d] ${fillContainer ? 'flex-1 min-h-0' : (maxHeightClass ?? 'h-48')} ${!interacting && onInteractChange !== undefined ? 'cursor-text' : ''}`}
            onClick={!interacting && onInteractChange !== undefined ? () => { setInteracting(true); captureRef.current?.focus() } : undefined}
            onMouseUp={() => {
              // xterm.js wires every mousedown in its own element to its internal focus(),
              // which steals focus onto the hidden .xterm-helper-textarea regardless of
              // disableStdin (confirmed at the xterm.js source — see
              // wiki/knowledge/concepts/browser-terminal-input-capture.md "Collision 2").
              // Win it back on mouseup (not mousedown) so a drag-select still completes before
              // focus moves — this covers a single click, both clicks of a double-click, and a
              // drag-select release, all while Direct Input is already active.
              if (interacting) captureRef.current?.focus()
            }}
          />
          {interacting && escHint && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute inset-x-4 bottom-4 z-10 rounded-[10px] bg-[var(--color-accent-amber-on-solid)] px-5 py-4 text-center shadow-lg"
            >
              <p className="m-0 text-[15px] font-bold text-white">Press esc again to close the modal</p>
              <p className="m-0 mt-1.5 text-[13px] font-medium text-white/80">Press ⌘/ctrl + esc to send esc to the agent</p>
            </div>
          )}
        </div>
        {viewMode === 'history' && (
          historyLoading ? (
            <p className="text-[12px] italic text-muted-2">Loading…</p>
          ) : historyError ? (
            <p className="text-[12px] italic text-muted-2">Could not load history.</p>
          ) : historyLog !== null && historyLog.length === 0 ? (
            <p className="text-[12px] italic text-muted-2">No persisted history yet.</p>
          ) : (
            <div className={`bg-[#0b0b0d] rounded-[10px] border border-line overflow-y-auto ${fillContainer ? 'flex-1 min-h-0' : (maxHeightClass ?? 'h-48')}`}>
              {historyLog?.map((entry) => (
                <Fragment key={entry.id}>
                  <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-2">
                    {formatChunkTs(entry.ts)}
                  </div>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-[#e7e8ea] px-2 py-1">{entry.chunk}</pre>
                </Fragment>
              ))}
            </div>
          )
        )}
        </>
      )}
      {windowPresent && viewMode === 'live' && (
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
            className="min-h-7 min-w-0 flex-1 resize-none overflow-hidden rounded-[7px] border border-line-input bg-card px-2 py-1 font-mono text-[11px] text-ink placeholder:text-muted-2"
            aria-label={`Send one-off text commands to ${agentName}`}
          />
          <button
            type="submit"
            disabled={sendText.trim() === ''}
            className="inline-flex h-7 cursor-pointer items-center rounded-[7px] bg-accent-blue-solid px-3 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40"
          >Send</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault() }}
            onClick={() => { setInteracting((prev) => !prev) }}
            className={interacting
              ? 'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] bg-[var(--color-accent-amber-on-solid)] px-3 text-[12px] font-semibold text-white transition hover:opacity-85 active:scale-[0.985]'
              : 'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] border border-[#e0901a]/40 bg-card px-3 text-[12px] font-semibold text-[#c07a10] transition hover:bg-[#e0901a]/10 active:scale-[0.985]'}
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
