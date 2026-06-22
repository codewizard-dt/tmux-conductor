import { NavLink } from 'react-router-dom'

export default function NavBar() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
  `text-[13px] font-medium transition ${
    isActive
      ? 'text-ink border-b-2 border-accent-green pb-[2px]'
      : 'text-muted hover:text-ink'
  }`

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center gap-6 border-b border-line bg-canvas/80 px-6 backdrop-blur-sm">
      <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-ink">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green" />
        conductor
      </span>
      <nav className="flex items-center gap-4">
        <NavLink to="/" end className={linkCls}>Agents</NavLink>
        <NavLink to="/projects" className={linkCls}>Projects</NavLink>
      </nav>
    </header>
  )
}
