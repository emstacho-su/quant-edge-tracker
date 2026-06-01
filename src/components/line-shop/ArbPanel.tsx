/**
 * ArbPanel — Arb Scanner display component.
 *
 * UI-SPEC (ArbPanel.tsx):
 *   - One card/row per arb_opportunities row: both legs (book + side + American price + point),
 *     sizeArb stake split for a configurable total stake (default $100), guaranteed return %,
 *     detection time, ageMinutes, and a stale warning when isStale (ARB-02/03/04, D-07)
 *   - ARB_STALE_MINUTES = 10: distinct "Verify before betting — prices may have moved" warning
 *   - Configurable minimum-return threshold filter control (ARB-04)
 *   - DISPLAY-ONLY: reads from useLineShop arb slice; NEVER calls /api/line-shop/prices
 *   - Currency via USD from @/lib/demo-mode (Pitfall 6, D-09)
 *   - Empty state: "No arbs detected right now."
 *
 * Correctness:
 *   - sizeArb formula already applied in useLineShop; stakeA/stakeB consumed here
 *   - formatOdds from @/lib/clv — no new odds math
 *   - ARB_STALE_MINUTES imported from hook (single source of truth)
 */

import { useState } from 'react'
import { AlertTriangle, Clock, RefreshCw, Loader2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { USD } from '@/lib/demo-mode'
import { formatOdds, americanToDecimal } from '@/lib/clv'
import { kalshiEffectiveDecimalOdds } from '@/lib/kalshi-fee'
import { ARB_STALE_MINUTES, ARB_MIN_RETURN_DEFAULT, useLineShop } from '@/hooks/use-line-shop'
import type { ArbRow } from '@/hooks/use-line-shop'
import { KNOWN_LINE_SHOP_BOOKS } from '@/lib/line-shop-types'
import { AuthActions } from '@/components/auth/AuthGate'
import { UploadSlateModal } from './UploadSlateModal'
import { BookFilterChips } from './BookFilterChips'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArbPanelProps {
  rows: ArbRow[]
  loading: boolean
  error: string | null
  totalStake: number
  onTotalStakeChange: (stake: number) => void
  minReturnPct: number
  onMinReturnPctChange: (pct: number) => void
  onRefresh: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAge(minutes: number): string {
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }) + ' ET'
  } catch {
    return iso
  }
}

// ─── ArbLegRow ───────────────────────────────────────────────────────────────

