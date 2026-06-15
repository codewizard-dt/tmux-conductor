import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getInitials } from '../lib/auth'

export default function AuthBadge() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => { document.removeEventListener('mousedown', onMouseDown) }
  }, [open])

  if (!user) return null

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    void navigate('/login', { replace: true })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen((v) => !v) }}
        aria-label="Account menu"
        aria-expanded={open}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {getInitials(user.name, user.email)}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 animate-popIn rounded-[10px] border border-line bg-white py-1 shadow-pop">
          <div className="border-b border-line px-3.5 pb-2.5 pt-2.5">
            <p className="truncate text-[13px] font-semibold text-ink">{user.name || user.email}</p>
            {user.name && <p className="truncate text-[11px] text-muted">{user.email}</p>}
          </div>
          <div className="py-1">
            <Link
              to="/profile"
              onClick={() => { setOpen(false) }}
              className="flex h-8 items-center px-3.5 text-[13px] text-ink transition hover:bg-canvas"
            >
              Profile
            </Link>
            <button
              type="button"
              onClick={() => { void handleSignOut() }}
              className="flex h-8 w-full items-center px-3.5 text-[13px] text-accent-red transition hover:bg-canvas"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
