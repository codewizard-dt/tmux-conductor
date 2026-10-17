import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLastPayloadCacheForTests,
  clearLastPayload,
  firstLinePreview,
  getLastPayloadSnapshot,
  LAST_PAYLOAD_KEY_PREFIX,
  LAST_PAYLOAD_MAX_CHARS,
  loadLastPayload,
  saveLastPayload,
  subscribeLastPayload,
  sweepOrphanedLastPayloads,
  useLastPayload,
  type LastPayloadEntry,
} from './lastPayload'

const T1 = '2026-09-20T10:00:00.000Z'
const T2 = '2026-09-20T10:00:05.000Z'

const entry = (
  text: string,
  ts = T1,
  source: LastPayloadEntry['source'] = 'hook',
): LastPayloadEntry => ({ text, ts, source })

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  __resetLastPayloadCacheForTests()
})

describe('saveLastPayload / loadLastPayload (TASK-0224)', () => {
  it('persists under conductor:lastPayload:<agentId> and round-trips', () => {
    const e = entry('hello', T1, 'add-task')
    expect(saveLastPayload(1, e)).toBe(true)
    expect(LAST_PAYLOAD_KEY_PREFIX).toBe('conductor:lastPayload:')
    expect(JSON.parse(localStorage.getItem('conductor:lastPayload:1') ?? 'null')).toEqual(e)
    expect(loadLastPayload(1)).toEqual(e)
  })

  it('returns null for a missing key', () => {
    expect(loadLastPayload(1)).toBeNull()
  })

  it('returns null for corrupt JSON, non-object JSON and objects missing text/ts', () => {
    localStorage.setItem('conductor:lastPayload:1', '{not json')
    expect(loadLastPayload(1)).toBeNull()
    localStorage.setItem('conductor:lastPayload:1', '"a string"')
    expect(loadLastPayload(1)).toBeNull()
    localStorage.setItem('conductor:lastPayload:1', 'null')
    expect(loadLastPayload(1)).toBeNull()
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify({ ts: T1, source: 'hook' }))
    expect(loadLastPayload(1)).toBeNull()
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify({ text: 'x', source: 'hook' }))
    expect(loadLastPayload(1)).toBeNull()
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify({ text: 1, ts: T1 }))
    expect(loadLastPayload(1)).toBeNull()
  })

  it("normalises an unknown or missing source to 'hook'", () => {
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify({ text: 'x', ts: T1, source: 'weird' }))
    expect(loadLastPayload(1)?.source).toBe('hook')
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify({ text: 'x', ts: T1 }))
    expect(loadLastPayload(1)?.source).toBe('hook')
  })

  it('degrades silently when storage throws', () => {
    saveLastPayload(1, entry('kept'))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadLastPayload(1)).toBeNull()
    __resetLastPayloadCacheForTests()
    expect(getLastPayloadSnapshot(1)).toBeNull()
  })

  it('returns false and does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    let stored = true
    expect(() => {
      stored = saveLastPayload(1, entry('x'))
    }).not.toThrow()
    expect(stored).toBe(false)
  })

  it('clearLastPayload does not throw when removeItem throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => {
      clearLastPayload(1)
    }).not.toThrow()
  })

  it('ignores blank text without writing', () => {
    expect(saveLastPayload(1, entry(''))).toBe(false)
    expect(saveLastPayload(1, entry('   \n'))).toBe(false)
    expect(localStorage.getItem('conductor:lastPayload:1')).toBeNull()
  })

  it('never overwrites a stored payload with blank text', () => {
    saveLastPayload(1, entry('real', T1))
    expect(saveLastPayload(1, entry('  ', T2))).toBe(false)
    expect(loadLastPayload(1)?.text).toBe('real')
  })

  it('does not trim stored text', () => {
    saveLastPayload(1, entry('  padded\n'))
    expect(loadLastPayload(1)?.text).toBe('  padded\n')
  })
})

