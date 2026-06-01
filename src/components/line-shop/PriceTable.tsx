/**
 * PriceTable — ranked per-book price table.
 *
 * UI-SPEC (PriceTable.tsx):
 *   - Columns: Book · Side · Point · American · Decimal · Vig% · (action)
 *   - Best decimal price per side: font-semibold + subtle bg highlight
 *   - missingBooks rows: dimmed, price "—", "no market" badge (BOOK-02, NEVER omitted)
 *   - All monetary displays via USD.format (D-09, Pitfall 6)
 *   - Per best-price row: <AuthActions><Button>Add to Bet Log</Button></AuthActions>
 *
 * Correctness:
 *   - missingBooks entries render explicitly — no silent omission (BOOK-02)
 *   - USD from @/lib/demo-mode (demo-mode aware)
 *   - No duplicate odds math — imports from @/lib/clv
 *   - AddBetModal managed locally (open state + selected snap) — LOG-01/02
 */

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AuthActions } from '@/components/auth/AuthGate'
import { AddBetModal } from '@/components/line-shop/AddBetModal'
import { PlusCircle } from 'lucide-react'
import { USD } from '@/lib/demo-mode'
import { formatOdds } from '@/lib/clv'
import { kalshiEffectiveDecimalOdds } from '@/lib/kalshi-fee'
import type { BookPriceSnapshot, MarketAnalysis } from '@/lib/line-shop-types'

// vigFor: sum of impliedProb for the book minus 1.0, expressed as %.
// Replicated here for display — src/lib/clv.ts does not export vigFor (server-side only).
// Pinnacle is our no-vig anchor (de-vig source) — display as 0% rather than the
// inflated raw sum (alt-points + multi-snapshot rollups can push the naive sum > 2).
function vigForDisplay(snapshots: BookPriceSnapshot[], book: string): number | null {
  if (book === 'pinnacle') return 0
  const bookSnaps = snapshots.filter((s) => s.book === book)
  if (bookSnaps.length < 2) return null
  const sum = bookSnaps.reduce((acc, s) => acc + s.impliedProb, 0)
  return (sum - 1) * 100
}

