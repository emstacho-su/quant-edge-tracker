/**
 * useLineShop — central hook for the /line-shop page.
 *
 * Four slices:
 *   1. parse slice   — debounced paste text → POST /api/line-shop/parse
 *   2. prices slice  — POST /api/line-shop/prices → MarketAnalysis + missingBooks
 *   3. book-toggle   — per-book enable/disable persisted in localStorage qe.enabledBooks
 *   4. arb slice     — anon SELECT arb_opportunities (display-only, 0 credits, ARB-02/03/04)
 *
 * Correctness:
 *   - qe.enabledBooks localStorage key (BOOK-02, D-06, Pattern 7)
 *   - enabledBooks default set: pinnacle, bovada, draftkings, fanduel
 *   - No direct supabase writes; prices fetched via server-side /api/
 *   - Arb slice NEVER calls /api/line-shop/prices (Pitfall 5, T-09-14)
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { BookName, MarketAnalysis, BookPriceSnapshot } from '@/lib/line-shop-types'
import { americanToDecimal, impliedFromAmerican } from '@/lib/clv'
import { kalshiEffectiveDecimalOdds, kalshiFeeForStake } from '@/lib/kalshi-fee'

// ─── Constants ────────────────────────────────────────────────────────────────

const BOOK_STORAGE_KEY = 'qe.enabledBooks'
const DEFAULT_ENABLED_BOOKS: BookName[] = ['pinnacle', 'bovada', 'draftkings', 'fanduel']
const DEBOUNCE_MS = 500

/** Arb rows older than this threshold show a "verify before betting" warning (ARB-03). */
export const ARB_STALE_MINUTES = 10

/** Default minimum return % for the arb threshold filter (ARB-04). */
export const ARB_MIN_RETURN_DEFAULT = 0.5

// ─── localStorage helpers ─────────────────────────────────────────────────────

function readEnabledBooks(): BookName[] {
  if (typeof localStorage === 'undefined') return DEFAULT_ENABLED_BOOKS
  try {
    const raw = localStorage.getItem(BOOK_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BookName[]) : DEFAULT_ENABLED_BOOKS
  } catch {
    return DEFAULT_ENABLED_BOOKS
  }
}

function writeEnabledBooks(books: BookName[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(BOOK_STORAGE_KEY, JSON.stringify(books))
  } catch {
    // ignore quota / private mode
  }
}

// ─── Arb helpers (pure — exported for testing) ────────────────────────────────

/**
 * Compute how many minutes ago `detectedAt` was.
 * Exported as a pure function for unit testing (ARB-03).
 */
export function computeAgeMinutes(detectedAt: string | Date): number {
  const ts = typeof detectedAt === 'string' ? new Date(detectedAt).getTime() : detectedAt.getTime()
  return (Date.now() - ts) / 60_000
}

/**
 * Filter arb rows to those meeting or exceeding `minReturnPct`.
 * Exported as a pure function for unit testing (ARB-04).
 */
export function filterByMinReturn(rows: ArbRow[], minReturnPct: number): ArbRow[] {
  return rows.filter((r) => r.total_return_pct >= minReturnPct)
}

/**
 * Filter arb rows to those where BOTH side_a_book AND side_b_book are in `enabled`.
 * Per D-02: if either leg's book is disabled, the entire arb row is hidden.
 * Per D-03: reuses the same qe.enabledBooks slice as PriceTable — no new persistence.
 * Empty `enabled` → empty result (both legs can't be in an empty set).
 * Exported as a pure function for unit testing.
 */
export function filterByEnabledBooks(rows: ArbRow[], enabled: BookName[]): ArbRow[] {
  const set = new Set(enabled)
  return rows.filter(
    (r) => set.has(r.side_a_book as BookName) && set.has(r.side_b_book as BookName),
  )
}

/**
 * Enrich arb rows with per-leg source_confidence + uploaded_at from book_prices rows.
 * Pure function — no Supabase calls; receives the already-fetched book_prices data.
 * Key: `${market_id}|${book}|${side}`. On duplicate keys, latest fetched_at wins.
 * Exported for unit testing (21-08, D-09).
 */
