import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getInitials } from '../lib/auth'

const sectionCls = 'rounded-card border border-line bg-white px-5 py-5 shadow-card'
const sectionTitleCls = 'mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted'

export default function ProfilePage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 flex h-12 items-center border-b border-line bg-canvas/80 px-6 backdrop-blur-sm">
        <Link
          to="/"
          className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-ink transition hover:text-ink-2"
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          conductor
        </Link>
      </header>

      <main className="mx-auto max-w-[640px] px-6 py-8">
        <h1 className="mb-5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
          Profile
        </h1>

        <div className={`${sectionCls} animate-riseIn`}>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-white">
              {user ? getInitials(user.name, user.email) : '?'}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-ink">{user?.name || '—'}</p>
              <p className="truncate text-[13px] text-muted">{user?.email}</p>
            </div>
          </div>
        </div>

        <div className={`${sectionCls} mt-4 opacity-50`}>
          <h2 className={sectionTitleCls}>Devices</h2>
          <p className="text-[13px] text-muted-2">Coming soon.</p>
        </div>

        <div className={`${sectionCls} mt-4 opacity-50`}>
          <h2 className={sectionTitleCls}>Security</h2>
          <p className="text-[13px] text-muted-2">Coming soon.</p>
        </div>
      </main>
    </div>
  )
}
