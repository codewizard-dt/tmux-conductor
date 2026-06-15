import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { getSession, type AuthUser } from '../lib/auth'

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    const session = await getSession()
    setUser(session?.user ?? null)
  }, [])

  useEffect(() => {
    setIsLoading(true)
    void refetch().finally(() => { setIsLoading(false) })
  }, [refetch])

  useEffect(() => {
    function handleUnauthorized() {
      setUser(null)
      window.location.replace('/login')
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => { window.removeEventListener('auth:unauthorized', handleUnauthorized) }
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, refetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
