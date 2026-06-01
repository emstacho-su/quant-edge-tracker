import { useMemo } from 'react'
import type { Bet } from '@/lib/types'
import {
  type OddsSnapshot,
  buildFairSeries,
  buildOutrightSeries,
  formatPct,
  formatOdds,
  impliedFromAmerican,
  probToAmerican,
  marketKeyForBet,
  bestAvailable,
  centsVsFair,
  verdictText,
  SHARP_BOOKS,
} from '@/lib/clv'
import { ClvLadder, type LadderEntry } from './ClvLadder'
import { ClvMovementStrip } from './ClvMovementStrip'
import { cn } from '@/lib/utils'

/**
 * ClvCard — per-bet line-movement card.
 *
 * Methodology (post-seminar): CLV vs no-vig Pinnacle is the headline signal —
 * it's the only metric with both theoretical and empirical backing as an EV
 * proxy. PLM (best-of-sharp-subset) is shown as a SECONDARY line-shopping
 * premium, never as edge. Promo-sourced PLM (DK/FD with PLM ≫ CLV) is tagged
 * so the user isn't misled by odds-boost spikes that look like signal.
 */

function marketLabel(bet: Bet): string {
  if (bet.clv_market === 'moneyline') return `${bet.clv_selection} ML`
  if (bet.clv_market === 'spread' || bet.clv_market === 'runline' || bet.clv_market === 'puckline') {
    const l = bet.clv_line ?? 0
    return `${bet.clv_selection} ${l > 0 ? '+' : ''}${l}`
  }
  if (bet.clv_market === 'total') return `${bet.clv_selection} ${bet.clv_line ?? ''}`.trim()
  return bet.clv_selection ?? bet.description
}

function countdown(commenceTime: string | null | undefined): string | null {
  if (!commenceTime) return null
  const ms = new Date(commenceTime).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return `locks in ${h}h ${String(m).padStart(2, '0')}m`
}

