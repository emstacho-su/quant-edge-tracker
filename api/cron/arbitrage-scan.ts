import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { detectArb } from '../_lib/line-shop/analysis.js'
import { resolveEventMapping } from '../_lib/line-shop/adapters/odds-api-adapter.js'
import { impliedFromAmerican, americanToDecimal } from '../_lib/clv.js'
import { reverseMarket } from '../_lib/line-shop/markets-ingest.js'
import type { BookPriceSnapshot, ArbOpportunity } from '../_lib/line-shop/types.js'

/**
 * GET /api/cron/arbitrage-scan
 *
 * Analysis-only arbitrage scanner — reads recent odds_snapshots, groups by
 * (odds_event_id, market, point), runs detectArb on RAW implied probabilities,
 * and persists detected arbs to arb_opportunities.
 *
 * ZERO Odds API credits — this cron is DB-read-only. It never calls
 * fetchSportOdds or fetchEventOdds.
 *
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 * Mirrors the pattern in api/cron/line-movement.ts.
 */

/** Minimum arb return % to report. Conservative default; tunable via env. */
const ARB_MIN_RETURN_PCT = Number(process.env.ARB_MIN_RETURN_PCT ?? 0.3)

// ─── SlateSnapRow shape (matches odds-slate.ts + line-movement.ts) ────────────

interface SlateSnapRow {
  odds_event_id: string
  sport_key: string
  commence_time: string
  home_team: string
  away_team: string
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price_american: number
  captured_at: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    return res.status(200).json(await run())
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}

// ─── run() ────────────────────────────────────────────────────────────────────

export async function run(): Promise<{ scanned: number; detected: number; creditsUsed: 0 }> {
  const supabase = getServiceClient()
  const now = new Date()
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  // Pitfall 3: time-scope the query — only recent snapshots for upcoming events.
  // captured_at > now-2h: avoids stale lines generating phantom arbs.
  // commence_time > now: only future events can have live arbs.
  const { data, error } = await supabase
    .from('odds_snapshots')
    .select('*')
    .gt('captured_at', twoHoursAgo)
    .gt('commence_time', now.toISOString())

  if (error) throw new Error(`odds_snapshots query: ${error.message}`)
  const rows = (data ?? []) as SlateSnapRow[]

  // Pitfall 6: group by (odds_event_id, market, coalesce(point,'null')).
  // Spreads and totals at different lines are NEVER merged — the point is part of the key.
  const groups = groupByMarket(rows)

  let detected = 0

  for (const [, groupRows] of groups) {
    const sample = groupRows[0]!

    // Resolve the canonical EVENT, then the specific markets row (event × type × param).
    const canonicalEventId = await resolveEventMapping(
      sample.odds_event_id,
      sample.home_team,
      sample.away_team,
      new Date(sample.commence_time),
    )
    if (canonicalEventId === null) continue

    const pointKey = sample.point == null ? '' : String(sample.point)
    const { data: mkt } = await supabase
      .from('markets')
      .select('id')
      .eq('event_id', canonicalEventId)
      .eq('market_type', reverseMarket(sample.market))
      .eq('market_param', pointKey)
      .maybeSingle()
    if (!mkt) continue
    const marketId = (mkt as { id: string }).id

    // Build BookPriceSnapshot[] per side.
    // Pitfall 5: impliedProb = impliedFromAmerican (RAW with vig). NO noVigMulti.
    const { sideA, sideB } = splitIntoSides(groupRows, sample.market, sample.home_team, sample.away_team)
    if (sideA.length === 0 || sideB.length === 0) continue

    // Dedupe latest snapshot per book per side so each book contributes one price.
    const dedupedA = dedupeByBook(sideA)
    const dedupedB = dedupeByBook(sideB)

    // detectArb imported from analysis.ts — fee-adjustment is now applied at the price level
    // inside detectArb (D-13), not as a threshold bump. Pass the plain base threshold.
    const arb = detectArb(dedupedA, dedupedB, ARB_MIN_RETURN_PCT)
    if (!arb) continue

    const { error: insertErr } = await supabase
      .from('arb_opportunities')
      .insert([arbToRow(arb, marketId, sample.commence_time)])
    if (insertErr) {
      console.error('[arbitrage-scan] arb_opportunities insert error:', insertErr.message)
      continue
    }
    detected++
  }

  // creditsUsed is always 0: this cron never calls fetchSportOdds / fetchEventOdds.
  return { scanned: groups.size, detected, creditsUsed: 0 }
}

