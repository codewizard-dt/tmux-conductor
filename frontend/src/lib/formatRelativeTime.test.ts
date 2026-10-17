import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './formatRelativeTime'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString()
}

describe('formatRelativeTime (TASK-0207)', () => {
  it('reports "just now" under 5 seconds', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(4_999), NOW)).toBe('just now')
  })

  it('switches to seconds at 5s and to minutes at 60s', () => {
    expect(formatRelativeTime(ago(5_000), NOW)).toBe('5s ago')
    expect(formatRelativeTime(ago(59_999), NOW)).toBe('59s ago')
    expect(formatRelativeTime(ago(60_000), NOW)).toBe('1m ago')
  })

  it('switches to hours at 60 minutes and to days at 24 hours', () => {
    expect(formatRelativeTime(ago(59 * 60_000 + 59_000), NOW)).toBe('59m ago')
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe('1h ago')
    expect(formatRelativeTime(ago(23 * 3_600_000 + 59 * 60_000), NOW)).toBe('23h ago')
    expect(formatRelativeTime(ago(24 * 3_600_000), NOW)).toBe('1d ago')
    expect(formatRelativeTime(ago(3 * 24 * 3_600_000), NOW)).toBe('3d ago')
  })

  it('degrades an invalid timestamp to "unknown time"', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('unknown time')
    expect(formatRelativeTime('', NOW)).toBe('unknown time')
  })

  it('treats slight clock skew as "just now"', () => {
    expect(formatRelativeTime(ago(-3_000), NOW)).toBe('just now')
  })

  it('degrades a clearly future timestamp to the absolute local time', () => {
    const future = new Date(NOW + 60_000).toISOString()
    expect(formatRelativeTime(future, NOW)).toBe(new Date(future).toLocaleString())
  })
})
