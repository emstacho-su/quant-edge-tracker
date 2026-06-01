/**
 * AddBetModal — auth-gated prefilled bet-entry dialog for the Line Shopper.
 *
 * Prefills from the selected best-price row + market context:
 *   - sport, description, odds_american, entry_book (read-only)
 *   - user enters stake; to_win auto-computes via computeToWin
 *
 * On confirm → useBets().insertBets([prefill]) — NEVER supabase.from('bets').insert.
 * Records: line_shop_used=true, entry_book, no_vig_at_entry, market_id (LOG-01/02).
 * Currency always via USD from @/lib/demo-mode (D-09).
 *
 * Threat mitigations:
 *   T-09-16: insertBets only — no direct supabase insert
 *   T-09-17: modal only accessible when authenticated (CTA gated by <AuthActions> in PriceTable)
 *   T-09-18: computeToWin from use-bets.ts — no hand-rolled formula
 *   T-09-19: USD.format for all currency display
 */

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useBets, computeToWin } from '@/hooks/use-bets'
import { USD } from '@/lib/demo-mode'
import { formatOdds } from '@/lib/clv'
import type { BookPriceSnapshot, MarketAnalysis } from '@/lib/line-shop-types'

// ─── Display helpers (mirrors PriceTable.tsx — kept local to avoid shared util) ─

const BOOK_DISPLAY: Record<string, string> = {
  pinnacle: 'Pinnacle',
  bovada: 'Bovada',
  betus: 'BetUS',
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  williamhill_us: 'Caesars',
  kalshi: 'Kalshi',
  '7stacks': '7Stacks',
  odds_api: 'Odds API',
}

function bookLabel(book: string): string {
  return BOOK_DISPLAY[book] ?? book
}

function formatSide(side: string): string {
  const MAP: Record<string, string> = {
    home: 'Home', away: 'Away', over: 'Over', under: 'Under', yes: 'Yes', no: 'No',
  }
  return MAP[side] ?? side
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddBetModalProps {
  snap: BookPriceSnapshot
  analysis: MarketAnalysis
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── AddBetModal ──────────────────────────────────────────────────────────────

export function AddBetModal({ snap, analysis, open, onOpenChange }: AddBetModalProps) {
  const { insertBets } = useBets()

  // ── Prefilled (read-only) display values ───────────────────────────────────
  const sport = analysis.market.sport
  const eventName = analysis.market.eventName
  const side = formatSide(snap.side)
  const book = bookLabel(snap.book)
  const description = `${eventName} — ${side} @ ${book}`
  const oddsAmerican = snap.priceAmerican
  const noVigAtEntry = analysis.noVigConsensus[snap.side] ?? null
  const marketId = analysis.market.id

  // ── Form state ─────────────────────────────────────────────────────────────
  const [stakeInput, setStakeInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Reset form state when modal opens with a new selection
  useEffect(() => {
    if (open) {
      setStakeInput('')
      setError(null)
      setSuccess(false)
      setSubmitting(false)
    }
  }, [open, snap.book, snap.side])

  // ── Derived: auto-computed to_win ──────────────────────────────────────────
  const stakeNum = parseFloat(stakeInput)
  const toWin = !isNaN(stakeNum) && stakeNum > 0
    ? computeToWin(stakeNum, oddsAmerican)
    : null

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!stakeNum || stakeNum <= 0) {
      setError('Please enter a valid stake amount.')
      return
    }
    if (toWin === null) {
      setError('Unable to compute to_win — check the odds.')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      await insertBets([{
        sport,
        description,
        odds_american: oddsAmerican,
        bet_type: 'single',
        legs: [],
        is_freeplay: false,
        stake: stakeNum,
        to_win: toWin,
        market_id: marketId,
        line_shop_used: true,
        entry_book: snap.book,
        no_vig_at_entry: noVigAtEntry,
      }])
      setSuccess(true)
      // Auto-close after a brief confirmation moment
      setTimeout(() => onOpenChange(false), 900)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add bet. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Bet Log</DialogTitle>
          <DialogDescription>
            Log this line-shopped pick. Confirms via your bankroll ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Read-only prefilled fields */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
              Description
            </Label>
            <p className="text-sm font-medium leading-snug">{description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Sport
              </Label>
              <p className="text-sm font-medium capitalize">{sport}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Book
              </Label>
              <p className="text-sm font-medium">{book}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Odds (American)
              </Label>
              <p className="text-sm font-mono font-semibold">{formatOdds(oddsAmerican)}</p>
            </div>
            {noVigAtEntry !== null && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  No-Vig Prob
                </Label>
                <p className="text-sm font-mono">{(noVigAtEntry * 100).toFixed(1)}%</p>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border/60" />

          {/* User-entered stake */}
          <div className="space-y-2">
            <Label htmlFor="add-bet-stake" className="text-sm font-medium">
              Stake ($)
            </Label>
            <Input
              id="add-bet-stake"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="e.g. 25.00"
              value={stakeInput}
              onChange={(e) => {
                setStakeInput(e.target.value)
                setError(null)
              }}
              disabled={submitting || success}
              className="font-mono"
            />
          </div>

          {/* Auto-computed to_win (read-only) */}
          <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/40 px-3 py-2">
            <span className="text-xs text-muted-foreground">To win</span>
            <span className="text-sm font-mono font-semibold">
              {toWin !== null ? USD.format(toWin) : '—'}
            </span>
          </div>

          {/* Error / success feedback */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          {success && (
            <p className="text-sm text-green-500 font-medium">Bet added successfully!</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || success || !stakeInput}
          >
            {submitting ? 'Adding...' : success ? 'Added!' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
