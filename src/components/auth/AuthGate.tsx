import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface AuthGateProps {
  children: ReactNode
  /** Override the default heading shown when sign-in is required. */
  title?: string
  /** Override the default description. */
  description?: string
}

/**
 * Page-level gate. Renders children only when authenticated; otherwise shows
 * a friendly "sign in to continue" card with a button that opens the login
 * dialog. While the initial /api/auth/me request is in flight, shows a small
 * loading indicator (avoids a flash of locked content for already-signed-in users).
 */
export function AuthGate({ children, title, description }: AuthGateProps) {
  const { loading, authenticated, promptLogin } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Checking session...
      </div>
    )
  }

  if (authenticated) {
    return <>{children}</>
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <Card className="glass-card" data-glow="rgba(125,211,252,1)">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="rounded-full border border-border/60 bg-background/40 p-3">
            <Lock className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              {title ?? 'Sign in required'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {description ??
                'This page can modify your data. Sign in to continue.'}
            </p>
          </div>
          <Button onClick={promptLogin}>Sign in</Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Inline gate for individual write controls (Settle, Edit, Delete). Renders
 * children when authenticated; otherwise renders a small lock chip that opens
 * the login dialog on click. Use this when you want the surrounding read-only
 * content to remain visible.
 */
export function AuthActions({ children }: { children: ReactNode }) {
  const { authenticated, promptLogin } = useAuth()
  if (authenticated) return <>{children}</>
  return (
    <button
      type="button"
      onClick={promptLogin}
      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      title="Sign in to edit"
    >
      <Lock className="size-3" /> Sign in
    </button>
  )
}