describe('newest ts wins (TASK-0224 / TASK-0220 rule a)', () => {
  it('replaces an earlier entry with a later one', () => {
    saveLastPayload(1, entry('old', T1))
    expect(saveLastPayload(1, entry('new', T2))).toBe(true)
    expect(loadLastPayload(1)?.text).toBe('new')
  })

  it('rejects an earlier ts and leaves the stored value unchanged', () => {
    saveLastPayload(1, entry('new', T2))
    expect(saveLastPayload(1, entry('old', T1))).toBe(false)
    expect(loadLastPayload(1)).toEqual(entry('new', T2))
  })

  it('compares parsed epoch ms, not strings', () => {
    // Lexically '...+02:00' > '...Z' at the same wall time, but it is two hours earlier in epoch ms.
    saveLastPayload(1, entry('utc', '2026-09-20T10:00:00.000Z'))
    expect(saveLastPayload(1, entry('earlier', '2026-09-20T10:00:00.000+02:00'))).toBe(false)
    expect(loadLastPayload(1)?.text).toBe('utc')
  })

  it('on an exact tie, hook replaces add-task', () => {
    saveLastPayload(1, entry('typed in box', T1, 'add-task'))
    expect(saveLastPayload(1, entry('from hook', T1, 'hook'))).toBe(true)
    expect(loadLastPayload(1)).toEqual(entry('from hook', T1, 'hook'))
  })

  it('on an exact tie, add-task does not replace hook', () => {
    saveLastPayload(1, entry('from hook', T1, 'hook'))
    expect(saveLastPayload(1, entry('typed in box', T1, 'add-task'))).toBe(false)
    expect(loadLastPayload(1)?.source).toBe('hook')
  })

  it('an identical re-delivery is a no-op that does not notify', () => {
    saveLastPayload(1, entry('same', T1))
    const listener = vi.fn()
    subscribeLastPayload(listener)
    expect(saveLastPayload(1, entry('same', T1))).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('a valid ts overwrites an unparseable stored ts', () => {
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify(entry('corrupt', 'not-a-date')))
    expect(saveLastPayload(1, entry('fresh', T1))).toBe(true)
    expect(loadLastPayload(1)?.text).toBe('fresh')
  })

  it('an unparseable incoming ts loses to a valid stored ts', () => {
    saveLastPayload(1, entry('valid', T1))
    expect(saveLastPayload(1, entry('bad', 'not-a-date'))).toBe(false)
    expect(loadLastPayload(1)?.text).toBe('valid')
  })

  it('two unparseable ts values let the incoming entry win', () => {
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify(entry('corrupt', 'nope', 'hook')))
    expect(saveLastPayload(1, entry('incoming', 'also-nope', 'add-task'))).toBe(true)
    expect(loadLastPayload(1)?.text).toBe('incoming')
  })
})

describe('length cap (TASK-0220 rule b)', () => {
  it('leaves text at exactly the cap untouched', () => {
    const text = 'a'.repeat(LAST_PAYLOAD_MAX_CHARS)
    saveLastPayload(1, entry(text))
    expect(loadLastPayload(1)?.text).toBe(text)
  })

  it('stores a 5000-char text as exactly 2000 chars: 1999 plus one ellipsis', () => {
    saveLastPayload(1, entry('a'.repeat(5000)))
    const stored = loadLastPayload(1)?.text ?? ''
    expect(stored).toHaveLength(2000)
    expect(stored).toBe('a'.repeat(1999) + '…')
  })

  it('does not split a surrogate pair at the cut', () => {
    // '😀' is two code units; placing its high surrogate at index 1998 puts the cut mid-pair.
    const text = 'a'.repeat(1998) + '😀' + 'b'.repeat(100)
    saveLastPayload(1, entry(text))
    const stored = loadLastPayload(1)?.text ?? ''
    expect(stored).toBe('a'.repeat(1998) + '…')
    expect(stored).toHaveLength(1999)
  })

  it('is idempotent: an already-capped value is not re-truncated', () => {
    saveLastPayload(1, entry('a'.repeat(5000), T1))
    const once = loadLastPayload(1)?.text ?? ''
    saveLastPayload(1, entry(once, T2))
    expect(loadLastPayload(1)?.text).toBe(once)
  })
})

describe('per-agent isolation', () => {
  it('saving for one agent leaves another null and clear only affects its own key', () => {
    saveLastPayload(1, entry('one'))
    expect(loadLastPayload(2)).toBeNull()
    saveLastPayload(2, entry('two'))
    expect(localStorage.getItem('conductor:lastPayload:1')).not.toBeNull()
    expect(localStorage.getItem('conductor:lastPayload:2')).not.toBeNull()
    clearLastPayload(1)
    expect(loadLastPayload(1)).toBeNull()
    expect(loadLastPayload(2)?.text).toBe('two')
  })
})

