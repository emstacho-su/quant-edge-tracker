import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RunRow } from '@/components/strategies/RunRow'
import { RateLimitBanner } from '@/components/strategies/RateLimitBanner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getStrategy, listRuns } from '@/lib/supabase-strategies'
import type { Strategy, StrategyRun } from '@/types/strategies'

// Lazy-load CalibrationTab — Recharts is heavy; keep initial bundle slim
const CalibrationTab = lazy(() =>
  import('./CalibrationTab').then((m) => ({ default: m.CalibrationTab })),
)

// Lazy-load OptimizationsTab
const OptimizationsTab = lazy(() =>
  import('./OptimizationsTab').then((m) => ({ default: m.OptimizationsTab })),
)

// ---------------------------------------------------------------------------
// Tab constants
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'runs' | 'calibration' | 'optimizations'

const VALID_TABS: TabId[] = ['overview', 'runs', 'calibration', 'optimizations']

function isValidTab(s: string | null): s is TabId {
  return VALID_TABS.includes(s as TabId)
}

// ---------------------------------------------------------------------------
// Skeleton for CalibrationTab Suspense fallback
// ---------------------------------------------------------------------------

function CalibrationSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="glass-card">
          <CardHeader>
            <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="h-[260px] rounded bg-muted animate-pulse" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StrategyDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()

  const [strategy, setStrategy] = useState<Strategy | null>(null)
  const [runs, setRuns] = useState<StrategyRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ?tab= query param — default to 'overview'
  const rawTab = searchParams.get('tab')
  const activeTab: TabId = isValidTab(rawTab) ? rawTab : 'overview'

  function handleTabChange(value: string | number | null) {
    const v = String(value ?? 'overview')
    if (isValidTab(v)) {
      setSearchParams({ tab: v }, { replace: true })
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    Promise.all([getStrategy(id), listRuns(id, 20)])
      .then(([s, rs]) => {
        if (cancelled) return
        if (!s) {
          setError('Strategy not found.')
          return
        }
        setStrategy(s)
        setRuns(rs)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (error || !strategy) {
    return <p className="text-sm text-red-400">{error ?? 'Not found'}</p>
  }

  return (
    <div className="space-y-6">
      <RateLimitBanner />
      {/* Back to strategies list */}
      <Link
        to="/strategies"
        className={`${buttonVariants({ variant: 'outline', size: 'sm' })} -ml-2`}
      >
        <ArrowLeft className="mr-1.5 size-4" /> Strategies
      </Link>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{strategy.name}</h1>
          <p className="text-xs font-mono text-muted-foreground">{strategy.slug}</p>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mt-1">
            {strategy.sport} · {strategy.status}
            {strategy.current_git_sha && (
              <>
                {' · '}
                <span className="font-mono normal-case">
                  {strategy.current_git_sha.slice(0, 7)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Tab shell */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="calibration">Calibration</TabsTrigger>
          <TabsTrigger value="optimizations">
            Optimizations
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="mt-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-foreground/20 bg-foreground/5 p-4 cursor-pointer hover:bg-foreground/10 transition-colors">
                {strategy.overview_md ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {strategy.overview_md}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {strategy.description || 'No description.'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Runs tab */}
        <TabsContent value="runs" className="mt-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Triggered</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <RunRow key={run.id} strategyId={strategy.id} run={run} />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calibration tab — lazy loaded */}
        <TabsContent value="calibration" className="mt-4">
          {id && (
            <Suspense fallback={<CalibrationSkeleton />}>
              <CalibrationTab strategyId={id} />
            </Suspense>
          )}
        </TabsContent>

        {/* Optimizations tab — weekly optimizer suggestions */}
        <TabsContent value="optimizations" className="mt-4">
          {id && (
            <Suspense fallback={<CalibrationSkeleton />}>
              <OptimizationsTab strategy_id={id} />
            </Suspense>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
