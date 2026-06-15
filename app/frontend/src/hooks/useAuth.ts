import { signIn as apiSignIn, signOut as apiSignOut } from '../lib/auth'
import { useAuthContext } from '../contexts/AuthContext'

export function useAuth() {
  const { user, isLoading, refetch } = useAuthContext()

  async function signIn(email: string, password: string): Promise<void> {
    await apiSignIn(email, password)
    await refetch()
  }

  async function signOut(): Promise<void> {
    await apiSignOut()
    await refetch()
  }

  return { user, isLoading, signIn, signOut, refetch }
}
