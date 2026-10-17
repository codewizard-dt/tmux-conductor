import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, RefObject } from 'react'
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from './layoutConstants'

interface UseHoverExpandOptions {
  // When false the flyout never opens: `open` reads false and every handler is a no-op.
  enabled: boolean
  // The flyout's container; hover/focus/blur are judged against whether they stay inside it.
  containerRef: RefObject<HTMLElement | null>
  // Open delay, evaluated when the pointer enters (so callers can lengthen it while typing).
  getOpenDelayMs?: () => number
}

interface HoverExpandContainerProps {
  onMouseEnter: (e: MouseEvent<HTMLElement>) => void
  onMouseLeave: (e: MouseEvent<HTMLElement>) => void
  onFocus: (e: FocusEvent<HTMLElement>) => void
  onBlur: (e: FocusEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
}

interface UseHoverExpandResult {
  open: boolean
  close: () => void
  containerProps: HoverExpandContainerProps
}

const defaultOpenDelayMs = (): number => HOVER_OPEN_DELAY_MS

// Hover/focus-driven open state for the minimized sidebar's flyout. Open is delayed on enter and
// close is delayed on leave, so a pointer crossing the rail in passing doesn't flicker the flyout;
// keyboard focus inside the container pins it open until focus leaves.
export function useHoverExpand({
  enabled,
  containerRef,
  getOpenDelayMs = defaultOpenDelayMs,
}: UseHoverExpandOptions): UseHoverExpandResult {
  const [open, setOpen] = useState(false)
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const close = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    setOpen(false)
  }, [clearOpenTimer, clearCloseTimer])

  useEffect(() => {
    return () => {
      clearOpenTimer()
      clearCloseTimer()
    }
  }, [clearOpenTimer, clearCloseTimer])

  const isInside = (node: EventTarget | null): boolean =>
    node instanceof Node && !!containerRef.current?.contains(node)

  const onMouseEnter = (): void => {
    if (!enabled) return
    clearCloseTimer()
    if (open || openTimerRef.current !== null) return
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null
      setOpen(true)
    }, getOpenDelayMs())
  }

  const onMouseLeave = (): void => {
    if (!enabled) return
    clearOpenTimer()
    // Keyboard focus inside keeps the flyout open; onBlur closes it when focus leaves.
    if (isInside(document.activeElement)) return
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  const onFocus = (): void => {
    if (!enabled) return
    clearOpenTimer()
    clearCloseTimer()
    setOpen(true)
  }

  const onBlur = (e: FocusEvent<HTMLElement>): void => {
    if (!enabled) return
    if (!isInside(e.relatedTarget)) setOpen(false)
  }

  // No stopPropagation: Direct Input's own Escape handling lives in LogTail.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (!enabled || !open) return
    if (e.key === 'Escape' && isInside(e.target)) close()
  }

  return {
    open: open && enabled,
    close,
    containerProps: { onMouseEnter, onMouseLeave, onFocus, onBlur, onKeyDown },
  }
}
