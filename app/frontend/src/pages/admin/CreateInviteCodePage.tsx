import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

const fieldCls = 'flex flex-col gap-1.5'
const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-muted'
const inputCls = [
  'w-full rounded-[8px] border border-line bg-white px-3 py-1.5',
  'text-[13px] text-ink placeholder:text-muted-2',
  'outline-none transition',
  'focus:border-accent focus:ring-2 focus:ring-accent/10',
].join(' ')
const btnCls = [
  'inline-flex w-full h-9 cursor-pointer items-center justify-center rounded-[8px]',
  'bg-ink px-4 text-[13px] font-medium text-white',
  'shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)]',
  'transition hover:bg-ink-2 active:scale-[0.985]',
  'disabled:pointer-events-none disabled:opacity-50',
].join(' ')

export default function CreateInviteCodePage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [usageLimit, setUsageLimit] = useState(1)
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const body: { code: string; usageLimit: number; expiresAt?: string } = {
        code,
        usageLimit,
      }
      if (expiresAt) body.expiresAt = expiresAt

      const res = await fetch('/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })

      if (res.status === 409) {
        setError('A code with that name already exists.')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status.toString()}`)
      }

      void navigate('/admin/invite-codes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite code')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[480px] px-6 py-8">
      <Link
        to="/admin/invite-codes"
        className="mb-6 inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"
      >
        ← Back to list
      </Link>

      <div className="mt-4 rounded-card border border-line bg-white px-5 py-5 shadow-card">
        <h1 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          New invite code
        </h1>
        <form
          onSubmit={(e) => { void handleSubmit(e) }}
          className="flex flex-col gap-3"
        >
          <div className={fieldCls}>
            <label htmlFor="code" className={labelCls}>Code</label>
            <input
              id="code"
              type="text"
              required
              autoFocus
              value={code}
              onChange={(e) => { setCode(e.target.value) }}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label htmlFor="usage-limit" className={labelCls}>Usage limit</label>
            <input
              id="usage-limit"
              type="number"
              required
              min={1}
              value={usageLimit}
              onChange={(e) => { setUsageLimit(Number(e.target.value)) }}
              className={inputCls}
            />
          </div>
          <div className={fieldCls}>
            <label htmlFor="expires-at" className={labelCls}>Expires at (optional)</label>
            <input
              id="expires-at"
              type="date"
              value={expiresAt}
              onChange={(e) => { setExpiresAt(e.target.value) }}
              className={inputCls}
            />
          </div>
          {error && (
            <p className="text-[12px] text-accent-red">{error}</p>
          )}
          <button type="submit" disabled={submitting} className={btnCls}>
            {submitting ? 'Creating…' : 'Create invite code'}
          </button>
        </form>
      </div>
    </div>
  )
}