export function ClvCard({ bet, snapshots }: { bet: Bet; snapshots: OddsSnapshot[] }) {
  const marketKey = marketKeyForBet(bet.clv_market)
  const isOutright = bet.clv_market === 'outright'
  const selection = bet.clv_selection ?? ''
  const point =
    bet.clv_market === 'spread' || bet.clv_market === 'total' || bet.clv_market === 'runline' || bet.clv_market === 'puckline'
      ? bet.clv_line
      : null

  const eventSnaps = useMemo(
    () => snapshots.filter((s) => s.odds_event_id === bet.odds_event_id),
    [snapshots, bet.odds_event_id],
  )
  const series = useMemo(
    () => (isOutright ? buildOutrightSeries(eventSnaps, selection) : buildFairSeries(eventSnaps, selection, marketKey)),
    [eventSnaps, selection, marketKey, isOutright],
  )
  const matchup = useMemo(() => {
    const s = eventSnaps.find((x) => x.away_team && x.home_team)
    return s ? `${s.away_team} @ ${s.home_team}` : null
  }, [eventSnaps])

  // PLM "best" across the sharp subset (Pinnacle vigged is eligible). Prefer the
  // value the cron stored (locked-safe); fall back to a live computation.
  const liveBest = useMemo(
    () => bestAvailable(eventSnaps, { selection, market: marketKey, point, include: [...SHARP_BOOKS] }),
    [eventSnaps, selection, marketKey, point],
  )
  const bestAmerican = bet.plm_best_american ?? liveBest?.price ?? null
  const bestBook = bet.plm_best_book ?? liveBest?.book ?? null

  const plm = bet.plm_pct ?? null
  const clv = bet.clv_pct ?? null
  // Shopping premium = how much line-shopping earned beyond no-vig CLV.
  const shoppingPremium =
    plm != null && clv != null ? plm - clv : null

  const locked = bet.clv_status === 'locked'
  const state: 'tracking' | 'locked' = locked ? 'locked' : 'tracking'

  const youAmerican = bet.odds_american ?? null
  const entryImplied = youAmerican != null ? impliedFromAmerican(youAmerican) : null
  const fairProb = bet.closing_fair_prob ?? null
  const fairAmerican = !isOutright && fairProb != null ? probToAmerican(fairProb) : null

  // Build ladder markers (2-way markets only; outright has no fair anchor)
  const markers: LadderEntry[] = []
  if (!isOutright && youAmerican != null && entryImplied != null) {
    markers.push({ key: 'you', tone: 'you', impliedProb: entryImplied, american: youAmerican, label: 'you' })
    if (fairProb != null && fairAmerican != null && Number.isFinite(fairAmerican)) {
      markers.push({
        key: 'fair',
        tone: 'fair',
        impliedProb: fairProb,
        american: fairAmerican,
        label: locked ? 'close' : 'fair',
        sublabel: 'no-vig',
      })
    }
    if (bestAmerican != null) {
      markers.push({
        key: 'best',
        tone: 'best',
        impliedProb: impliedFromAmerican(bestAmerican),
        american: bestAmerican,
        label: 'best',
        sublabel: bestBook ?? undefined,
      })
    }
  }
  // Ladder gap label uses CLV (no-vig) — the truth signal — not PLM.
  const cents =
    youAmerican != null && fairAmerican != null && Number.isFinite(fairAmerican)
      ? centsVsFair(youAmerican, fairAmerican)
      : null
  const clvPositive = clv != null && clv >= 0
  const gapLabel =
    cents != null
      ? `${clvPositive ? (locked ? 'beat by' : 'ahead') : locked ? 'missed by' : 'behind'} ${Math.abs(cents)}¢`
      : null

  // Headline pill = CLV. Accent + colour reflect the no-vig signal.
  const pillState: 'pos' | 'neg' | 'await' =
    clv == null ? 'await' : clv >= 0 ? 'pos' : 'neg'
  const accent =
    pillState === 'pos' ? 'bg-emerald-500/50' : pillState === 'neg' ? 'bg-red-500/50' : 'bg-zinc-500/40'
  const pill =
    pillState === 'pos'
      ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
      : pillState === 'neg'
        ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30'
        : 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30'
  const pillLabel = clv == null ? 'awaiting' : `${formatPct(clv)} CLV`
  const cd = !locked ? countdown(bet.event_commence_time) : null

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/60 bg-card/60 p-3 backdrop-blur-sm">
      <div className={cn('absolute inset-y-0 left-0 w-1', accent)} aria-hidden />
      <div className="space-y-2 pl-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">{marketLabel(bet)}</span>
              <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', locked ? 'text-muted-foreground' : 'text-sky-300')}>
                <span className={cn('size-1.5 rounded-full', locked ? 'bg-zinc-500' : 'bg-sky-400 animate-pulse')} />
                {locked ? 'locked' : 'tracking'}
              </span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {matchup ?? bet.description}
              {cd && <span> · {cd}</span>}
            </div>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', pill)}>
            {pillLabel}
          </span>
        </div>

        {/* CLV verdict — the truth signal */}
        {!isOutright && youAmerican != null && fairAmerican != null && clv != null && (
          <div className="space-y-0.5">
            <div className={cn('text-[13px] font-semibold', clvPositive ? 'text-emerald-400' : 'text-red-400')}>
              {verdictText({ yourAmerican: youAmerican, fairAmerican, clvPct: clv, state })}
            </div>
            {/* PLM as secondary line — line-shopping context, not edge. */}
            {plm != null && bestAmerican != null && (
              <div className="text-[11px] text-muted-foreground">
                Best line:{' '}
                <span className={plm >= 0 ? 'text-emerald-400/90' : 'text-red-400/90'}>
                  {formatOdds(bestAmerican)}
                </span>
                {bestBook && <span className="text-foreground/60"> @ {bestBook}</span>}
                {shoppingPremium != null && (
                  <>
                    {' · '}
                    <span className="text-foreground/70">
                      shop premium {formatPct(shoppingPremium)}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {markers.length >= 2 && <ClvLadder markers={markers} worse={!clvPositive} gapLabel={gapLabel} />}

        <ClvMovementStrip
          series={series}
          entryImplied={entryImplied}
          entryAmerican={youAmerican}
          locked={locked}
          isOutright={isOutright}
          placedAt={bet.placed_at ? new Date(bet.placed_at).getTime() : undefined}
        />
      </div>
    </div>
  )
}
