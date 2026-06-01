/**
 * PicksCard (05-03 W3.2)
 *
 * Renders the final card picks table from output_summary.final_card.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AuditScoreChip } from './AuditScoreChip'
import type { OutputSummaryFinalCard, OutputSummaryAuditSeminar } from '@/types/strategies'

/** Format American odds with +/- prefix. Pure function - exported for testing. */
export function fmtAmericanOdds(line: number): string {
  return line >= 0 ? `+${line}` : `${line}`
}

/**
 * Build the display rows for the picks table.
 * Pure function - exported for unit testing.
 */
export function buildPicksRows(
  finalCard: OutputSummaryFinalCard[],
  auditSeminars: OutputSummaryAuditSeminar[],
): Array<{
  pick: OutputSummaryFinalCard
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null
}> {
  return finalCard.map((pick) => {
    const seminar = auditSeminars.find(
      (s) => s.play.includes(pick.market) || s.play.includes(pick.game),
    )
    return {
      pick,
      confidence: seminar ? seminar.confidence as 'HIGH' | 'MEDIUM' | 'LOW' : null,
    }
  })
}

export function PicksCard({
  finalCard,
  auditSeminars = [],
}: {
  finalCard: OutputSummaryFinalCard[]
  auditSeminars?: OutputSummaryAuditSeminar[]
}) {
  if (finalCard.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">Final Card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No picks on this run.</p>
        </CardContent>
      </Card>
    )
  }

  const rows = buildPicksRows(finalCard, auditSeminars)
  const totalStake = finalCard.reduce((sum, p) => sum + (p.stake_u ?? 0), 0)

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="text-base">Final Card</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border/40 text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">#</th>
                <th className="py-1.5 pr-3 font-medium">Game</th>
                <th className="py-1.5 pr-3 font-medium">Market</th>
                <th className="py-1.5 pr-3 font-medium">Line</th>
                <th className="py-1.5 pr-3 font-medium">Stake</th>
                <th className="py-1.5 pr-3 font-medium">Stack</th>
                <th className="py-1.5 pr-3 font-medium">Edge</th>
                <th className="py-1.5 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ pick, confidence }, i) => (
                <tr key={i} className="border-b border-border/20">
                  <td className="py-1.5 pr-3 text-muted-foreground">{pick.n}</td>
                  <td className="py-1.5 pr-3 font-mono">{pick.game}</td>
                  <td className="py-1.5 pr-3">{pick.market}</td>
                  <td className="py-1.5 pr-3 font-mono">{fmtAmericanOdds(pick.line)}</td>
                  <td className="py-1.5 pr-3">{pick.stake_u}u</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{pick.stack}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-emerald-400">+{pick.edge_pct.toFixed(1)}%</span>
                      <div className="h-1 rounded-full bg-emerald-500/30 overflow-hidden w-12">
                        <div
                          className="h-1 rounded-full bg-emerald-500"
                          style={{ width: `${Math.min(pick.edge_pct * 5, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-1.5">
                    {confidence ? (
                      <AuditScoreChip score={confidence === 'HIGH' ? 92 : confidence === 'MEDIUM' ? 75 : 55} variant="small" />
                    ) : (
                      <span className="text-muted-foreground">n/a</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/40">
                <td colSpan={4} className="py-1.5 text-muted-foreground">Total</td>
                <td className="py-1.5 font-semibold">{totalStake}u</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
