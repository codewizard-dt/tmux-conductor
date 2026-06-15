import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { validateInviteCode, signUp } from '../lib/auth'

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

const INVITE_ERROR_MAP: Record<string, string> = {
  invalid: 'This invite code is invalid.',
  expired: 'This invite code has expired.',
  exhausted: 'This invite code has been fully used.',
}

export default function SignupPage() {
  const { user, isLoading, refetch } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2>(1)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signupError, setSignupError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isLoading && user) void navigate('/', { replace: true })
  }, [user, isLoading, navigate])

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setValidating(true)
    try {
      const result = await validateInviteCode(inviteCode)
      if (result.valid) {
        setStep(2)
      } else {
        const key = result.error ?? 'invalid'
        setInviteError(INVITE_ERROR_MAP[key] ?? 'This invite code is invalid.')
      }
    } catch {
      setInviteError('Failed to validate invite code. Please try again.')
    } finally {
      setValidating(false)
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setSignupError(null)
    setSubmitting(true)
    try {
      await signUp({ name, email, password, inviteCode })
      await refetch()
      void navigate('/', { replace: true })
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : 'Sign up failed')
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
            {step === 1 ? 'Enter invite code' : 'Create account'}
          </h1>

          {step === 1 ? (
            <form
              onSubmit={(e) => { void handleValidate(e) }}
              className="flex flex-col gap-3"
            >
              <div className={fieldCls}>
                <label htmlFor="invite-code" className={labelCls}>Invite code</label>
                <input
                  id="invite-code"
                  type="text"
                  required
                  autoFocus
                  value={inviteCode}
                  onChange={(e) => { setInviteCode(e.target.value) }}
                  className={inputCls}
                />
              </div>
              {inviteError && (
                <p className="text-[12px] text-accent-red">{inviteError}</p>
              )}
              <button type="submit" disabled={validating} className={btnCls}>
                {validating ? 'Checking…' : 'Continue'}
              </button>
            </form>
          ) : (
            <form
              onSubmit={(e) => { void handleSignup(e) }}
              className="flex flex-col gap-3"
            >
              <div className={fieldCls}>
                <label htmlFor="name" className={labelCls}>Name</label>
                <input
                  id="name"
                  type="text"
                  required
                  autoFocus
                  autoComplete="name"
                  value={name}
                  onChange={(e) => { setName(e.target.value) }}
                  className={inputCls}
                />
              </div>
              <div className={fieldCls}>
                <label htmlFor="email" className={labelCls}>Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
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
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value) }}
                  className={inputCls}
                />
              </div>
              {signupError && (
                <p className="text-[12px] text-accent-red">{signupError}</p>
              )}
              <button type="submit" disabled={submitting} className={btnCls}>
                {submitting ? 'Creating account…' : 'Create account'}
              </button>
            </form>
          )}

          <p className="mt-4 text-center text-[12px] text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-ink hover:underline">Sign in →</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
