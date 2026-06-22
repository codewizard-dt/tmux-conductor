import { useEffect, useRef } from 'react'
import { API_BASE } from '../lib/api'

/**
 * Shared SSE plumbing for the dashboard.
 *
 * A single module-level EventSource is opened lazily on the first subscription
 * and shared across every `useSSEEvent` consumer, so adding more subscribers
 * (e.g. many LogTail instances listening for `terminal-output`) never opens a
 * second connection. The EventSource is reference-counted: it closes once the
 * last subscriber unmounts and reopens on the next subscription.
 *
 * Note: `useAgents.ts` and `AgentList.tsx` still open their own EventSource for
 * the agent/session event streams; this hook is an additive, independent shared
 * channel introduced for `terminal-output`. Migrating those is out of scope here.
 */

type Subscriber = (payload: unknown) => void

const subscribers = new Map<string, Set<Subscriber>>()
const listeners = new Map<string, (e: MessageEvent) => void>()

let source: EventSource | null = null
let refCount = 0

function ensureSource(): EventSource {
  source ??= new EventSource(`${API_BASE}/events`)
  return source
}

function attachListener(eventName: string): void {
  if (listeners.has(eventName)) return
  const handler = (e: MessageEvent): void => {
    const set = subscribers.get(eventName)
    if (!set || set.size === 0) return
    let payload: unknown
    try {
      payload = JSON.parse(e.data as string)
    } catch {
      return // ignore malformed events
    }
    for (const cb of set) {
      try {
        cb(payload)
      } catch {
        /* a subscriber throwing must not break the others */
      }
    }
  }
  listeners.set(eventName, handler)
  ensureSource().addEventListener(eventName, handler)
}

function subscribe(eventName: string, cb: Subscriber): () => void {
  ensureSource()
  refCount += 1

  let set = subscribers.get(eventName)
  if (!set) {
    set = new Set<Subscriber>()
    subscribers.set(eventName, set)
  }
  set.add(cb)
  attachListener(eventName)

  return () => {
    const current = subscribers.get(eventName)
    current?.delete(cb)

    refCount -= 1
    if (refCount <= 0) {
      // Last subscriber gone: tear the shared connection down cleanly.
      refCount = 0
      if (source) {
        for (const [name, handler] of listeners) {
          source.removeEventListener(name, handler)
        }
        source.close()
        source = null
      }
      listeners.clear()
      subscribers.clear()
    }
  }
}

/**
 * Subscribe a component to a named SSE event on the shared `/events` stream.
 *
 * The callback receives the already-parsed JSON payload (`JSON.parse(event.data)`).
 * Registration happens on mount and is torn down on unmount. The shared
 * EventSource is opened on the first subscriber and closed after the last one
 * unmounts — multiple subscribers never open more than one connection.
 *
 * @example
 * useSSEEvent<{ agent: string; text: string; lines: number }>('terminal-output', (payload) => {
 *   if (payload.agent === agentName) setText(payload.text)
 * })
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useSSEEvent<T = unknown>(
  eventName: string,
  callback: (payload: T) => void,
): void {
  // Keep a ref to the latest callback so callers can pass an inline closure
  // without re-subscribing (and bouncing the shared connection) every render.
  const callbackRef = useRef(callback)
  // eslint-disable-next-line react-hooks/refs
  callbackRef.current = callback

  useEffect(() => {
    const cb: Subscriber = (payload) => { callbackRef.current(payload as T) }
    return subscribe(eventName, cb)
  }, [eventName])
}