function ArbLegRow({
  label,
  book,
  side,
  price,
  point,
  stake,
  sourceConfidence,
  uploadedAt,
  kalshiFee,
}: {
  label: string
  book: string
  side: string
  price: number
  point: number | null
  stake: number
  /** Per-leg source provenance (21-08, D-09). Null for api-sourced legs. */
  sourceConfidence: 'api' | 'aggregator' | 'scraped' | 'manual' | null
  /** ISO timestamp from book_prices.fetched_at when sourceConfidence='manual'. */
  uploadedAt: string | null
  /** Stake-size-specific Kalshi taker fee in dollars; 0 for non-Kalshi legs. */
  kalshiFee: number
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs font-medium text-muted-foreground uppercase">{label}</span>
        <Badge variant="outline" className="shrink-0 text-xs capitalize">
          {book}
        </Badge>
        {/* Manual provenance badge (D-09 / Pitfall 5: HTML title attribute, not Tooltip primitive) */}
        {sourceConfidence === 'manual' && (
          <Badge
            variant="secondary"
            className="shrink-0 text-[10px] uppercase tracking-wide"
            title={
              uploadedAt
                ? `Uploaded ${new Date(uploadedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`
                : 'Uploaded slate'
            }
          >
            manual
          </Badge>
        )}
        <span className="truncate font-medium capitalize">{side}</span>
        {point != null && (
          <span className="text-muted-foreground">{point > 0 ? `+${point}` : point}</span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-right">
        {book === 'kalshi' ? (
          <span
            className="font-mono font-semibold text-emerald-500"
            title="Kalshi taker fee applied — Phase 21 D-13"
          >
            {kalshiEffectiveDecimalOdds(americanToDecimal(price)).toFixed(3)}
          </span>
        ) : (
          <span className="font-mono font-semibold text-emerald-500">{formatOdds(price)}</span>
        )}
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-muted-foreground">{USD.format(stake)}</span>
          {book === 'kalshi' && kalshiFee > 0 && (
            <span
              className="text-[10px] text-amber-600 dark:text-amber-400"
              title="Kalshi taker fee at this stake — integer-cent ceiling × contract count"
            >
              + {USD.format(kalshiFee)} fee
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ArbCard ─────────────────────────────────────────────────────────────────

function ArbCard({ row, totalStake }: { row: ArbRow; totalStake: number }) {
  // Subtract the dollar Kalshi taker fee at this stake from the guaranteed
  // return — total_return_pct uses the un-rounded P_eff form (per D-13), so the
  // integer-cent rounding on contracts is a small additional cost the user pays.
  const grossReturn = totalStake * (row.total_return_pct / 100)
  const netReturn = grossReturn - row.kalshi_fee_total

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        row.isStale
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border/60 bg-card/60'
      }`}
    >
      {/* Header row: event + return% */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">
            {row.markets?.event_name ?? 'Unknown event'}
          </p>
          <p className="text-xs text-muted-foreground capitalize">
            {row.markets?.sport ?? ''} &middot; {row.markets?.market_type ?? ''}
            {row.markets?.market_param != null ? ` ${row.markets.market_param}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-bold text-emerald-500">
            +{row.total_return_pct.toFixed(2)}%
          </p>
          <p className="text-xs text-muted-foreground">guaranteed return</p>
        </div>
      </div>

      {/* Stale warning (ARB-03, T-09-13) */}
      {row.isStale && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            Verify before betting — prices may have moved (detected {formatAge(row.ageMinutes)})
          </span>
        </div>
      )}

      {/* Both legs */}
      <div className="space-y-1.5">
        <ArbLegRow
          label="Leg A"
          book={row.side_a_book}
          side={row.side_a}
          price={row.side_a_price}
          point={null}
          stake={row.stakeA}
          sourceConfidence={row.side_a_source_confidence}
          uploadedAt={row.side_a_uploaded_at}
          kalshiFee={row.side_a_kalshi_fee}
        />
        <ArbLegRow
          label="Leg B"
          book={row.side_b_book}
          side={row.side_b}
          price={row.side_b_price}
          point={null}
          stake={row.stakeB}
          sourceConfidence={row.side_b_source_confidence}
          uploadedAt={row.side_b_uploaded_at}
          kalshiFee={row.side_b_kalshi_fee}
        />
      </div>

      {/* Stake summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 pt-2">
        <div className="flex items-center gap-1">
          <Clock className="size-3" />
          <span>Detected {formatTime(row.detected_at)}</span>
          {!row.isStale && (
            <span className="ml-1 text-muted-foreground/70">({formatAge(row.ageMinutes)})</span>
          )}
        </div>
        <div>
          Guaranteed return:{' '}
          <span className="font-semibold text-emerald-500">{USD.format(netReturn)}</span>
          {row.kalshi_fee_total > 0 && (
            <span
              className="ml-1 text-[10px] text-muted-foreground"
              title={`Gross ${USD.format(grossReturn)} − Kalshi fee ${USD.format(row.kalshi_fee_total)}`}
            >
              (gross {USD.format(grossReturn)})
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ArbPanel ─────────────────────────────────────────────────────────────────

export function ArbPanel({
  rows,
  loading,
  error,
  totalStake,
  onTotalStakeChange,
  minReturnPct,
  onMinReturnPctChange,
  onRefresh,
}: ArbPanelProps) {
  const [stakeInput, setStakeInput] = useState(String(totalStake))
  const [minReturnInput, setMinReturnInput] = useState(String(minReturnPct))
  const [uploadOpen, setUploadOpen] = useState(false)
  const hook = useLineShop()
  // Defensive defaults so partial mocks in tests don't blow up on destructure.
  const allArbBooks = hook.allArbBooks ?? []
  const knownArbBooks = hook.knownArbBooks ?? []
  const enabledBooks = hook.enabledBooks ?? []
  const DEFAULT_ENABLED_BOOKS = hook.DEFAULT_ENABLED_BOOKS ?? []

  // Union of books worth showing as toggleable chips:
  //   (a) the canonical KNOWN_LINE_SHOP_BOOKS set — always present so
  //       offshore-upload books (7stacks/betvegas23/bovada/betus) and the
  //       major US books stay toggleable even before any arb appears at them
  //       AND even after the user has toggled them off (without this, a
  //       toggled-off book that has no recent arb history disappears
  //       from the chip row entirely)
  //   (b) any book in a currently-displayed arb (allArbBooks)
  //   (c) any book that produced an arb in the last 14 days (knownArbBooks)
  //   (d) the default-enabled set
  //   (e) any book the user has explicitly enabled (enabledBooks)
  // Sorted alphabetically.
  const candidateBooks = [
    ...new Set([
      ...KNOWN_LINE_SHOP_BOOKS,
      ...allArbBooks,
      ...knownArbBooks,
      ...DEFAULT_ENABLED_BOOKS,
      ...enabledBooks,
    ]),
  ].sort()

  function handleStakeBlur() {
    const val = parseFloat(stakeInput)
    if (!isNaN(val) && val > 0) {
      onTotalStakeChange(val)
    } else {
      setStakeInput(String(totalStake))
    }
  }

  function handleMinReturnBlur() {
    const val = parseFloat(minReturnInput)
    if (!isNaN(val) && val >= 0) {
      onMinReturnPctChange(val)
    } else {
      setMinReturnInput(String(minReturnPct))
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls row */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="arb-total-stake" className="text-xs text-muted-foreground">
            Total stake ($)
          </Label>
          <Input
            id="arb-total-stake"
            type="number"
            min="1"
            step="1"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            onBlur={handleStakeBlur}
            className="h-8 w-28 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="arb-min-return" className="text-xs text-muted-foreground">
            Min return % (default {ARB_MIN_RETURN_DEFAULT}%)
          </Label>
          <Input
            id="arb-min-return"
            type="number"
            min="0"
            step="0.1"
            value={minReturnInput}
            onChange={(e) => setMinReturnInput(e.target.value)}
            onBlur={handleMinReturnBlur}
            className="h-8 w-28 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="h-8 gap-1.5"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {/* Upload offshore slate — auth-gated (D-12, T-21-08-01) */}
        <AuthActions>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUploadOpen(true)}
            className="h-8 gap-1.5"
          >
            <Upload className="size-3.5" />
            Upload offshore slate
          </Button>
        </AuthActions>
        <p className="text-xs text-muted-foreground self-end">
          Staleness warning after {ARB_STALE_MINUTES} min
        </p>
      </div>

      {/* Book filter chips (D-03) — full set of books seen recently in any arb
          (last 14 days), the books in currently-displayed arbs, the defaults,
          and any user-enabled books. Always selectable so users can pre-filter
          before fresh arbs land. */}
      {candidateBooks.length > 0 && (
        <BookFilterChips candidateBooks={candidateBooks} />
      )}

      {/* Upload slate modal — mounted here, opened via button above (D-12) */}
      <UploadSlateModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={() => {
          setUploadOpen(false)
          onRefresh()
        }}
      />

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Loading arb opportunities…</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Arb rows */}
      {!loading && !error && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <ArbCard key={row.id} row={row} totalStake={totalStake} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 py-12 text-center">
          <p className="text-sm font-medium text-muted-foreground">No arbs detected right now.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            The scanner checks for arbitrage opportunities every few minutes. Try lowering the
            minimum return threshold or refreshing.
          </p>
        </div>
      )}
    </div>
  )
}