describe('sweepOrphanedLastPayloads (TASK-0228)', () => {
  const key = (id: number) => `${LAST_PAYLOAD_KEY_PREFIX}${id.toString()}`

  it('removes only numeric ids that are not live and returns the count cleared', () => {
    saveLastPayload(1, entry('one'))
    saveLastPayload(2, entry('two'))
    saveLastPayload(99, entry('gone'))
    saveLastPayload(100, entry('also gone'))

    expect(sweepOrphanedLastPayloads([1, 2])).toBe(2)

    expect(localStorage.getItem(key(1))).not.toBeNull()
    expect(localStorage.getItem(key(2))).not.toBeNull()
    expect(localStorage.getItem(key(99))).toBeNull()
    expect(localStorage.getItem(key(100))).toBeNull()
    expect(loadLastPayload(99)).toBeNull()
  })

  it('accepts any iterable of live ids (a Set works)', () => {
    saveLastPayload(3, entry('three'))
    saveLastPayload(4, entry('four'))
    expect(sweepOrphanedLastPayloads(new Set([3]))).toBe(1)
    expect(localStorage.getItem(key(3))).not.toBeNull()
    expect(localStorage.getItem(key(4))).toBeNull()
  })

  it('leaves non-integer suffixes and foreign-prefix keys alone', () => {
    localStorage.setItem(`${LAST_PAYLOAD_KEY_PREFIX}abc`, 'x')
    localStorage.setItem(`${LAST_PAYLOAD_KEY_PREFIX}1.5`, 'x')
    localStorage.setItem(`${LAST_PAYLOAD_KEY_PREFIX}-2`, 'x')
    localStorage.setItem(LAST_PAYLOAD_KEY_PREFIX, 'x')
    localStorage.setItem('conductor:sendDraft:7', 'draft')
    localStorage.setItem('unrelated', 'y')

    expect(sweepOrphanedLastPayloads([])).toBe(0)

    expect(localStorage.length).toBe(6)
  })

  it('an empty live set clears every numeric payload key, including when several are adjacent', () => {
    for (const id of [1, 2, 3, 4, 5]) saveLastPayload(id, entry(`p${id.toString()}`))
    expect(sweepOrphanedLastPayloads([])).toBe(5)
    expect(localStorage.length).toBe(0)
  })

  it('returns 0 and touches nothing when every stored id is live', () => {
    saveLastPayload(1, entry('one'))
    expect(sweepOrphanedLastPayloads([1])).toBe(0)
    expect(loadLastPayload(1)?.text).toBe('one')
  })

  it('notifies subscribers once per cleared key', () => {
    saveLastPayload(1, entry('one'))
    saveLastPayload(8, entry('eight'))
    saveLastPayload(9, entry('nine'))
    const listener = vi.fn()
    subscribeLastPayload(listener)

    sweepOrphanedLastPayloads([1])

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not throw when localStorage.key throws, and reports what it cleared', () => {
    saveLastPayload(9, entry('nine'))
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('denied')
    })
    let cleared = -1
    expect(() => {
      cleared = sweepOrphanedLastPayloads([])
    }).not.toThrow()
    expect(cleared).toBe(0)
  })

  it('does not throw when removeItem throws', () => {
    saveLastPayload(9, entry('nine'))
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => sweepOrphanedLastPayloads([])).not.toThrow()
  })
})

