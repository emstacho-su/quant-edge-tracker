/* eslint-disable react-refresh/only-export-components */
// AuthProvider component and useAuth hook are co-located by design — they
// share the same private context. Splitting them would just relocate the
// coupling without removing it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface AuthState {
  loading: boolean
  authenticated: boolean
  user: string | null
  /** Last error message from login/logout/refresh, if any. */
  error: string | null
}

interface AuthApi extends AuthState {
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  /** Show the login dialog from anywhere. */
  promptLogin: () => void
  /** Internal — used by the LoginDialog component. */
  _dialogOpen: boolean
  _setDialogOpen: (open: boolean) => void
}

const AuthContext = createContext<AuthApi | null>(null)

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    user: null,
    error: null,
  })
  const [dialogOpen, setDialogOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' })
      if (!r.ok) {
        setState({ loading: false, authenticated: false, user: null, error: null })
        return
      }
      const data = (await r.json()) as { authenticated: boolean; user?: string }
      setState({
        loading: false,
        authenticated: !!data.authenticated,
        user: data.user ?? null,
        error: null,
      })
    } catch {
      // Network or non-JSON — likely running `vite` without `vercel dev`. Treat as unauthed.
      setState({ loading: false, authenticated: false, user: null, error: null })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // On-focus CLV cron trigger — when the tab regains visibility (e.g. waking
  // the laptop after sleep) and the user is signed in, kick a fresh server-side
  // line-movement run so the next scheduled */5 tick isn't the soonest fresh
  // data. The endpoint has its own 60s server cooldown; this 90s client throttle
  // suppresses chatter from quick tab flicks. The DB-side refetch that actually
  // re-renders the sparklines lives in use-clv (also on visibilitychange).
  useEffect(() => {
    if (!state.authenticated) return
    let lastFiredAt = 0
    const THROTTLE_MS = 90_000
    const maybeFire = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastFiredAt < THROTTLE_MS) return
      lastFiredAt = now
      void fetch('/api/clv/refresh', { method: 'POST', credentials: 'same-origin' }).catch(() => {
        // best-effort; the next scheduled cron will catch up
      })
    }
    document.addEventListener('visibilitychange', maybeFire)
    window.addEventListener('focus', maybeFire)
    return () => {
      document.removeEventListener('visibilitychange', maybeFire)
      window.removeEventListener('focus', maybeFire)
    }
  }, [state.authenticated])

  const login = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      setState((s) => ({ ...s, error: null }))
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ username, password }),
        })
        if (!r.ok) {
          const msg = (await r.json().catch(() => null))?.error ?? 'Login failed'
          setState((s) => ({ ...s, error: msg }))
          return false
        }
        const data = (await r.json()) as { user?: string }
        setState({
          loading: false,
          authenticated: true,
          user: data.user ?? username,
          error: null,
        })
        setDialogOpen(false)
        return true
      } catch (err) {
        setState((s) => ({
          ...s,
          error:
            err instanceof Error
              ? `Login request failed: ${err.message}`
              : 'Login request failed',
        }))
        return false
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      })
    } catch {
      // ignore — we still treat as logged out locally
    }
    setState({ loading: false, authenticated: false, user: null, error: null })
  }, [])

  const api = useMemo<AuthApi>(
    () => ({
      ...state,
      login,
      logout,
      refresh,
      promptLogin: () => setDialogOpen(true),
      _dialogOpen: dialogOpen,
      _setDialogOpen: setDialogOpen,
    }),
    [state, login, logout, refresh, dialogOpen],
  )

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
