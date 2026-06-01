/**
 * POST /api/line-shop/prices
 *
 * Orchestrator: resolve market → run enabled adapters → analysis → response.
 *
 * Accepts EITHER:
 *   { market_id: string }            (browse mode — direct FK lookup)
 *   { parsedPick: ParsedPick, forceFresh?: boolean } (paste mode — market resolution)
 *
 * Response: { snapshots, analysis, missingBooks, staleness }
 *
 * Correctness invariants:
 *   BOOK-02: enabled adapters that return null → missingBooks (never silent omission)
 *   SHOP-07: each adapter runs in Promise.all with ADAPTER_TIMEOUT_MS timeout
 *   SHOP-04/05/06: analysis composed from Phase 7 bestPrice/vigFor/noVigConsensus/preBetCLV
 *   D-05: no odds math re-implemented here — imports from analysis.ts
 *   T-09-08: all adapter calls server-side (Odds API key never in browser)
 *   T-09-11: per-adapter timeout prevents DoS via slow book
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { enabledAdapters } from '../_lib/line-shop/adapters/registry.js'
import {
  bestPrice,
  vigFor,
  noVigConsensus,
  preBetCLV,
  detectArb,
} from '../_lib/line-shop/analysis.js'
import { getServiceClient } from '../_lib/supabase-admin.js'
import type {
  CanonicalMarket,
  BookPriceSnapshot,
  MarketAnalysis,
} from '../_lib/line-shop/types.js'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Per-adapter fetch timeout in ms. A slow book becomes a missingBook, not a hang. */
const ADAPTER_TIMEOUT_MS = 3000

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedPick {
  sport?: string
  market?: string
  side?: string
  home_team?: string
  away_team?: string
  line?: number | null
  price?: number | null
  confidence?: number
  [key: string]: unknown
}

export interface PricesRequest {
  market_id?: string
  parsedPick?: ParsedPick
  forceFresh?: boolean
}

export interface PricesResponse {
  snapshots: BookPriceSnapshot[]
  analysis: MarketAnalysis
  missingBooks: string[]
  staleness: number
}

// ─── Market resolution ────────────────────────────────────────────────────────

/**
 * Resolve a CanonicalMarket from a market_id (browse mode).
 * Looks up the `markets` table by UUID primary key.
 */
async function resolveByMarketId(marketId: string): Promise<CanonicalMarket | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('markets')
    .select('id, sport, event_id, event_name, event_start, odds_api_event_id, market_type, market_param')
    .eq('id', marketId)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id as string,
    sport: data.sport as string,
    eventId: data.event_id as string,
    eventName: data.event_name as string,
    eventStart: new Date(data.event_start as string),
    oddsApiEventId: (data.odds_api_event_id as string | null) ?? null,
    marketType: data.market_type as CanonicalMarket['marketType'],
    marketParam: (data.market_param as string | null) ?? null,
  }
}

/**
 * Resolve a CanonicalMarket from a ParsedPick (paste mode).
 * Attempts to look up an existing market by sport + home/away teams + market type.
 * Returns null when no canonical market can be found.
 *
 * NOTE: Full upsert/creation is deferred — paste mode requires event resolution
 * logic from the adapter layer. For now, we attempt a best-effort lookup.
 */
async function resolveByParsedPick(pick: ParsedPick): Promise<CanonicalMarket | null> {
  if (!pick.sport || !pick.market) return null

  const supabase = getServiceClient()
  const sport = pick.sport.toLowerCase()
  const marketType = pick.market as CanonicalMarket['marketType']

  // Build query for matching markets
  let query = supabase
    .from('markets')
    .select('id, sport, event_id, event_name, event_start, odds_api_event_id, market_type, market_param')
    .eq('sport', sport)
    .eq('market_type', marketType)
    .order('event_start', { ascending: true })
    .limit(50)

  // Filter to upcoming events only (within next 7 days)
  const now = new Date()
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  query = query
    .gte('event_start', now.toISOString())
    .lte('event_start', windowEnd.toISOString())

  const { data, error } = await query
  if (error || !data || data.length === 0) return null

  // If teams are specified, try to find the best matching event
  interface MarketRow {
    id: string
    sport: string
    event_id: string
    event_name: string
    event_start: string
    odds_api_event_id: string | null
    market_type: string
    market_param: string | null
    home_team?: string
    away_team?: string
  }

  if (pick.home_team || pick.away_team) {
    const rows = data as MarketRow[]
    for (const row of rows) {
      const name = (row.event_name ?? '').toLowerCase()
      const homeMatch = pick.home_team && name.includes(pick.home_team.toLowerCase().split(' ').pop() ?? '')
      const awayMatch = pick.away_team && name.includes(pick.away_team.toLowerCase().split(' ').pop() ?? '')
      if (homeMatch || awayMatch) {
        return {
          id: row.id,
          sport: row.sport,
          eventId: row.event_id,
          eventName: row.event_name,
          eventStart: new Date(row.event_start),
          oddsApiEventId: row.odds_api_event_id ?? null,
          marketType: row.market_type as CanonicalMarket['marketType'],
          marketParam: row.market_param ?? null,
        }
      }
    }
  }

  // Fallback: return first result (soonest upcoming event matching sport+market)
  const row = data[0] as MarketRow
  return {
    id: row.id,
    sport: row.sport,
    eventId: row.event_id,
    eventName: row.event_name,
    eventStart: new Date(row.event_start),
    oddsApiEventId: row.odds_api_event_id ?? null,
    marketType: row.market_type as CanonicalMarket['marketType'],
    marketParam: row.market_param ?? null,
  }
}

