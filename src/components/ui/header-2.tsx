import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Crosshair,
  BarChart3,
  Upload,
  List,
  FileText,
  Wallet,
  Sparkles,
  TrendingUp,
  ShoppingCart,
  Lock,
  LogOut,
  User,
  type LucideIcon,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { AnimatedLogo } from '@/components/ui/animated-logo'
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon'
import { useScroll } from '@/components/ui/use-scroll'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/today', label: 'Live', icon: Crosshair },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/report', label: 'Report', icon: FileText },
  { to: '/clv', label: 'CLV', icon: TrendingUp },
  { to: '/strategies', label: 'Strategies', icon: Sparkles },
  { to: '/line-shop', label: 'Line Shop', icon: ShoppingCart },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/bets', label: 'History', icon: List },
  { to: '/account', label: 'Account', icon: Wallet },
] as const

export function Header() {
  const [open, setOpen] = useState(false)
  const scrolled = useScroll(10)

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b border-transparent transition-[padding,background-color] duration-200 ease-out md:px-4 md:pt-4',
        {
          'md:pt-3': scrolled && !open,
          'bg-background/90': open,
        },
      )}
    >
      <div
        className={cn(
          'mx-auto w-full border-b border-transparent transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 ease-out md:rounded-lg md:border',
          {
            'bg-background/95 supports-[backdrop-filter]:bg-background/50 border-border backdrop-blur-lg md:shadow':
              scrolled && !open,
          },
        )}
      >
      <nav
        className={cn(
          'flex h-14 w-full items-center justify-between px-4 transition-[height,padding] duration-200 ease-out md:h-14 md:px-6',
          { 'md:h-12 md:px-4': scrolled },
        )}
      >
        <NavLink to="/" className="flex items-center" aria-label="Home">
          <AnimatedLogo />
        </NavLink>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'gap-1.5',
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
            </NavLink>
          ))}
          <AuthIndicator />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <AuthIndicator compact />
          <Button
            size="icon"
            variant="outline"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            <MenuToggleIcon open={open} className="size-5" duration={300} />
          </Button>
        </div>
      </nav>

      <div
        className={cn(
          'bg-background/95 fixed top-14 right-0 bottom-0 left-0 z-50 flex flex-col overflow-hidden border-y backdrop-blur-lg md:hidden',
          open ? 'block' : 'hidden',
        )}
      >
        <div
          data-slot={open ? 'open' : 'closed'}
          className={cn(
            'data-[slot=open]:animate-in data-[slot=open]:zoom-in-95 data-[slot=closed]:animate-out data-[slot=closed]:zoom-out-95 ease-out',
            'flex h-full w-full flex-col gap-y-1 p-4',
          )}
        >
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  buttonVariants({ variant: 'ghost' }),
                  'h-11 justify-start gap-3 px-3 text-base',
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
      </div>
    </header>
  )
}

function AuthIndicator({ compact = false }: { compact?: boolean }) {
  const { authenticated, user, promptLogin, logout, loading } = useAuth()

  if (loading) return null

  if (!authenticated) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={promptLogin}
        className="gap-1.5"
        title="Sign in to manage data"
      >
        <Lock className="size-3.5" />
        {!compact && <span>Sign in</span>}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      {!compact && (
        <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <User className="size-3.5" />
          {user ?? 'Signed in'}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={logout}
        className="gap-1.5"
        title="Sign out"
      >
        <LogOut className="size-3.5" />
        {!compact && <span>Sign out</span>}
      </Button>
    </div>
  )
}
