import { useSyncExternalStore } from 'react'

// Per-agent "last user payload" store (TASK-0224, ROADMAP-0027). Persists { text, ts, source } per
// agent id in localStorage so the detail-pane strip and the sidebar card can show the last message
// the user sent. Storage rules (newest ts wins, 2000-char cap, blank never overwrites) are decided in
// TASK-0220 and shared with the hook sidecar; see wiki/knowledge/concepts/hook-authoritative-last-prompt.md.
export const LAST_PAYLOAD_KEY_PREFIX = 'conductor:lastPayload:'

// Total stored length in UTF-16 code units, including the ellipsis marker when text is truncated.
export const LAST_PAYLOAD_MAX_CHARS = 2000

const ELLIPSIS = '…'

export interface LastPayloadEntry {
  text: string
  // ISO-8601 UTC string; compared as parsed epoch milliseconds, never lexically.
  ts: string
  source: 'hook' | 'add-task'
}

const listeners = new Set<() => void>()
// Per-agent snapshot cache: useSyncExternalStore requires a referentially stable value between
// changes, and loadLastPayload returns a fresh JSON.parse result on every call.
const snapshotCache = new Map<number, LastPayloadEntry | null>()
let storageHandlerAttached = false

function keyFor(agentId: number): string {
  return `${LAST_PAYLOAD_KEY_PREFIX}${agentId.toString()}`
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

// Unparseable timestamps count as the oldest possible value.
function epochMs(ts: string): number {
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? -Infinity : ms
}

// Truncates to LAST_PAYLOAD_MAX_CHARS total: the first 1999 code units plus a single ellipsis. A
// dangling high surrogate at the cut is dropped so a pair is never split. Text already within the
// cap is returned untouched, which makes the function idempotent.
function capText(text: string): string {
  if (text.length <= LAST_PAYLOAD_MAX_CHARS) return text
  let cut = text.slice(0, LAST_PAYLOAD_MAX_CHARS - ELLIPSIS.length)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut + ELLIPSIS
}

// True when `incoming` should replace `current`: newer ts wins; on an exact tie `hook` beats
// `add-task`, and a same-source tie only lands when the text differs (an idempotent re-delivery
// is a no-op). Two unparseable timestamps let the incoming entry win so a corrupt record can be fixed.
function shouldReplace(current: LastPayloadEntry, incoming: LastPayloadEntry): boolean {
  const currentMs = epochMs(current.ts)
  const incomingMs = epochMs(incoming.ts)
  if (incomingMs > currentMs) return true
  if (incomingMs < currentMs) return false
  if (incomingMs === -Infinity) return true
  if (incoming.source === current.source) return incoming.text !== current.text
  return incoming.source === 'hook'
}

export function loadLastPayload(agentId: number): LastPayloadEntry | null {
  try {
    const raw = localStorage.getItem(keyFor(agentId))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { text, ts, source } = parsed as Record<string, unknown>
    if (typeof text !== 'string' || typeof ts !== 'string') return null
    return { text, ts, source: source === 'add-task' ? 'add-task' : 'hook' }
  } catch {
    return null
  }
}

// Returns whether the entry was stored. Blank text, an older ts and a storage failure all return false.
export function saveLastPayload(agentId: number, entry: LastPayloadEntry): boolean {
  if (entry.text.trim() === '') return false
  const incoming: LastPayloadEntry = {
    text: capText(entry.text),
    ts: entry.ts,
    source: entry.source === 'add-task' ? 'add-task' : 'hook',
  }
  const current = loadLastPayload(agentId)
  if (current !== null && !shouldReplace(current, incoming)) return false
  try {
    localStorage.setItem(keyFor(agentId), JSON.stringify(incoming))
  } catch {
    // storage unavailable (private mode / quota) — nothing persisted, callers just skip the display
    return false
  }
  snapshotCache.delete(agentId)
  notify()
  return true
}

export function clearLastPayload(agentId: number): void {
  try {
    localStorage.removeItem(keyFor(agentId))
  } catch {
    // storage unavailable — nothing to clear
  }
  snapshotCache.delete(agentId)
  notify()
}

// Drops stored payloads whose agent id is no longer live. SQLite reuses the highest id after a
// delete, so a key left behind by a missed `agent-removed` would show on the next agent handed
// that id. Non-integer suffixes are not ours to judge and are left alone. Returns the count cleared.
export function sweepOrphanedLastPayloads(liveAgentIds: Iterable<number>): number {
  let cleared = 0
  try {
    const live = new Set(liveAgentIds)
    // Collect first, remove after: removing while iterating shifts localStorage indices.
    const orphans: number[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(LAST_PAYLOAD_KEY_PREFIX)) continue
      const suffix = key.slice(LAST_PAYLOAD_KEY_PREFIX.length)
      if (!/^\d+$/.test(suffix)) continue
      const id = Number(suffix)
      if (!live.has(id)) orphans.push(id)
    }
    for (const id of orphans) {
      clearLastPayload(id)
      cleared++
    }
  } catch {
    // storage unavailable — report what was cleared so far
  }
  return cleared
}

// localStorage only fires `storage` in the *other* tabs, so this covers cross-tab writes; same-tab
// writes notify directly from saveLastPayload / clearLastPayload.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key === null) {
    snapshotCache.clear()
    notify()
    return
  }
  if (!event.key.startsWith(LAST_PAYLOAD_KEY_PREFIX)) return
  const agentId = Number(event.key.slice(LAST_PAYLOAD_KEY_PREFIX.length))
  if (Number.isInteger(agentId)) snapshotCache.delete(agentId)
  else snapshotCache.clear()
  notify()
}

function detachStorageHandler(): void {
  if (!storageHandlerAttached) return
  storageHandlerAttached = false
  if (typeof window !== 'undefined') window.removeEventListener('storage', handleStorageEvent)
}

// Declared at module level so its identity is stable for useSyncExternalStore.
export function subscribeLastPayload(listener: () => void): () => void {
  listeners.add(listener)
  if (!storageHandlerAttached && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent)
    storageHandlerAttached = true
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) detachStorageHandler()
  }
}

export function getLastPayloadSnapshot(agentId: number): LastPayloadEntry | null {
  if (snapshotCache.has(agentId)) return snapshotCache.get(agentId) ?? null
  const entry = loadLastPayload(agentId)
  snapshotCache.set(agentId, entry)
  return entry
}

export function useLastPayload(agentId: number): LastPayloadEntry | null {
  return useSyncExternalStore(
    subscribeLastPayload,
    () => getLastPayloadSnapshot(agentId),
    () => null,
  )
}

// First non-empty (trimmed) line, plus ' …' when further non-empty lines follow; '' when none.
// Shared by the detail-pane strip and the sidebar card so both render multi-line payloads alike.
export function firstLinePreview(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const firstIndex = lines.findIndex((line) => line !== '')
  if (firstIndex === -1) return ''
  const first = lines[firstIndex] ?? ''
  const more = lines.slice(firstIndex + 1).some((line) => line !== '')
  return more ? `${first} …` : first
}

// jsdom's localStorage.clear() fires no `storage` event in the same window, so tests reset the
// snapshot cache, listener set and window handler explicitly.
export function __resetLastPayloadCacheForTests(): void {
  snapshotCache.clear()
  listeners.clear()
  detachStorageHandler()
}
