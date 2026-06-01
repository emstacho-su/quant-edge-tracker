import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AuthActions } from '@/components/auth/AuthGate'
import { RunStatusBadge } from '@/components/strategies/RunStatusBadge'
import { RateLimitBanner } from '@/components/strategies/RateLimitBanner'
import { StrategyRowPanel } from '@/components/strategies/StrategyRowPanel'
import { listStrategies } from '@/lib/supabase-strategies'
import type { StrategyListItem } from '@/types/strategies'

const COL_COUNT = 7

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function StrategiesList() {
  const [strategies, setStrategies] = useState<StrategyListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    listStrategies()
      .then((rows) => {
        if (!cancelled) setStrategies(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
    return () => {
      cancelled = true
    }
  }, [])

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <RateLimitBanner />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-sm text-muted-foreground">
            Codified betting strategies — click a row for record, today's picks, and to run a slate.
          </p>
        </div>
        <AuthActions>
          <Link to="/strategies/new" className={buttonVariants()}>
            <Plus className="mr-1.5 size-4" /> New
          </Link>
        </AuthActions>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">All strategies</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : strategies === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : strategies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No strategies yet. Click <span className="font-medium">New</span> to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategies.map((s) => {
                  const open = openIds.has(s.id)
                  return (
                    <Fragment key={s.id}>
                      <TableRow
                        onClick={() => toggle(s.id)}
                        aria-expanded={open}
                        className="cursor-pointer"
                      >
                        <TableCell className="text-muted-foreground">
                          {open ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {s.slug}
                        </TableCell>
                        <TableCell className="text-xs uppercase tracking-wide">
                          {s.sport}
                        </TableCell>
                        <TableCell className="text-xs capitalize">{s.status}</TableCell>
                        <TableCell>
                          {s.last_run ? (
                            <div className="flex items-center gap-2">
                              <RunStatusBadge status={s.last_run.status} />
                              <span className="text-xs text-muted-foreground">
                                {fmtDate(s.last_run.completed_at)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">never</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(s.updated_at)}
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COL_COUNT} className="p-0">
                            <div className="px-2 py-2">
                              <StrategyRowPanel strategy={s} />
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
