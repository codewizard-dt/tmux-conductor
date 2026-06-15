import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface InviteCode {
  id: string
  code: string
  usage_limit: number
  used_count: number
  expires_at: string | null
  created_at: string
}

function isActive(code: InviteCode): boolean {
  if (code.used_count >= code.usage_limit) return false
  if (code.expires_at && new Date(code.expires_at) <= new Date()) return false
  return true
}

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchCodes() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invite-codes', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`)
      const data = await res.json() as InviteCode[]
      setCodes(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invite codes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchCodes()
  }, [])

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/admin/invite-codes/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status.toString()}`)
      await fetchCodes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite code')
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-ink">Invite Codes</h1>
        <Link
          to="/admin/invite-codes/new"
          className="inline-flex h-8 items-center rounded-[8px] bg-ink px-3 text-[12px] font-medium text-white transition hover:bg-ink-2"
        >
          New invite code
        </Link>
      </div>

      {error && (
        <p className="mb-4 text-[12px] text-accent-red">{error}</p>
      )}

      {loading ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="text-[13px] text-muted">No invite codes yet.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Code</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Limit</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Used</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Expires</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Active</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((code, i) => (
                <tr key={code.id} className={i < codes.length - 1 ? 'border-b border-line' : ''}>
                  <td className="px-4 py-2.5 font-mono text-ink">{code.code}</td>
                  <td className="px-4 py-2.5 text-ink">{code.usage_limit}</td>
                  <td className="px-4 py-2.5 text-ink">{code.used_count}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {code.expires_at ? new Date(code.expires_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {isActive(code) ? (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" title="Active" />
                    ) : (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-2" title="Inactive" />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => { void handleRevoke(code.id) }}
                      className="text-[12px] text-accent-red hover:underline"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