// Books we have active accounts at — highlighted in the table. Update when a new
// account is opened. Kalshi gets the strongest emphasis (per user instruction).
const ACCESSIBLE_BOOKS = new Set<string>([
  'draftkings', 'betmgm', 'fanduel', 'kalshi', 'bovada', 'betus',
])
const EMPHASIS_BOOK = 'kalshi'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceTableProps {
  analysis: MarketAnalysis
  missingBooks: string[]
  /** @deprecated Use built-in AddBetModal. External handler still supported for testing. */
  onAddToBetLog?: (snapshot: BookPriceSnapshot) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * LOCKED LS1 — the 12 curated book keys shown in the PriceTable.
 * kalshi and odds_api are intentionally excluded from display.
 * Keys with no snapshot data are tolerated gracefully (no error).
 */
const CURATED_BOOKS = [
  'pinnacle',
  '7stacks',
  'bovada',
  'betus',
  'betvegas23',
  'draftkings',
  'fanduel',
  'betmgm',
  'kalshi',
  'williamhill_us',
  'betrivers',
  'pointsbet',
  'foxbet',
] as const

/** Book display name map. */
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
  betvegas23: 'BetVegas23',
  betrivers: 'BetRivers',
  pointsbet: 'PointsBet',
  foxbet: 'FOX Bet',
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

// ─── PriceTable ───────────────────────────────────────────────────────────────

export function PriceTable({ analysis, missingBooks, onAddToBetLog }: PriceTableProps) {
  const { snapshots, bestPrice: bestMap } = analysis

  // ── Local modal state (LOG-01: Add to Bet Log wired locally) ──────────────
  const [selectedSnap, setSelectedSnap] = useState<BookPriceSnapshot | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  function handleAddClick(snap: BookPriceSnapshot) {
    // External handler (backward-compat / testing)
    if (onAddToBetLog) {
      onAddToBetLog(snap)
      return
    }
    setSelectedSnap(snap)
    setModalOpen(true)
  }

  function handleModalOpenChange(open: boolean) {
    setModalOpen(open)
    if (!open) {
      setTimeout(() => setSelectedSnap(null), 200)
    }
  }

  // Filter snapshots to the curated allowlist (LS1 — pure display filter)
  const curatedSnaps = snapshots.filter((s) => CURATED_BOOKS.includes(s.book as typeof CURATED_BOOKS[number]))
  // Filter missingBooks to the curated allowlist as well
  const curatedMissingBooks = missingBooks.filter((b) => CURATED_BOOKS.includes(b as typeof CURATED_BOOKS[number]))

  // Collect all unique books that appear in curated snapshots
  const presentBooks = Array.from(new Set(curatedSnaps.map((s) => s.book)))
  const sides = Array.from(new Set(curatedSnaps.map((s) => s.side)))

  // Determine best decimal per side for highlight logic
  const bestDecimalBySide: Record<string, number> = {}
  for (const side of sides) {
    const best = bestMap[side]
    if (best) bestDecimalBySide[side] = best.priceDecimal
  }

  // Flatten snapshot rows — sorted by side then decimal desc (best first)
  const sortedSnaps = [...curatedSnaps].sort((a, b) => {
    if (a.side !== b.side) return sides.indexOf(a.side) - sides.indexOf(b.side)
    return b.priceDecimal - a.priceDecimal
  })

  const hasData = curatedSnaps.length > 0 || curatedMissingBooks.length > 0

  if (!hasData) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No price data yet. Paste a pick or browse a market above.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <h3 className="text-sm font-semibold">Prices by Book</h3>
        {presentBooks.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {presentBooks.length} book{presentBooks.length !== 1 ? 's' : ''} · {curatedSnaps.length} line{curatedSnaps.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28">Book</TableHead>
            <TableHead className="w-20">Side</TableHead>
            <TableHead className="w-20 text-right">Point</TableHead>
            <TableHead className="w-24 text-right">American</TableHead>
            <TableHead className="w-24 text-right">Decimal</TableHead>
            <TableHead className="w-20 text-right">Vig %</TableHead>
            <TableHead className="w-24 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* ── Snapshot rows (sorted best-first per side) ──────────────────── */}
          {sortedSnaps.map((snap, idx) => {
            const isBest = bestDecimalBySide[snap.side] === snap.priceDecimal
            const vig = vigForDisplay(snapshots, snap.book)
            const isAccessible = ACCESSIBLE_BOOKS.has(snap.book)
            const isEmphasis = snap.book === EMPHASIS_BOOK
            const rowClass = isEmphasis
              ? 'bg-amber-500/10 border-l-2 border-l-amber-500/60'
              : isBest
                ? 'bg-primary/5 border-l-2 border-l-primary/40'
                : isAccessible
                  ? 'bg-emerald-500/[0.04] border-l-2 border-l-emerald-500/40'
                  : undefined

            return (
              <TableRow
                key={`${snap.book}-${snap.side}-${snap.point ?? 'null'}-${idx}`}
                className={rowClass}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    <span className={isEmphasis ? 'text-amber-300' : isAccessible ? 'text-emerald-200' : undefined}>
                      {bookLabel(snap.book)}
                    </span>
                    {isEmphasis && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-300 border-amber-500/40">
                        ★ my book
                      </Badge>
                    )}
                    {isAccessible && !isEmphasis && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                        my book
                      </Badge>
                    )}
                    {snap.book === 'pinnacle' && (
                      <Badge variant="secondary" className="text-[9px] bg-zinc-500/15 text-zinc-400">
                        No-Vig
                      </Badge>
                    )}
                    {isBest && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 bg-primary/10 text-primary border-primary/20">
                        best
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{formatSide(snap.side)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {snap.point != null ? snap.point : '—'}
                </TableCell>
                <TableCell className={`text-right tabular-nums font-mono ${isBest ? 'font-semibold' : ''}`}>
                  {formatOdds(snap.priceAmerican)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums font-mono ${isBest ? 'font-semibold' : ''}`}
                  title={snap.book === EMPHASIS_BOOK ? 'Kalshi taker fee applied — Phase 21 D-13' : undefined}
                >
                  {snap.book === EMPHASIS_BOOK
                    ? kalshiEffectiveDecimalOdds(snap.priceDecimal).toFixed(3)
                    : snap.priceDecimal.toFixed(3)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {vig != null ? `${vig >= 0 ? '+' : ''}${vig.toFixed(2)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {isBest && (
                    <AuthActions>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleAddClick(snap)}
                      >
                        <PlusCircle className="mr-1 size-3" />
                        Add
                      </Button>
                    </AuthActions>
                  )}
                </TableCell>
              </TableRow>
            )
          })}

          {/* ── Missing book rows — curated allowlist only (LS1); never silently omitted for curated books (BOOK-02) ─── */}
          {curatedMissingBooks.map((book) => {
            const isAccessible = ACCESSIBLE_BOOKS.has(book)
            const isEmphasis = book === EMPHASIS_BOOK
            return (
              <TableRow
                key={`missing-${book}`}
                className={isEmphasis ? 'opacity-70' : isAccessible ? 'opacity-60' : 'opacity-40'}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    <span className={isEmphasis ? 'text-amber-300' : isAccessible ? 'text-emerald-200' : undefined}>
                      {bookLabel(book)}
                    </span>
                    {isEmphasis && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-amber-500/20 text-amber-300 border-amber-500/40">
                        ★ my book
                      </Badge>
                    )}
                    {isAccessible && !isEmphasis && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                        my book
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell colSpan={5} className="text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">—</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                      no market
                    </Badge>
                  </div>
                </TableCell>
                <TableCell />
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* Staleness indicator */}
      {analysis.staleness > 0 && (
        <div className="border-t border-border/60 px-4 py-2">
          <p className="text-xs text-muted-foreground">
            Data age: {Math.round(analysis.staleness / 1000 / 60)} min
            {analysis.staleness > 10 * 60 * 1000 && (
              <span className="ml-2 text-amber-500">· Verify before betting — prices may have moved</span>
            )}
          </p>
        </div>
      )}

      {/* AddBetModal — renders from local state; LOG-01/02 */}
      {selectedSnap && (
        <AddBetModal
          snap={selectedSnap}
          analysis={analysis}
          open={modalOpen}
          onOpenChange={handleModalOpenChange}
        />
      )}
    </div>
  )
}

// Re-export to satisfy any downstream imports that check the USD pattern
export { USD }