export function enrichArbRowsWithBookPrices(
  rows: ArbRow[],
  bookPricesRows: Array<{
    market_id: string
    book: string
    side: string
    source_confidence: string | null
    fetched_at: string | null
  }>,
): ArbRow[] {
  // Build lookup map: key → { source_confidence, fetched_at }; latest fetched_at wins on ties.
  const map = new Map<string, { source_confidence: string | null; fetched_at: string | null }>()
  for (const bp of bookPricesRows) {
    const key = `${bp.market_id}|${bp.book}|${bp.side}`
    const existing = map.get(key)
    if (
      !existing ||
      (bp.fetched_at !== null && (existing.fetched_at === null || bp.fetched_at > existing.fetched_at))
    ) {
      map.set(key, { source_confidence: bp.source_confidence, fetched_at: bp.fetched_at })
    }
  }

  return rows.map((row) => {
    const aKey = `${row.market_id}|${row.side_a_book}|${row.side_a}`
    const bKey = `${row.market_id}|${row.side_b_book}|${row.side_b}`
    const aEntry = map.get(aKey) ?? null
    const bEntry = map.get(bKey) ?? null
    return {
      ...row,
      side_a_source_confidence: (aEntry?.source_confidence ?? null) as ArbRow['side_a_source_confidence'],
      side_a_uploaded_at: aEntry?.fetched_at ?? null,
      side_b_source_confidence: (bEntry?.source_confidence ?? null) as ArbRow['side_b_source_confidence'],
      side_b_uploaded_at: bEntry?.fetched_at ?? null,
    }
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Arb row shape returned by the arb slice, derived from arb_opportunities + markets join.
 * Includes pre-computed display fields (ageMinutes, isStale, stakeA, stakeB).
 * Per-leg enrichment fields (21-08, D-09) are populated by a book_prices lookup in fetchArbs.
 */
export interface ArbRow {
  id: string
  market_id: string
  side_a: string
  side_a_book: string
  side_a_price: number
  side_a_stake_pct: number
  side_b: string
  side_b_book: string
  side_b_price: number
  side_b_stake_pct: number
  total_return_pct: number
  detected_at: string
  status: string
  markets: {
    sport: string
    event_name: string
    market_type: string
    market_param: string | null
    event_start: string
  } | null
  /** Derived: minutes elapsed since detection */
  ageMinutes: number
  /** Derived: true when ageMinutes > ARB_STALE_MINUTES */
  isStale: boolean
  /** Derived: stake for side A given the configured total stake */
  stakeA: number
  /** Derived: stake for side B given the configured total stake */
  stakeB: number
  /** Per-leg source provenance from book_prices lookup (21-08, D-09). Null when no live row found. */
  side_a_source_confidence: 'api' | 'aggregator' | 'scraped' | 'manual' | null
  side_b_source_confidence: 'api' | 'aggregator' | 'scraped' | 'manual' | null
  /** ISO timestamp from book_prices.fetched_at when source_confidence='manual'; null otherwise. */
  side_a_uploaded_at: string | null
  side_b_uploaded_at: string | null
  /**
   * Kalshi taker fee in dollars for the current totalStake-derived stake on this leg.
   * Zero when the leg's book is not Kalshi or the stake yields zero contracts.
   * Integer-cent-ceiling formula per D-13, applied to the specific number of
   * contracts the user would buy at this stake (floor(stake / contract_price)).
   */
  side_a_kalshi_fee: number
  side_b_kalshi_fee: number
  /** Convenience: total combined Kalshi fee across both legs (most arbs have at most one Kalshi leg). */
  kalshi_fee_total: number
}

export interface ParsedPick {
  sport?: string
  market?: string
  side?: string
  home_team?: string
  away_team?: string
  line?: number | null
  price?: number | null
  confidence?: number
  parse_notes?: string
  [key: string]: unknown
}

export interface ParseResult {
  parsed: ParsedPick | null
  confidence: number
  needsFallback: boolean
}

export interface PricesResult {
  snapshots: BookPriceSnapshot[]
  analysis: MarketAnalysis
  missingBooks: string[]
  staleness: number
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLineShop() {
  // ── Parse slice ────────────────────────────────────────────────────────────
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [parseLoading, setParseLoading] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const parsePick = useCallback((text: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!text.trim()) {
      setParseResult(null)
      setParseError(null)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setParseLoading(true)
      setParseError(null)
      try {
        const res = await fetch('/api/line-shop/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) throw new Error(`Parse failed: ${res.status}`)
        const data = (await res.json()) as ParseResult
        setParseResult(data)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Parse error')
        setParseResult({ parsed: null, confidence: 0, needsFallback: true })
      } finally {
        setParseLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [])

  // ── Prices slice ───────────────────────────────────────────────────────────
  const [pricesResult, setPricesResult] = useState<PricesResult | null>(null)
  const [pricesLoading, setPricesLoading] = useState(false)
  const [pricesError, setPricesError] = useState<string | null>(null)

  const fetchPrices = useCallback(async (
    input: { market_id?: string; parsedPick?: ParsedPick; forceFresh?: boolean },
  ) => {
    setPricesLoading(true)
    setPricesError(null)
    try {
      const res = await fetch('/api/line-shop/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`Prices failed: ${res.status}`)
      const data = (await res.json()) as PricesResult
      setPricesResult(data)
    } catch (err) {
      setPricesError(err instanceof Error ? err.message : 'Price fetch error')
    } finally {
      setPricesLoading(false)
    }
  }, [])

  const clearPrices = useCallback(() => {
    setPricesResult(null)
    setPricesError(null)
  }, [])

  // ── Book-toggle slice (BOOK-02, Pattern 7) ─────────────────────────────────
  const [enabledBooks, setEnabledBooksState] = useState<BookName[]>(readEnabledBooks)

  const toggleBook = useCallback((book: BookName) => {
    setEnabledBooksState((prev) => {
      const next = prev.includes(book) ? prev.filter((b) => b !== book) : [...prev, book]
      writeEnabledBooks(next)
      return next
    })
  }, [])

  const setEnabledBooks = useCallback((books: BookName[]) => {
    writeEnabledBooks(books)
    setEnabledBooksState(books)
  }, [])

  const isBookEnabled = useCallback(
    (book: BookName) => enabledBooks.includes(book),
    [enabledBooks],
  )

  // ── Arb slice (ARB-02/03/04, D-07) ───────────────────────────────────────
  // Reads arb_opportunities via the anon Supabase client (RLS anon-SELECT, Phase 7 D-12).
  // NEVER calls /api/line-shop/prices — display-only, 0 Odds API credits (Pitfall 5, T-09-14).
  const [arbRows, setArbRows] = useState<ArbRow[]>([])
  const [arbLoading, setArbLoading] = useState(true)
  const [arbError, setArbError] = useState<string | null>(null)
  const [totalStake, setTotalStake] = useState(100)
  const [minReturnPct, setMinReturnPct] = useState(ARB_MIN_RETURN_DEFAULT)
  // Books seen in any arb over the recent window (14 days). Used by
  // BookFilterChips to render the full set of toggleable books — even ones
  // that don't currently appear in the live arb_opportunities top-50, so the
  // user can pre-filter for future detections.
  const [knownArbBooks, setKnownArbBooks] = useState<string[]>([])

  // One-shot on mount: fetch distinct books from recent arb history so the
  // chip row stays comprehensive even when only a few arbs are currently live.
  useEffect(() => {
    const cutoffIso = new Date(Date.now() - 14 * 24 * 3600_000).toISOString()
    void (async () => {
      const { data } = await supabase
        .from('arb_opportunities')
        .select('side_a_book, side_b_book')
        .gt('detected_at', cutoffIso)
        .limit(2000)
      if (!data) return
      const books = [
        ...new Set(
          data.flatMap((r) => [r.side_a_book as string, r.side_b_book as string]).filter(Boolean),
        ),
      ].sort()
      setKnownArbBooks(books)
    })()
  }, [])

  const fetchArbs = useCallback(async () => {
    setArbLoading(true)
    setArbError(null)
    try {
      // Filter out rows whose `expires_at` is in the past — those arbs are from
      // games that have already started/ended and would otherwise hang in the
      // scanner until newer detections push them past the LIMIT. Without this
      // filter, rows can linger for days when the cron stops producing new arbs.
      const { data, error } = await supabase
        .from('arb_opportunities')
        .select('*, markets(sport, event_name, market_type, market_param, event_start)')
        .eq('status', 'detected')
        .gt('expires_at', new Date().toISOString())
        .order('detected_at', { ascending: false })
        .limit(50)

      if (error) throw error

      const baseRows: ArbRow[] = (data ?? []).map((row) => {
        const ageMinutes = computeAgeMinutes(row.detected_at as string)
        const isStale = ageMinutes > ARB_STALE_MINUTES
        // sizeArb formula: stakeA = S·decB/(decA+decB), stakeB = S·decA/(decA+decB) (D-04)
        // For Kalshi legs, apply the taker-fee adjustment to the decimal odds so
        // the stake split correctly accounts for the fee at price-comparison
        // granularity (D-13 / 21-09). This mirrors the analysis.ts fix at
        // detection time and keeps the UI-recomputed stakes consistent with the
        // persisted stake_a_pct / stake_b_pct.
        const priceA = row.side_a_price as number
        const priceB = row.side_b_price as number
        const bookA = row.side_a_book as string
        const bookB = row.side_b_book as string
        const rawDecA = americanToDecimal(priceA)
        const rawDecB = americanToDecimal(priceB)
        const decA = bookA === 'kalshi' ? kalshiEffectiveDecimalOdds(rawDecA) : rawDecA
        const decB = bookB === 'kalshi' ? kalshiEffectiveDecimalOdds(rawDecB) : rawDecB
        const sumDec = decA + decB
        const stakeA = (totalStake * decB) / sumDec
        const stakeB = (totalStake * decA) / sumDec

        // Stake-size-specific Kalshi fee: integer-cent-ceiling × actual contract
        // count at this stake. Surfaced so the UI can show "Fee: $X.XX" per leg.
        const sideAKalshiFee =
          bookA === 'kalshi'
            ? kalshiFeeForStake(stakeA, impliedFromAmerican(priceA)).totalFeeDollars
            : 0
        const sideBKalshiFee =
          bookB === 'kalshi'
            ? kalshiFeeForStake(stakeB, impliedFromAmerican(priceB)).totalFeeDollars
            : 0
        return {
          id: row.id as string,
          market_id: row.market_id as string,
          side_a: row.side_a as string,
          side_a_book: row.side_a_book as string,
          side_a_price: row.side_a_price as number,
          side_a_stake_pct: row.side_a_stake_pct as number,
          side_b: row.side_b as string,
          side_b_book: row.side_b_book as string,
          side_b_price: row.side_b_price as number,
          side_b_stake_pct: row.side_b_stake_pct as number,
          total_return_pct: row.total_return_pct as number,
          detected_at: row.detected_at as string,
          status: row.status as string,
          markets: row.markets as ArbRow['markets'],
          ageMinutes,
          isStale,
          stakeA,
          stakeB,
          // Enrichment defaults — populated below via book_prices lookup (21-08, D-09)
          side_a_source_confidence: null,
          side_b_source_confidence: null,
          side_a_uploaded_at: null,
          side_b_uploaded_at: null,
          side_a_kalshi_fee: sideAKalshiFee,
          side_b_kalshi_fee: sideBKalshiFee,
          kalshi_fee_total: sideAKalshiFee + sideBKalshiFee,
        }
      })

      // ── Enrichment: per-leg source_confidence + uploaded_at from book_prices ──
      // One extra IN query against book_prices (T-21-08-04: O(1) round-trip, LIMIT 50 already on arbs).
      // Only live rows (superseded_at IS NULL) per 21-01 migration.
      let rows = baseRows
      const uniqueMarketIds = [...new Set(baseRows.map((r) => r.market_id))]
      if (uniqueMarketIds.length > 0) {
        const { data: bp } = await supabase
          .from('book_prices')
          .select('market_id, book, side, source_confidence, fetched_at')
          .in('market_id', uniqueMarketIds)
          .is('superseded_at', null)
        rows = enrichArbRowsWithBookPrices(baseRows, bp ?? [])
      }

      setArbRows(rows)
    } catch (err) {
      setArbError(err instanceof Error ? err.message : 'Failed to load arb opportunities')
    } finally {
      setArbLoading(false)
    }
  }, [totalStake])

  // Load arbs on mount; refresh when totalStake changes to recompute stake splits
  useEffect(() => {
    void fetchArbs()
  }, [fetchArbs])

  // Derived: rows after the min-return threshold filter, then the per-book display filter (D-02/D-03)
  const minReturnFiltered = filterByMinReturn(arbRows, minReturnPct)
  // allArbBooks: distinct books from PRE-filter rows — books toggled OFF remain in this list
  // so BookFilterChips can still show them as toggleable (Pitfall 7, 21-08 D-03).
  const allArbBooks = [...new Set(minReturnFiltered.flatMap((r) => [r.side_a_book, r.side_b_book]))].sort()
  const filteredArbRows = filterByEnabledBooks(minReturnFiltered, enabledBooks)

  return {
    // Parse
    parseResult,
    parseLoading,
    parseError,
    parsePick,

    // Prices
    pricesResult,
    pricesLoading,
    pricesError,
    fetchPrices,
    clearPrices,

    // Book toggle (BOOK-02)
    enabledBooks,
    toggleBook,
    setEnabledBooks,
    isBookEnabled,
    DEFAULT_ENABLED_BOOKS,

    // Arb slice (ARB-02/03/04)
    arbRows: filteredArbRows,
    allArbBooks,
    knownArbBooks,
    arbLoading,
    arbError,
    totalStake,
    setTotalStake,
    minReturnPct,
    setMinReturnPct,
    fetchArbs,
    ARB_STALE_MINUTES,
    ARB_MIN_RETURN_DEFAULT,
  }
}
