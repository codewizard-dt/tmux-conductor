import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import AddAgentForm from './AddAgentForm'
import AddBgProcessForm from './AddBgProcessForm'

type Theme = 'light' | 'dark'

function getInitialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export default function NavBar() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [showAddBg, setShowAddBg] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme just won't persist
    }
  }, [theme])

  const toggleTheme = () => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  const linkCls = ({ isActive }: { isActive: boolean }) =>
  `text-[13px] font-medium transition ${
    isActive
      ? 'text-ink border-b-2 border-accent-green pb-[2px]'
      : 'text-muted hover:text-ink'
  }`

  return (
    <>
      <header className="sticky top-0 z-10 flex h-12 items-center gap-6 border-b border-line bg-canvas/80 px-6 backdrop-blur-sm">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-ink">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
          conductor
        </span>
        <nav className="flex items-center gap-4">
          <NavLink to="/" end className={linkCls}>Agents</NavLink>
          <NavLink to="/projects" className={linkCls}>Projects</NavLink>
          <NavLink to="/history" className={linkCls}>History</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setShowAddAgent(true) }}
            className="inline-flex h-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-[8px] bg-button-primary px-4 text-[13px] font-medium text-button-primary-text shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:opacity-90 active:scale-[0.985]"
          >
            + Add Agent
          </button>
          <button
            type="button"
            onClick={() => { setShowAddBg(true) }}
            className="inline-flex h-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-line bg-card px-4 text-[13px] font-medium text-ink transition hover:bg-canvas active:scale-[0.985]"
          >
            + Add Background Process
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-line text-[13px] text-muted transition hover:bg-surface hover:text-ink"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </header>
      {showAddAgent && <AddAgentForm open onClose={() => { setShowAddAgent(false) }} />}
      {showAddBg && <AddBgProcessForm open onClose={() => { setShowAddBg(false) }} />}
    </>
  )
}
