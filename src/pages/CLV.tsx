import { useMemo } from 'react'
import { useClv } from '@/hooks/use-clv'
import { ClvCard } from '@/components/clv/ClvCard'
import { formatPct, hasNoVigAnchor } from '@/lib/clv'

/**
 * /clv — Line Movement / CLV tracker
 *
 * Methodology — per the seminar synthesis at .tool-data/seminar/clv-no-vig-vs-best-line:
 *
 *   No-vig CLV vs Pinnacle is the methodologically correct EV signal. PLM
 *   (best across a sharp subset, with Pinnacle's vigged price eligible) is a
 *   line-shopping efficiency metric, NOT edge — it is positively biased by
 *   max-of-N construction. The page now leads with CLV; PLM is shown as the
 *   "Line-Shopping Premium" and the gap (PLM − CLV) is exposed as the actual
 *   shopping-skill signal.
 *
 *   Bets without a Pinnacle no-vig reference (props, exotics, markets where
 *   Pinnacle was absent) are bucketed separately and NOT aggregated with
 *   main-market CLV stats.
 */

export default function CLV() {
  const { bets, snapshots, loading } = useClv()

  // ── Bucketing ──────────────────────────────────────────────────────────────
  // 1) `mainTracked` — pending bets with a Pinnacle no-vig anchor. These power
  //    the headline CLV stats and render with full ClvCards.
  // 2) `noAnchorPending` — pending bets matched to an event but lacking the
  //    no-vig reference (props, exotics). Shown separately as "directional
  //    only — no CLV reference."
  // 3) `untracked` — clv_status='unsupported'/'no_market'. Compact "untracked"
  //    list; surfaced so the user knows they exist.
  const mainTracked = useMemo(
    () =>
      bets.filter(
        (b) =>
          b.status === 'pending' &&
          b.clv_status !== 'unsupported' &&
          b.clv_status !== 'no_market' &&
          hasNoVigAnchor(b),
      ),
    [bets],
  )
  const noAnchorPending = useMemo(
    () =>
      bets.filter(
        (b) =>
          b.status === 'pending' &&
          b.clv_status !== 'unsupported' &&
          b.clv_status !== 'no_market' &&
          !hasNoVigAnchor(b),
      ),
    [bets],
  )
  const untracked = useMemo(
    () =>
      bets.filter(
        (b) =>
          b.status === 'pending' &&
          (b.clv_status === 'unsupported' || b.clv_status === 'no_market'),
      ),
    [bets],
  )

  // ── Live tracking stats — CLV as primary signal ────────────────────────────
  const live = useMemo(
    () => mainTracked.filter((b) => b.clv_status === 'tracking' && b.clv_pct != null),
    [mainTracked],
  )
  const liveBeating = live.filter((b) => (b.clv_pct ?? 0) > 0).length
  const liveBeatingPct = live.length ? liveBeating / live.length : null
  const liveAvgClv = live.length
    ? live.reduce((s, b) => s + (b.clv_pct ?? 0), 0) / live.length
    : null
  // Shopping premium = PLM − CLV. Tells you how much your line-shopping is
  // earning beyond the no-vig edge.
  const liveShopping = live.filter((b) => b.plm_pct != null && b.clv_pct != null)
  const liveAvgShoppingPremium = liveShopping.length
    ? liveShopping.reduce((s, b) => s + ((b.plm_pct ?? 0) - (b.clv_pct ?? 0)), 0) /
      liveShopping.length
    : null

  // ── Cumulative stats — closed picks (settled + locked-pending) ─────────────
  // Truth signal: beat_close (set by cron from clv_pct > 0 — no-vig based).
  const lockedAll = useMemo(() => bets.filter((b) => b.clv_status === 'locked'), [bets])
  const lockedWithClv = lockedAll.filter((b) => b.clv_pct != null && b.beat_close != null)
  const cumulativeBeat = lockedWithClv.filter((b) => b.beat_close).length
  const cumulativeTotal = lockedWithClv.length
  const cumulativeHitRate = cumulativeTotal ? cumulativeBeat / cumulativeTotal : null
  const cumulativeAvgClv = lockedWithClv.length
    ? lockedWithClv.reduce((s, b) => s + (b.clv_pct ?? 0), 0) / lockedWithClv.length
    : null
  const cumulativeShopping = lockedAll.filter((b) => b.plm_pct != null && b.clv_pct != null)
  const cumulativeAvgShoppingPremium = cumulativeShopping.length
    ? cumulativeShopping.reduce((s, b) => s + ((b.plm_pct ?? 0) - (b.clv_pct ?? 0)), 0) /
      cumulativeShopping.length
    : null

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">CLV</h1>
        <p className="text-sm text-muted-foreground">
          Closing Line Value vs the Pinnacle-anchored no-vig fair. Your locked price compared to
          the unbiased probability the sharpest market converges on — the closest thing to a true
          edge signal. Line-shopping premium (best price across the sharp subset) is shown as a
          secondary metric.
        </p>
      </div>

      {/* ── Live tracking stats (CLV is the primary lens) ───────────────────── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live · still tracking
          </h2>
          <span className="text-[11px] text-muted-foreground">
            pre-lock — line is still moving
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Currently beating no-vig"
            value={liveBeatingPct == null ? '—' : `${Math.round(liveBeatingPct * 100)}%`}
            sub={`${liveBeating}/${live.length} live picks`}
            accent={liveBeatingPct == null ? undefined : liveBeatingPct >= 0.5 ? 'pos' : 'neg'}
          />
          <Stat
            label="Avg CLV (no-vig)"
            value={liveAvgClv == null ? '—' : formatPct(liveAvgClv)}
            accent={liveAvgClv == null ? undefined : liveAvgClv >= 0 ? 'pos' : 'neg'}
          />
          <Stat
            label="Shopping premium"
            value={liveAvgShoppingPremium == null ? '—' : formatPct(liveAvgShoppingPremium)}
            sub="PLM − CLV"
            accent={
              liveAvgShoppingPremium == null
                ? undefined
                : liveAvgShoppingPremium >= 0
                  ? 'pos'
                  : 'neg'
            }
          />
          <Stat
            label="Tracking"
            value={String(mainTracked.length)}
            sub={`${live.length} with snapshot`}
          />
        </div>
      </div>

      {/* ── Cumulative — every locked pick ──────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cumulative · beat the close
          </h2>
          <span className="text-[11px] text-muted-foreground">
            no-vig CLV vs Pinnacle — the long-run edge signal
          </span>
        </div>
        <div className="rounded-lg border border-border/60 bg-card/60 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Picks beating the close
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="text-3xl font-semibold tabular-nums text-emerald-400">
                  {cumulativeBeat}
                </div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  / {cumulativeTotal}
                </div>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {cumulativeHitRate == null
                  ? '—'
                  : `${Math.round(cumulativeHitRate * 100)}% hit rate`}
              </div>
            </div>
            <Stat
              label="Avg CLV at close"
              value={cumulativeAvgClv == null ? '—' : formatPct(cumulativeAvgClv)}
              accent={cumulativeAvgClv == null ? undefined : cumulativeAvgClv >= 0 ? 'pos' : 'neg'}
            />
            <Stat
              label="Avg shopping premium"
              value={
                cumulativeAvgShoppingPremium == null
                  ? '—'
                  : formatPct(cumulativeAvgShoppingPremium)
              }
              sub="PLM − CLV"
              accent={
                cumulativeAvgShoppingPremium == null
                  ? undefined
                  : cumulativeAvgShoppingPremium >= 0
                    ? 'pos'
                    : 'neg'
              }
            />
            <Stat
              label="Locked picks"
              value={String(lockedAll.length)}
              sub="close captured"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : mainTracked.length === 0 && noAnchorPending.length === 0 && untracked.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-12 text-center text-sm text-muted-foreground">
          No pending picks right now — anything you log will show up here.
        </div>
      ) : (
        <>
          {mainTracked.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {mainTracked.map((b) => (
                <ClvCard key={b.id} bet={b} snapshots={snapshots} />
              ))}
            </div>
          )}

          {noAnchorPending.length > 0 && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Directional only · no Pinnacle reference
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  no no-vig anchor (props, exotics, thin markets) — line-shopping signal only
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/40 divide-y divide-border/60">
                {noAnchorPending.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.description}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {b.sport}
                        {b.plm_best_book && b.plm_pct != null && (
                          <>
                            {' · '}
                            <span>
                              best @ {b.plm_best_book}{' '}
                              <span className={b.plm_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                ({formatPct(b.plm_pct)})
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-500/30">
                      no CLV ref
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {untracked.length > 0 && (
            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Untracked picks
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  no CLV pipeline at all — exotic / unrecognised market shapes
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-card/40 divide-y divide-border/60">
                {untracked.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{b.description}</div>
                      <div className="text-[11px] text-muted-foreground">{b.sport}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-500/30">
                      untracked
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({
  label, value, sub, accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: 'pos' | 'neg'
}) {
  const valueClass =
    accent === 'pos' ? 'text-emerald-400' : accent === 'neg' ? 'text-red-400' : 'text-foreground'
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}
