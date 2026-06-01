/**
 * CalibrationTab orchestrator (05-04 W4.4)
 *
 * 2x2 grid layout on desktop, single column on mobile.
 * Handles: loading skeleton, error state, empty-state guard, partial data.
 */

import { useCalibration } from '@/hooks/use-calibration'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CalibrationByBucketChart } from '@/components/strategies/CalibrationByBucketChart'
import { CalibrationByMarketChart } from '@/components/strategies/CalibrationByMarketChart'
import { ConfidenceVsWinRateChart } from '@/components/strategies/ConfidenceVsWinRateChart'
import { RollingPnlChart } from '@/components/strategies/RollingPnlChart'

interface Props {
  strategyId: string
}

/** Simple relative-time formatter — avoids adding date-fns as a new dep. */
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function CardSkeleton() {
  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="h-[260px] rounded bg-muted animate-pulse" />
      </CardContent>
    </Card>
  )
}

export function CalibrationTab({ strategyId }: Props) {
  const { data, loading, error } = useCalibration(strategyId)

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (error) {
    console.error('[CalibrationTab]', error)
    return (
      <Card className="glass-card md:col-span-2">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-red-400">
            Unable to load calibration. Refresh in a moment.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  const hasAnyData =
    data.byBucket.length > 0 ||
    data.byMarket.length > 0 ||
    data.byConfidence.length > 0

  if (!hasAnyData) {
    return (
      <Card className="glass-card">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Insufficient data — needs 1+ day of settled outcomes. The daily
            settler runs at 10am ET. If today is the first day after enabling
            settler, check back tomorrow morning.
          </p>
        </CardContent>
      </Card>
    )
  }

  const lastSettledLabel = data.lastSettledAt
    ? relativeTime(new Date(data.lastSettledAt))
    : null

  return (
    <div className="space-y-4">
      {lastSettledLabel && (
        <p className="text-xs text-muted-foreground">
          Last settled: <span className="text-foreground">{lastSettledLabel}</span>
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm">Predicted vs Realized Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <CalibrationByBucketChart data={data.byBucket} />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm">ROI by Market</CardTitle>
          </CardHeader>
          <CardContent>
            <CalibrationByMarketChart data={data.byMarket} />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm">Confidence vs Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfidenceVsWinRateChart data={data.byConfidence} />
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm">Rolling Weekly P&L (units)</CardTitle>
          </CardHeader>
          <CardContent>
            <RollingPnlChart data={data.rollingPnl} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
