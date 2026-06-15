import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading && !user) {
      void navigate('/login', { replace: true })
    }
  }, [user, isLoading, navigate])

  if (isLoading || !user) return null
  return <>{children}</>
}