/** Map a detected ArbOpportunity + resolved markets.id to an arb_opportunities insert row. */
export function arbToRow(arb: ArbOpportunity, marketId: string, commenceTime: string | null) {
  return {
    market_id: marketId,
    side_a: arb.sideA.side,
    side_a_book: arb.sideA.book,
    side_a_price: arb.sideA.priceAmerican,
    side_a_stake_pct: arb.stakeAPct,
    side_b: arb.sideB.side,
    side_b_book: arb.sideB.book,
    side_b_price: arb.sideB.priceAmerican,
    side_b_stake_pct: arb.stakeBPct,
    total_return_pct: arb.totalReturnPct,
    expires_at: commenceTime,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Group rows by (odds_event_id, market, point).
 * Pitfall 6: point is part of the key — spreads/totals at different lines are separate groups.
 */
function groupByMarket(rows: SlateSnapRow[]): Map<string, SlateSnapRow[]> {
  const groups = new Map<string, SlateSnapRow[]>()
  for (const row of rows) {
    const pointKey = row.point !== null ? String(row.point) : 'null'
    const key = `${row.odds_event_id}|${row.market}|${pointKey}`
    const existing = groups.get(key) ?? []
    existing.push(row)
    groups.set(key, existing)
  }
  return groups
}

/**
 * Split rows within a group into sideA and sideB snapshots.
 *
 * Market conventions:
 *   h2h    → home team selection = sideA, away team = sideB
 *   spreads → home-named selection = sideA, away-named = sideB (within the same point)
 *   totals  → 'Over' = sideA, 'Under' = sideB
 *
 * Each row becomes a BookPriceSnapshot with:
 *   impliedProb = impliedFromAmerican(price_american)  [RAW, Pitfall 5]
 *   priceDecimal = americanToDecimal(price_american)
 */
function splitIntoSides(
  rows: SlateSnapRow[],
  market: string,
  homeTeam: string,
  awayTeam: string,
): { sideA: BookPriceSnapshot[]; sideB: BookPriceSnapshot[] } {
  const sideA: BookPriceSnapshot[] = []
  const sideB: BookPriceSnapshot[] = []

  for (const row of rows) {
    const snap = rowToSnapshot(row, homeTeam, awayTeam, market)
    const sel = row.selection.toLowerCase()

    if (market === 'totals') {
      if (sel === 'over') sideA.push(snap)
      else if (sel === 'under') sideB.push(snap)
    } else {
      // h2h + spreads: home = sideA, away = sideB
      if (isHomeSide(row.selection, homeTeam)) sideA.push(snap)
      else if (isAwaySide(row.selection, awayTeam)) sideB.push(snap)
    }
  }

  return { sideA, sideB }
}

/** Build a BookPriceSnapshot from a SlateSnapRow with RAW implied probability. */
function rowToSnapshot(
  row: SlateSnapRow,
  homeTeam: string,
  awayTeam: string,
  market: string,
): BookPriceSnapshot {
  return {
    book: row.bookmaker as BookPriceSnapshot['book'],
    side: resolveSelectionSide(row.selection, homeTeam, awayTeam, market),
    priceAmerican: row.price_american,
    // INVARIANT: RAW implied probability — never devigged (Pitfall 5, D-02)
    impliedProb: impliedFromAmerican(row.price_american),
    priceDecimal: americanToDecimal(row.price_american),
    point: row.point,
    fetchedAt: new Date(row.captured_at),
    sourceConfidence: 'aggregator',
    isClosing: false,
  }
}

/** Deduplicate snapshots by book: keep the one with the latest captured_at. */
function dedupeByBook(snaps: BookPriceSnapshot[]): BookPriceSnapshot[] {
  const byBook = new Map<string, BookPriceSnapshot>()
  for (const snap of snaps) {
    const existing = byBook.get(snap.book)
    if (!existing || snap.fetchedAt > existing.fetchedAt) {
      byBook.set(snap.book, snap)
    }
  }
  return Array.from(byBook.values())
}

/** Return the Side label for a selection in context of market + teams. */
function resolveSelectionSide(
  selection: string,
  homeTeam: string,
  awayTeam: string,
  market: string,
): BookPriceSnapshot['side'] {
  const sel = selection.toLowerCase()
  if (market === 'totals') {
    if (sel === 'over') return 'over'
    if (sel === 'under') return 'under'
  }
  if (isHomeSide(selection, homeTeam)) return 'home'
  if (isAwaySide(selection, awayTeam)) return 'away'
  return 'home' // fallback
}

/** True when the selection matches the home team (exact or substring). */
function isHomeSide(selection: string, homeTeam: string): boolean {
  const sel = selection.toLowerCase()
  const home = homeTeam.toLowerCase()
  return sel === home || home.includes(sel) || sel.includes(home)
}

/** True when the selection matches the away team (exact or substring). */
function isAwaySide(selection: string, awayTeam: string): boolean {
  const sel = selection.toLowerCase()
  const away = awayTeam.toLowerCase()
  return sel === away || away.includes(sel) || sel.includes(away)
}