describe('subscribe / notify', () => {
  it('notifies once per successful save and per clear, not for rejected saves', () => {
    const listener = vi.fn()
    subscribeLastPayload(listener)

    saveLastPayload(1, entry('a', T2))
    expect(listener).toHaveBeenCalledTimes(1)

    saveLastPayload(1, entry('older', T1))
    saveLastPayload(1, entry('   ', T2))
    expect(listener).toHaveBeenCalledTimes(1)

    clearLastPayload(1)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a storage event from another tab notifies and refreshes the snapshot', () => {
    const listener = vi.fn()
    subscribeLastPayload(listener)
    expect(getLastPayloadSnapshot(1)).toBeNull()

    localStorage.setItem('conductor:lastPayload:1', JSON.stringify(entry('from other tab')))
    window.dispatchEvent(new StorageEvent('storage', { key: 'conductor:lastPayload:1' }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(getLastPayloadSnapshot(1)?.text).toBe('from other tab')
  })

  it('a storage event with a null key (clear-all) notifies', () => {
    const listener = vi.fn()
    subscribeLastPayload(listener)
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a storage event for an unrelated key does not notify', () => {
    const listener = vi.fn()
    subscribeLastPayload(listener)
    window.dispatchEvent(new StorageEvent('storage', { key: 'conductor:agentOrder' }))
    expect(listener).not.toHaveBeenCalled()
  })

  it('stops calling a listener after unsubscribe and removes the window handler with the last one', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribeLastPayload(a)
    const unsubB = subscribeLastPayload(b)
    // One shared handler regardless of subscriber count.
    expect(addSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1)

    unsubA()
    saveLastPayload(1, entry('x'))
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    expect(removeSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0)

    unsubB()
    expect(removeSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1)
  })
})

describe('getLastPayloadSnapshot', () => {
  it('returns a referentially stable value until a save or clear', () => {
    saveLastPayload(1, entry('stable'))
    const first = getLastPayloadSnapshot(1)
    expect(getLastPayloadSnapshot(1)).toBe(first)

    saveLastPayload(1, entry('changed', T2))
    const second = getLastPayloadSnapshot(1)
    expect(second).not.toBe(first)
    expect(second?.text).toBe('changed')
    expect(getLastPayloadSnapshot(1)).toBe(second)

    clearLastPayload(1)
    expect(getLastPayloadSnapshot(1)).toBeNull()
  })

  it('keeps a stable null for an agent with no payload', () => {
    expect(getLastPayloadSnapshot(7)).toBeNull()
    expect(getLastPayloadSnapshot(7)).toBeNull()
  })
})

describe('firstLinePreview (TASK-0220 rule c)', () => {
  it('returns a single line trimmed', () => {
    expect(firstLinePreview('  hello world  ')).toBe('hello world')
  })

  it('skips leading blank lines', () => {
    expect(firstLinePreview('\n  \nfirst')).toBe('first')
  })

  it("appends ' …' when further non-empty lines follow", () => {
    expect(firstLinePreview('first\nsecond')).toBe('first …')
    expect(firstLinePreview('\nfirst\n\nthird')).toBe('first …')
  })

  it("does not append ' …' for trailing blank lines", () => {
    expect(firstLinePreview('first\n\n  \n')).toBe('first')
  })

  it('handles CRLF line endings', () => {
    expect(firstLinePreview('first\r\nsecond')).toBe('first …')
    expect(firstLinePreview('first\r\n')).toBe('first')
  })

  it('returns an empty string for empty or whitespace-only text', () => {
    expect(firstLinePreview('')).toBe('')
    expect(firstLinePreview('  \n \r\n')).toBe('')
  })
})

describe('useLastPayload', () => {
  it('returns null for an agent with no payload', () => {
    const { result } = renderHook(() => useLastPayload(42))
    expect(result.current).toBeNull()
  })

  it('re-renders with the saved entry', () => {
    const { result } = renderHook(() => useLastPayload(1))
    expect(result.current).toBeNull()
    act(() => {
      saveLastPayload(1, entry('live'))
    })
    expect(result.current?.text).toBe('live')
    act(() => {
      clearLastPayload(1)
    })
    expect(result.current).toBeNull()
  })

  it('ignores saves for a different agent', () => {
    const { result } = renderHook(() => useLastPayload(1))
    act(() => {
      saveLastPayload(2, entry('other'))
    })
    expect(result.current).toBeNull()
  })

  it('switches value when the agentId prop changes', () => {
    saveLastPayload(1, entry('one'))
    saveLastPayload(2, entry('two'))
    const { result, rerender } = renderHook(({ id }) => useLastPayload(id), {
      initialProps: { id: 1 },
    })
    expect(result.current?.text).toBe('one')
    rerender({ id: 2 })
    expect(result.current?.text).toBe('two')
  })

  it('re-renders on a cross-tab storage event', () => {
    const { result } = renderHook(() => useLastPayload(1))
    expect(result.current).toBeNull()
    act(() => {
      localStorage.setItem('conductor:lastPayload:1', JSON.stringify(entry('from other tab')))
      window.dispatchEvent(new StorageEvent('storage', { key: 'conductor:lastPayload:1' }))
    })
    expect(result.current?.text).toBe('from other tab')
  })

  it('renders a bounded number of times per change (stable snapshot, no render loop)', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useLastPayload(1)
    })
    const afterMount = renders
    expect(afterMount).toBeLessThanOrEqual(2)
    act(() => {
      saveLastPayload(1, entry('once'))
    })
    expect(result.current?.text).toBe('once')
    expect(renders - afterMount).toBeLessThanOrEqual(2)
  })

  it('unsubscribes on unmount so later saves do not touch a dead component', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useLastPayload(1))
    unmount()
    expect(removeSpy.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1)
    expect(() => {
      saveLastPayload(1, entry('after unmount'))
    }).not.toThrow()
  })
})

describe('write-side normalisation and edge keys (UAT-0224)', () => {
  it("normalises an unknown source to 'hook' on write", () => {
    const bad = { text: 'x', ts: T1, source: 'weird' } as unknown as LastPayloadEntry
    expect(saveLastPayload(1, bad)).toBe(true)
    expect(JSON.parse(localStorage.getItem('conductor:lastPayload:1') ?? 'null')).toEqual(
      entry('x', T1, 'hook'),
    )
  })

  it('a storage event with a non-numeric agent suffix still notifies and refreshes every snapshot', () => {
    const listener = vi.fn()
    subscribeLastPayload(listener)
    saveLastPayload(1, entry('one'))
    const before = getLastPayloadSnapshot(1)
    localStorage.setItem('conductor:lastPayload:1', JSON.stringify(entry('changed elsewhere', T2)))
    window.dispatchEvent(new StorageEvent('storage', { key: 'conductor:lastPayload:abc' }))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(getLastPayloadSnapshot(1)).not.toBe(before)
    expect(getLastPayloadSnapshot(1)?.text).toBe('changed elsewhere')
  })

  it('a throwing getItem does not stop a save from being attempted', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => {
      saveLastPayload(1, entry('x'))
    }).not.toThrow()
  })
})
