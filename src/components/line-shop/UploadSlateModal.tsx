/**
 * UploadSlateModal — controlled Dialog for uploading an offshore sportsbook slate.
 *
 * UX flow (D-04, D-05, D-06, D-11, D-12):
 *   1. Book picker (Select): exactly the four registered offshore books (D-11).
 *   2. Paste textarea: disabled until a book is selected (D-05).
 *   3. Parse button: calls parseOffshoreSlate(book, rawText) → { parsed, unparsed }.
 *   4. Review step: parsed rows (read-only + Drop) + fix-up table for unparsed rows
 *      (editable side / point / priceAmerican — nothing silently dropped, D-06).
 *   5. Confirm Upload: calls useOffshoreSlate().upload(...) with resolved market_ids;
 *      on success calls onSuccess(result) + onOpenChange(false) (D-12).
 *
 * Security mitigations:
 *   T-21-07-01: rawText in controlled textarea — never injected as innerHTML.
 *   T-21-07-02: numeric inputs use type="number"; resolveMarketId is a FK gate.
 *   T-21-07-04: upload route enforces requireSession; 401 surfaces as error banner.
 *   T-21-07-05: rawText capped at 100_000 chars before parser invocation.
 *
 * The modal does NOT wrap itself in <AuthGate> — ArbPanel (21-08) wraps the
 * trigger button in <AuthActions>; defence-in-depth via the route's requireSession.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2 } from 'lucide-react'
import { parseOffshoreSlate } from '@/utils/offshore-slate-parser'
import type { OffshoreBook } from '@/utils/offshore-slate-parser'
import { useOffshoreSlate } from '@/hooks/use-offshore-slate'
import type { UploadResult } from '@/hooks/use-offshore-slate'
import { resolveMarketId, inferMarketType } from '@/components/line-shop/__fixtures__/markets-lookup'
import { supabase } from '@/lib/supabase'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fixed offshore book set (D-11). Do NOT read from BookName union — this set is intentionally
 *  bounded and broadening it requires an explicit code change. */
const ALLOWED_BOOKS = [
  { id: '7stacks',    label: '7stacks' },
  { id: 'betvegas23', label: 'betvegas23' },
  { id: 'bovada',     label: 'Bovada' },
  { id: 'betus',      label: 'BetUS' },
] as const satisfies ReadonlyArray<{ id: OffshoreBook; label: string }>

const MAX_RAW_TEXT = 100_000

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalStep = 'pick-book' | 'paste' | 'review' | 'confirming'

interface ReviewRow {
  /** Index within the review list — stable key for updates. */
  idx: number
  origin: 'parsed' | 'unparsed'
  rawLine: string
  reason?: string
  // Editable fields — initial values from parser; user can override in fix-up.
  sport: string | null
  side: 'home' | 'away' | 'over' | 'under' | ''
  point: number | null
  priceAmerican: number | null
  eventNameHint: string
  marketId: string | null
  /** 'resolving' while the async lookup is in-flight for this row. */
  marketIdStatus: 'pending' | 'resolving' | 'resolved' | 'unresolved'
  status: 'keep' | 'drop'
}

