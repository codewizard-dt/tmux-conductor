import { createBrowserRouter, RouterProvider, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { initRuntimeMode, subscribeRuntime, getSelectedDeviceId } from './lib/runtime'
import { useAuth } from './hooks/useAuth'
import AuthGuard from './components/AuthGuard'
import NavBar from './components/NavBar'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import ProfilePage from './pages/ProfilePage'
import AgentsPage from './pages/AgentsPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import DevicesPage from './pages/DevicesPage'
import InviteCodesPage from './pages/admin/InviteCodesPage'
import CreateInviteCodePage from './pages/admin/CreateInviteCodePage'

const adminEmail = (import.meta as ImportMeta & { env: { VITE_ADMIN_EMAIL?: string } }).env.VITE_ADMIN_EMAIL

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isLoading && user && user.email !== adminEmail) void navigate('/', { replace: true })
  }, [user, isLoading, navigate])
  if (isLoading || !user || user.email !== adminEmail) return null
  return <>{children}</>
}

function Dashboard() {
  // Remount the conductor subtree when the runtime changes (e.g. the selected
  // relay device switches): conductor components snapshot API_BASE at render
  // time, so re-keying forces a fresh capture of the repointed base.
  const [runtimeKey, setRuntimeKey] = useState(getSelectedDeviceId() ?? 'direct')
  useEffect(() => subscribeRuntime(() => {
    setRuntimeKey(getSelectedDeviceId() ?? 'direct')
  }), [])
  return (
    <div className="min-h-screen bg-canvas" key={runtimeKey}>
      <NavBar />
      <Routes>
        <Route path="/" element={<AgentsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/admin/invite-codes" element={<AdminGuard><InviteCodesPage /></AdminGuard>} />
        <Route path="/admin/invite-codes/new" element={<AdminGuard><CreateInviteCodePage /></AdminGuard>} />
      </Routes>
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/profile', element: <AuthGuard><ProfilePage /></AuthGuard> },
  { path: '/*', element: <AuthGuard><Dashboard /></AuthGuard> },
])

export default function App() {
  // Resolve the runtime mode (local-direct vs relay) before mounting the
  // router, so every conductor component captures the correct API_BASE on its
  // first render (AgentList et al. snapshot API_BASE at render time).
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    void initRuntimeMode().finally(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [])

  if (!ready) return null

  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
