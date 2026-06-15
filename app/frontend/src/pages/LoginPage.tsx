import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

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

export default function LoginPage() {
  const { user, isLoading, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isLoading && user) void navigate('/', { replace: true })
  }, [user, isLoading, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      void navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) return null

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[340px] animate-riseIn">
        <div className="mb-7 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          <span className="text-[13px] font-semibold tracking-tight text-ink">conductor</span>
        </div>

        <div className="rounded-card border border-line bg-white px-5 py-5 shadow-card">
          <h1 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Sign in
          </h1>
          <form
            onSubmit={(e) => { void handleSubmit(e) }}
            className="flex flex-col gap-3"
          >
            <div className={fieldCls}>
              <label htmlFor="email" className={labelCls}>Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => { setEmail(e.target.value) }}
                className={inputCls}
              />
            </div>
            <div className={fieldCls}>
              <label htmlFor="password" className={labelCls}>Password</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value) }}
                className={inputCls}
              />
            </div>
            {error && (
              <p className="text-[12px] text-accent-red">{error}</p>
            )}
            <button type="submit" disabled={submitting} className={btnCls}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="mt-4 text-center text-[12px] text-muted">
            Don&apos;t have an account?{' '}
            <Link to="/signup" className="text-ink hover:underline">Sign up →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