export interface UploadSlateModalProps {
  open: boolean
  onOpenChange(open: boolean): void
  onSuccess?(result: UploadResult): void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatOddsDisplay(price: number | null): string {
  if (price === null) return '—'
  return price > 0 ? `+${price}` : String(price)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UploadSlateModal({ open, onOpenChange, onSuccess }: UploadSlateModalProps) {
  const { uploading, uploadError, upload, reset } = useOffshoreSlate()

  // ── Modal state machine ────────────────────────────────────────────────────
  const [step, setStep] = useState<ModalStep>('pick-book')
  const [book, setBook] = useState<OffshoreBook | ''>('')
  const [rawText, setRawText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])

  // Reset everything when the dialog closes or reopens clean.
  const handleClose = useCallback(() => {
    onOpenChange(false)
    // Defer reset so the closing animation isn't janky.
    setTimeout(() => {
      setStep('pick-book')
      setBook('')
      setRawText('')
      setParseError(null)
      setReviewRows([])
      reset()
    }, 150)
  }, [onOpenChange, reset])

  // ── Book selection → advance to paste step ─────────────────────────────────
  const handleSelectBook = useCallback((value: string | null) => {
    if (!value) return
    setBook(value as OffshoreBook)
    setStep('paste')
    setParseError(null)
  }, [])

  // ── Parse ──────────────────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    if (!book) return

    // T-21-07-05: cap input before parser invocation.
    if (rawText.length > MAX_RAW_TEXT) {
      setParseError('Paste too large — split into smaller batches (max 100 KB).')
      return
    }

    setParseError(null)
    const { parsed, unparsed } = parseOffshoreSlate(book as OffshoreBook, rawText)

    if (parsed.length === 0 && unparsed.length === 0) {
      setParseError('No lines found — paste some slate text first.')
      return
    }

    let idx = 0
    const rows: ReviewRow[] = [
      ...parsed.map((p) => ({
        idx: idx++,
        origin: 'parsed' as const,
        rawLine: p.rawLine,
        sport: p.sport,
        side: (p.side ?? '') as ReviewRow['side'],
        point: p.point,
        priceAmerican: p.priceAmerican,
        eventNameHint: p.eventNameHint ?? '',
        marketId: null,
        marketIdStatus: 'pending' as const,
        status: 'keep' as const,
      })),
      ...unparsed.map((u) => ({
        idx: idx++,
        origin: 'unparsed' as const,
        rawLine: u.line,
        reason: u.reason,
        sport: null,
        side: '' as ReviewRow['side'],
        point: null,
        priceAmerican: null,
        eventNameHint: u.line,
        marketId: null,
        marketIdStatus: 'pending' as const,
        status: 'keep' as const,
      })),
    ]

    setReviewRows(rows)
    setStep('review')
  }, [book, rawText])

  // ── Resolve market IDs when entering review ────────────────────────────────
  useEffect(() => {
    if (step !== 'review') return
    if (reviewRows.length === 0) return

    // Only resolve rows that are 'keep' + 'pending' and have enough data.
    const toResolve = reviewRows.filter(
      (r) => r.status === 'keep' && r.marketIdStatus === 'pending',
    )
    if (toResolve.length === 0) return

    // Mark them as resolving.
    setReviewRows((prev) =>
      prev.map((r) =>
        r.marketIdStatus === 'pending' && r.status === 'keep'
          ? { ...r, marketIdStatus: 'resolving' }
          : r,
      ),
    )

    // Resolve all in parallel.
    Promise.all(
      toResolve.map(async (r) => {
        const marketType = inferMarketType(r.side, r.point)
        const id = await resolveMarketId(supabase, {
          sport: r.sport ?? 'unknown',
          eventNameHint: r.eventNameHint,
          marketType,
          marketParam: r.point !== null ? String(r.point) : null,
        })
        return { idx: r.idx, id }
      }),
    ).then((results) => {
      setReviewRows((prev) => {
        const idMap = new Map(results.map((r) => [r.idx, r.id]))
        return prev.map((r) => {
          if (!idMap.has(r.idx)) return r
          const id = idMap.get(r.idx) ?? null
          return {
            ...r,
            marketId: id,
            marketIdStatus: id !== null ? 'resolved' : 'unresolved',
          }
        })
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ── Per-row update (fix-up table) ──────────────────────────────────────────
  const updateRow = useCallback((rowIdx: number, partial: Partial<ReviewRow>) => {
    setReviewRows((prev) =>
      prev.map((r) => {
        if (r.idx !== rowIdx) return r
        const updated = { ...r, ...partial }
        // When user edits a field that affects market resolution, reset status.
        if (
          'side' in partial ||
          'point' in partial ||
          'eventNameHint' in partial ||
          'sport' in partial
        ) {
          updated.marketId = null
          updated.marketIdStatus = 'pending'
        }
        return updated
      }),
    )
  }, [])

  // Re-resolve any pending rows that were reset by editing.
  useEffect(() => {
    if (step !== 'review') return
    const pending = reviewRows.filter(
      (r) => r.status === 'keep' && r.marketIdStatus === 'pending',
    )
    if (pending.length === 0) return

    setReviewRows((prev) =>
      prev.map((r) =>
        r.marketIdStatus === 'pending' && r.status === 'keep'
          ? { ...r, marketIdStatus: 'resolving' }
          : r,
      ),
    )

    Promise.all(
      pending.map(async (r) => {
        const marketType = inferMarketType(r.side, r.point)
        const id = await resolveMarketId(supabase, {
          sport: r.sport ?? 'unknown',
          eventNameHint: r.eventNameHint,
          marketType,
          marketParam: r.point !== null ? String(r.point) : null,
        })
        return { idx: r.idx, id }
      }),
    ).then((results) => {
      setReviewRows((prev) => {
        const idMap = new Map(results.map((r) => [r.idx, r.id]))
        return prev.map((r) => {
          if (!idMap.has(r.idx)) return r
          const id = idMap.get(r.idx) ?? null
          return {
            ...r,
            marketId: id,
            marketIdStatus: id !== null ? 'resolved' : 'unresolved',
          }
        })
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRows.filter((r) => r.marketIdStatus === 'pending').length, step])

  // ── Confirm Upload ─────────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!book) return

    const uploadRows = reviewRows
      .filter((r) => r.status === 'keep' && r.marketId !== null)
      .map((r) => ({
        market_id: r.marketId!,
        side: r.side as 'home' | 'away' | 'over' | 'under',
        price_american: r.priceAmerican!,
        point: r.point,
      }))

    if (uploadRows.length === 0) return

    setStep('confirming')
    const result = await upload({ book: book as OffshoreBook, rows: uploadRows })

    if (result) {
      onSuccess?.(result)
      handleClose()
    } else {
      // upload sets uploadError; stay on review step so user can see it.
      setStep('review')
    }
  }, [book, reviewRows, upload, onSuccess, handleClose])

  // ── Derived state ──────────────────────────────────────────────────────────
  const canParse = !!book && rawText.trim().length > 0

  const keptRows = reviewRows.filter((r) => r.status === 'keep')
  const hasResolvingRows = keptRows.some((r) => r.marketIdStatus === 'resolving')
  const hasUnresolvedKeptRows = keptRows.some(
    (r) => r.marketIdStatus === 'unresolved' || r.marketIdStatus === 'pending',
  )
  const uploadableRows = keptRows.filter((r) => r.marketId !== null)
  const canConfirm =
    uploadableRows.length > 0 &&
    !hasResolvingRows &&
    !uploading &&
    step !== 'confirming'

  const parsedRows = reviewRows.filter((r) => r.origin === 'parsed')
  const unparsedRows = reviewRows.filter((r) => r.origin === 'unparsed')

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Offshore Slate</DialogTitle>
          <DialogDescription>
            Paste a slate from your offshore book to inject prices into the arb scanner.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: pick-book / paste ── */}
        {(step === 'pick-book' || step === 'paste') && (
          <div className="space-y-4 py-2">
            {/* Book picker — always visible and enabled (D-05: renders BEFORE textarea) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" id="book-picker-label">
                Book
              </label>
              <Select
                value={book || undefined}
                onValueChange={handleSelectBook}
              >
                <SelectTrigger
                  aria-labelledby="book-picker-label"
                  className="w-48"
                  data-testid="book-select-trigger"
                >
                  <SelectValue placeholder="Select book…" />
                </SelectTrigger>
                <SelectContent>
                  {ALLOWED_BOOKS.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Paste textarea — disabled until a book is selected (D-05) */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="slate-paste-area">
                Paste slate text
              </label>
              <Textarea
                id="slate-paste-area"
                placeholder={book ? 'Paste slate text here…' : 'Select a book first'}
                className="min-h-[10rem] font-mono text-sm"
                disabled={!book}
                value={rawText}
                onChange={(e) => {
                  setRawText(e.target.value)
                  setParseError(null)
                }}
              />
            </div>

            {parseError && (
              <p className="text-sm text-destructive">{parseError}</p>
            )}
          </div>
        )}

        {/* ── Step: review ── */}
        {(step === 'review' || step === 'confirming') && (
          <div className="space-y-6 py-2">
            {/* Upload error banner (D-12 — surfaced from hook on confirm failure) */}
            {uploadError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {uploadError}
              </div>
            )}

            {/* Unresolved warning */}
            {hasUnresolvedKeptRows && !hasResolvingRows && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm text-yellow-600 dark:text-yellow-400">
                Some kept rows could not be matched to a market. Drop or edit them before confirming.
              </div>
            )}

            {/* Parsed rows section */}
            {parsedRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Parsed ({parsedRows.filter((r) => r.status === 'keep').length} kept)
                </h3>
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Line</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Point</TableHead>
                        <TableHead>Odds</TableHead>
                        <TableHead>Market</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedRows.map((row) => (
                        <TableRow
                          key={row.idx}
                          className={row.status === 'drop' ? 'opacity-40 line-through' : ''}
                        >
                          <TableCell className="max-w-[200px] truncate text-xs font-mono" title={row.rawLine}>
                            {row.rawLine}
                          </TableCell>
                          <TableCell className="capitalize text-sm">
                            {row.side || '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.point !== null ? row.point : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {formatOddsDisplay(row.priceAmerican)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.marketIdStatus === 'resolving' && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Loader2 className="size-3 animate-spin" /> resolving…
                              </span>
                            )}
                            {row.marketIdStatus === 'resolved' && (
                              <span className="text-green-600 dark:text-green-400">matched</span>
                            )}
                            {row.marketIdStatus === 'unresolved' && row.status === 'keep' && (
                              <span
                                className="text-yellow-600 dark:text-yellow-400"
                                title="No market match — drop or edit the event hint"
                              >
                                no match
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.status === 'keep' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => updateRow(row.idx, { status: 'drop' })}
                              >
                                Drop
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateRow(row.idx, { status: 'keep', marketIdStatus: 'pending' })
                                }
                              >
                                Restore
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* Needs-attention (unparsed) section */}
            {unparsedRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-yellow-600 dark:text-yellow-400 uppercase tracking-wide">
                  Needs attention ({unparsedRows.filter((r) => r.status === 'keep').length} pending)
                </h3>
                <div className="overflow-x-auto rounded-md border border-yellow-500/30">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Raw line</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead>Point</TableHead>
                        <TableHead>Odds</TableHead>
                        <TableHead>Event hint</TableHead>
                        <TableHead>Market</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unparsedRows.map((row) => (
                        <TableRow
                          key={row.idx}
                          className={row.status === 'drop' ? 'opacity-40' : 'bg-yellow-500/5'}
                        >
                          <TableCell
                            className="max-w-[160px] truncate text-xs font-mono"
                            title={row.rawLine}
                          >
                            {row.rawLine}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.reason ?? '—'}
                          </TableCell>
                          {/* Editable: side */}
                          <TableCell>
                            {row.status === 'keep' ? (
                              <Select
                                value={row.side || undefined}
                                onValueChange={(v) =>
                                  updateRow(row.idx, {
                                    side: v as ReviewRow['side'],
                                  })
                                }
                              >
                                <SelectTrigger size="sm" className="w-24">
                                  <SelectValue placeholder="side" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(['home', 'away', 'over', 'under'] as const).map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {s}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-sm text-muted-foreground">{row.side || '—'}</span>
                            )}
                          </TableCell>
                          {/* Editable: point */}
                          <TableCell>
                            {row.status === 'keep' ? (
                              <input
                                type="number"
                                step="0.5"
                                className="w-20 rounded border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring"
                                placeholder="e.g. 8.5"
                                value={row.point ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value
                                  updateRow(row.idx, {
                                    point: v === '' ? null : Number(v),
                                  })
                                }}
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {row.point !== null ? row.point : '—'}
                              </span>
                            )}
                          </TableCell>
                          {/* Editable: priceAmerican */}
                          <TableCell>
                            {row.status === 'keep' ? (
                              <input
                                type="number"
                                step="1"
                                className="w-20 rounded border border-input bg-transparent px-2 py-1 font-mono text-sm outline-none focus:border-ring"
                                placeholder="-110"
                                value={row.priceAmerican ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value
                                  updateRow(row.idx, {
                                    priceAmerican: v === '' ? null : Number(v),
                                  })
                                }}
                              />
                            ) : (
                              <span className="font-mono text-sm text-muted-foreground">
                                {formatOddsDisplay(row.priceAmerican)}
                              </span>
                            )}
                          </TableCell>
                          {/* Editable: eventNameHint */}
                          <TableCell>
                            {row.status === 'keep' ? (
                              <input
                                type="text"
                                className="w-36 rounded border border-input bg-transparent px-2 py-1 text-xs outline-none focus:border-ring"
                                placeholder="e.g. Yankees @ Red Sox"
                                value={row.eventNameHint}
                                onChange={(e) =>
                                  updateRow(row.idx, { eventNameHint: e.target.value })
                                }
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground truncate max-w-[140px] block">
                                {row.eventNameHint || '—'}
                              </span>
                            )}
                          </TableCell>
                          {/* Market resolution status */}
                          <TableCell className="text-xs">
                            {row.status === 'keep' && row.marketIdStatus === 'resolving' && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                <Loader2 className="size-3 animate-spin" /> resolving…
                              </span>
                            )}
                            {row.status === 'keep' && row.marketIdStatus === 'resolved' && (
                              <span className="text-green-600 dark:text-green-400">matched</span>
                            )}
                            {row.status === 'keep' && row.marketIdStatus === 'unresolved' && (
                              <span
                                className="text-yellow-600 dark:text-yellow-400"
                                title="No market match — drop or edit the event hint"
                              >
                                no match
                              </span>
                            )}
                          </TableCell>
                          {/* Actions: keep-and-match or drop */}
                          <TableCell className="text-right">
                            {row.status === 'keep' ? (
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    updateRow(row.idx, { marketIdStatus: 'pending' })
                                  }
                                  title="Re-attempt market match with current field values"
                                >
                                  Match
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => updateRow(row.idx, { status: 'drop' })}
                                >
                                  Drop
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateRow(row.idx, { status: 'keep', marketIdStatus: 'pending' })
                                }
                              >
                                Restore
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter>
          {/* Back button (review → paste) */}
          {(step === 'review' || step === 'confirming') && (
            <Button
              variant="outline"
              onClick={() => setStep('paste')}
              disabled={step === 'confirming'}
            >
              Back
            </Button>
          )}

          {/* Cancel / close */}
          <Button variant="outline" onClick={handleClose} disabled={uploading}>
            Cancel
          </Button>

          {/* Parse button (visible in pick-book / paste steps) */}
          {(step === 'pick-book' || step === 'paste') && (
            <Button onClick={handleParse} disabled={!canParse}>
              Parse
            </Button>
          )}

          {/* Confirm Upload (visible in review / confirming steps) */}
          {(step === 'review' || step === 'confirming') && (
            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              {uploading || step === 'confirming' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                `Confirm Upload (${uploadableRows.length})`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
