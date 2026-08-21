import { describe, expect, it } from 'vitest'
import { formatChunkTs } from './LogTail'

describe('formatChunkTs', () => {
  it('transforms a valid ISO timestamp into a different, non-empty string', () => {
    const input = '2026-07-06T10:00:00Z'
    const result = formatChunkTs(input)
    expect(result.length).toBeGreaterThan(0)
    expect(result).not.toBe(input)
  })

  it('returns an unparseable string unchanged', () => {
    expect(formatChunkTs('not-a-date')).toBe('not-a-date')
  })

  it('returns an empty string unchanged', () => {
    expect(formatChunkTs('')).toBe('')
  })

  it('returns a malformed date-shaped string unchanged (fails Date parsing)', () => {
    const malformed = '2026-99-99T99:99:99Z'
    expect(formatChunkTs(malformed)).toBe(malformed)
  })
})