// ─── Per-adapter timeout wrapper ──────────────────────────────────────────────

/**
 * Wraps an adapter's fetchMarket call with a per-adapter timeout.
 * If the adapter takes longer than ADAPTER_TIMEOUT_MS, resolves to null
 * (the adapter becomes a "missing book", never a hung request).
 */
function withTimeout<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

// ─── Analysis composition ─────────────────────────────────────────────────────

/**
 * Compose a MarketAnalysis from snapshots.
 * Reuses Phase 7 bestPrice/vigFor/noVigConsensus/preBetCLV — no re-implementation.
 */
function buildAnalysis(
  market: CanonicalMarket,
  snapshots: BookPriceSnapshot[],
): MarketAnalysis {
  // Collect unique sides from snapshots
  const sides = Array.from(new Set(snapshots.map((s) => s.side)))

  // Best price per side
  const bestPriceMap: Record<string, BookPriceSnapshot | null> = {}
  for (const side of sides) {
    bestPriceMap[side] = bestPrice(snapshots, side)
  }

  // No-vig consensus per side (Pinnacle-anchored)
  const noVigMap: Record<string, number | null> = {}
  for (const side of sides) {
    noVigMap[side] = noVigConsensus(snapshots, side, 'pinnacle')
  }

  // Per-book vig (informational — stored in analysis.vigFor conceptually)
  // The MarketAnalysis type doesn't have a vigFor map — we use bestPrice / noVig fields.

  // Pre-bet CLV: best price for each side vs no-vig consensus
  // Use the first side's best as the primary CLV signal (typically 'home' or 'over')
  let clv: number | null = null
  const primarySide = sides[0]
  if (primarySide) {
    const best = bestPriceMap[primarySide]
    const fair = noVigMap[primarySide]
    if (best && fair != null) {
      clv = preBetCLV(best, fair)
    }
  }

  // Arb detection — group sides pairwise (pre-filtered to same market_param).
  // Fee adjustment for Kalshi is applied inside detectArb at the price level (D-13).
  // On-demand threshold is 0 (show any arb regardless of size).
  let arbOpportunity = null
  if (sides.length >= 2) {
    const sideASnaps = snapshots.filter((s) => s.side === sides[0])
    const sideBSnaps = snapshots.filter((s) => s.side === sides[1])
    arbOpportunity = detectArb(sideASnaps, sideBSnaps, 0)
  }

  // Staleness: age of oldest snapshot in milliseconds
  const now = Date.now()
  let staleness = 0
  if (snapshots.length > 0) {
    const oldest = Math.min(...snapshots.map((s) =>
      s.fetchedAt instanceof Date ? s.fetchedAt.getTime() : new Date(s.fetchedAt).getTime()
    ))
    staleness = Math.max(0, now - oldest)
  }

  return {
    market,
    snapshots,
    bestPrice: bestPriceMap,
    noVigConsensus: noVigMap,
    preBetCLV: clv,
    arbOpportunity,
    staleness,
  }
}

// ─── Core orchestration (exported for tests) ──────────────────────────────────

/**
 * Core prices orchestration logic — exported separately from the HTTP handler
 * so unit tests can call it directly without spinning up a Vercel request.
 *
 * @param input - Either { market_id } or { parsedPick } + optional forceFresh
 */
export async function runPrices(
  input: PricesRequest,
): Promise<PricesResponse> {
  const { market_id, parsedPick, forceFresh = false } = input

  // ── 1. Resolve canonical market ───────────────────────────────────────────
  let market: CanonicalMarket | null = null

  if (market_id) {
    market = await resolveByMarketId(market_id)
  } else if (parsedPick) {
    market = await resolveByParsedPick(parsedPick)
  }

  if (!market) {
    // Return empty analysis when market cannot be resolved
    const emptyAnalysis: MarketAnalysis = {
      market: { id: '', sport: '', eventId: '', eventName: '', eventStart: new Date(), oddsApiEventId: null, marketType: 'moneyline', marketParam: null },
      snapshots: [],
      bestPrice: {},
      noVigConsensus: {},
      preBetCLV: null,
      arbOpportunity: null,
      staleness: 0,
    }
    return { snapshots: [], analysis: emptyAnalysis, missingBooks: [], staleness: 0 }
  }

  // ── 2. Run enabled adapters in parallel with per-adapter timeout ──────────
  const adapters = enabledAdapters()

  const results = await Promise.all(
    adapters.map((adapter) =>
      withTimeout(
        adapter.fetchMarket(market as CanonicalMarket, { forceFresh }),
        ADAPTER_TIMEOUT_MS,
      ),
    ),
  )

  // ── 3. Collect snapshots + missingBooks (BOOK-02) ─────────────────────────
  const snapshots: BookPriceSnapshot[] = []
  const missingBooks: string[] = []

  for (let i = 0; i < adapters.length; i++) {
    const adapterResult = results[i]
    if (adapterResult === null || adapterResult === undefined) {
      missingBooks.push(adapters[i].name)
    } else {
      snapshots.push(...adapterResult)
    }
  }

  // ── 4. Compose analysis (Phase 7 functions — no re-implementation) ────────
  const analysis = buildAnalysis(market, snapshots)

  return {
    snapshots,
    analysis,
    missingBooks,
    staleness: analysis.staleness,
  }
}

// ─── Vercel HTTP handler ──────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = req.body as PricesRequest
  if (!body?.market_id && !body?.parsedPick) {
    res.status(400).json({ error: 'Either market_id or parsedPick is required' })
    return
  }

  try {
    const result = await runPrices(body)
    res.status(200).json(result)
  } catch (err) {
    console.error('[prices] unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
