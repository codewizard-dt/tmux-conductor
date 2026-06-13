import { useState } from 'react'
import { API_BASE } from '../lib/api'
import type { AgentMode } from './AgentList'

const MODES: { key: Exclude<AgentMode, 'unknown'>; label: string }[] = [
  { key: 'default',     label: 'Default' },
  { key: 'acceptEdits', label: 'Accept edits' },
  { key: 'plan',        label: 'Plan' },
  { key: 'bypass',      label: 'Bypass' },
]

export default function ModeSwitcher({ agentName, mode, windowPresent }: {
  agentName: string
  mode: AgentMode
  windowPresent: boolean
}) {
  const [pending, setPending] = useState<AgentMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(target: AgentMode) {
    if (target === mode || pending !== null) return
    setPending(target)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(agentName)}/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: target }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status.toString()}`)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to switch mode')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-2">Mode</span>
        <div className="inline-flex items-center gap-1">
          {MODES.map(({ key, label }) => {
            const active = key === mode
            return (
              <button
                key={key}
                type="button"
                onClick={() => { void handleClick(key) }}
                disabled={!windowPresent || pending !== null}
                aria-pressed={active}
                className={`inline-flex h-6 cursor-pointer items-center rounded-[7px] px-2.5 text-[11px] font-medium transition active:scale-[0.985] disabled:pointer-events-none disabled:opacity-40 ${
                  active
                    ? 'bg-accent-blue text-white'
                    : 'border border-line bg-white text-ink-2 hover:bg-canvas'
                } ${pending === key ? 'animate-pulse' : ''}`}
              >
                {pending === key ? `${label}…` : label}
              </button>
            )
          })}
        </div>
        {mode === 'unknown' && (
          <span className="text-[11px] italic text-muted-2">mode unknown</span>
        )}
      </div>
      {error && <p className="mt-1 text-[11px] text-accent-red">{error}</p>}
    </div>
  )
}
