import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react'
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS, HOVER_OPEN_DELAY_TYPING_MS } from './layoutConstants'
import { useHoverExpand } from './useHoverExpand'

// The hook only reads `relatedTarget`, `key` and `target` off the synthetic events, so minimal
// fakes stand in for them rather than dispatching real DOM events through React.
const mouseEvent = (): MouseEvent<HTMLElement> => ({}) as unknown as MouseEvent<HTMLElement>
const focusEvent = (relatedTarget: EventTarget | null = null): FocusEvent<HTMLElement> =>
  ({ relatedTarget }) as unknown as FocusEvent<HTMLElement>
const keyEvent = (key: string, target: EventTarget): KeyboardEvent<HTMLElement> =>
  ({ key, target }) as unknown as KeyboardEvent<HTMLElement>

describe('useHoverExpand', () => {
  let container: HTMLDivElement
  let inner: HTMLButtonElement
  let outside: HTMLButtonElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    inner = document.createElement('button')
    outside = document.createElement('button')
    container.appendChild(inner)
    document.body.appendChild(container)
    document.body.appendChild(outside)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    container.remove()
    outside.remove()
  })

  function setup(options: { enabled?: boolean; getOpenDelayMs?: () => number } = {}) {
    return renderHook(() =>
      useHoverExpand({
        enabled: options.enabled ?? true,
        containerRef: { current: container },
        ...(options.getOpenDelayMs ? { getOpenDelayMs: options.getOpenDelayMs } : {}),
      }),
    )
  }

  it('opens only after the open delay on mouse enter', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS - 1) })
    expect(result.current.open).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.open).toBe(true)
  })

  it('never opens when the pointer leaves before the open delay', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS / 2) })
    act(() => { result.current.containerProps.onMouseLeave(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS + HOVER_CLOSE_DELAY_MS) })
    expect(result.current.open).toBe(false)
  })

  it('closes after the close delay on mouse leave', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS) })
    expect(result.current.open).toBe(true)
    act(() => { result.current.containerProps.onMouseLeave(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS - 1) })
    expect(result.current.open).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.open).toBe(false)
  })

  it('cancels a pending close when the pointer re-enters within the close delay', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS) })
    act(() => { result.current.containerProps.onMouseLeave(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS - 50) })
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 2) })
    expect(result.current.open).toBe(true)
  })

  it('uses getOpenDelayMs, evaluated at enter time, for the open delay', () => {
    const { result } = setup({ getOpenDelayMs: () => HOVER_OPEN_DELAY_TYPING_MS })
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_TYPING_MS - 1) })
    expect(result.current.open).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.open).toBe(true)
  })

  it('opens immediately on focus', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    expect(result.current.open).toBe(true)
  })

  it('closes on blur when focus moves outside the container', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.containerProps.onBlur(focusEvent(outside)) })
    expect(result.current.open).toBe(false)
  })

  it('closes on blur when focus leaves the window entirely (null relatedTarget)', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.containerProps.onBlur(focusEvent(null)) })
    expect(result.current.open).toBe(false)
  })

  it('stays open on blur when focus moves within the container', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.containerProps.onBlur(focusEvent(inner)) })
    expect(result.current.open).toBe(true)
  })

  it('does not close on mouse leave while keyboard focus is inside the container', () => {
    const { result } = setup()
    inner.focus()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.containerProps.onMouseLeave(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 2) })
    expect(result.current.open).toBe(true)
  })

  it('closes on Escape from inside the container and ignores other keys', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.containerProps.onKeyDown(keyEvent('a', inner)) })
    expect(result.current.open).toBe(true)
    act(() => { result.current.containerProps.onKeyDown(keyEvent('Escape', outside)) })
    expect(result.current.open).toBe(true)
    act(() => { result.current.containerProps.onKeyDown(keyEvent('Escape', inner)) })
    expect(result.current.open).toBe(false)
  })

  it('close() cancels pending timers and closes immediately', () => {
    const { result } = setup()
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    act(() => { result.current.close() })
    expect(result.current.open).toBe(false)
  })

  it('stays closed and ignores events when disabled', () => {
    const { result } = setup({ enabled: false })
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 2) })
    expect(result.current.open).toBe(false)
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    expect(result.current.open).toBe(false)
  })

  it('reads closed when disabled after having been open', () => {
    let enabled = true
    const { result, rerender } = renderHook(() =>
      useHoverExpand({ enabled, containerRef: { current: container } }),
    )
    act(() => { result.current.containerProps.onFocus(focusEvent()) })
    expect(result.current.open).toBe(true)
    enabled = false
    rerender()
    expect(result.current.open).toBe(false)
  })

  it('clears pending timers on unmount without a late state update', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result, unmount } = setup()
    act(() => { result.current.containerProps.onMouseEnter(mouseEvent()) })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS * 2) })
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
