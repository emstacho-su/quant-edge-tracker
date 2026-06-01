/**
 * ParlaysCard (05-03 W3.3)
 *
 * Renders parlay suggestions from output_summary.parlays.
 * Empty state shows explicit "None" per SPEC §8.3 row 2.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OutputSummaryParlay } from '@/types/strategies'
import { fmtAmericanOdds } from './PicksCard'

export function ParlaysCard({ parlays }: { parlays: OutputSummaryParlay[] }) {
  if (parlays.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Parlays</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">None</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-base">Parlays</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Legs</th>
                <th className="py-1.5 pr-3 font-medium">Combined Odds</th>
                <th className="py-1.5 pr-3 font-medium">Stake</th>
                <th className="py-1.5 font-medium">Edge</th>
              </tr>
            </thead>
            <tbody>
              {parlays.map((parlay, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1.5 pr-3">{parlay.legs.join(' + ')}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmtAmericanOdds(parlay.combined_odds)}</td>
                  <td className="py-1.5 pr-3">{parlay.stake_u}u</td>
                  <td className="py-1.5 text-emerald-400">+{parlay.edge_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
