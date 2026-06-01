/**
 * Client-side mirror of the server line-shop types (api/_lib/line-shop/types.ts).
 * Pure TypeScript — NO imports from api/. Timestamps use string for JSON-serialised
 * API responses; components may widen to Date where needed.
 */

// ─── Union types ─────────────────────────────────────────────────────────────

export type BookName =
  | 'pinnacle'
  | 'bovada'
  | 'betus'
  | 'draftkings'
  | 'fanduel'
  | 'betmgm'
  | 'williamhill_us'
  | 'kalshi'
  | '7stacks'
  | 'odds_api'
  | 'betvegas23'
  | 'betrivers'
  | 'pointsbet'
  | 'foxbet'

/**
 * Canonical book set that should ALWAYS be present in the ArbScanner's
 * filter chips, regardless of whether a recent arb has been detected at
 * that book. Includes:
 *   - the 4 registered offshore-upload books (D-11), so the user can
 *     toggle 7stacks/betvegas23/bovada/betus on/off even before their
 *     first arb is detected.
 *   - the major US sportsbooks the user routinely shops at.
 *   - Kalshi.
 * Dynamic sources (recent-14d arb history, current rows) are unioned on
 * top so newly-appearing books from the Odds API feed are picked up too.
 */
export const KNOWN_LINE_SHOP_BOOKS: BookName[] = [
  '7stacks',
  'betmgm',
  'betrivers',
  'betus',
  'betvegas23',
  'bovada',
  'draftkings',
  'fanduel',
  'kalshi',
  'pinnacle',
  'pointsbet',
  'williamhill_us',
]

export type SourceConfidence = 'api' | 'aggregator' | 'scraped' | 'manual'

export type MarketType =
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'team_total'
  | 'runline'
  | 'puckline'
  | 'outright'

export type Side = 'home' | 'away' | 'over' | 'under' | 'yes' | 'no'

// ─── Canonical market identity ────────────────────────────────────────────────

export interface CanonicalMarket {
  id: string
  sport: string
  eventId: string
  eventName: string
  eventStart: Date | string
  oddsApiEventId: string | null
  marketType: MarketType
  marketParam: string | null
}

// ─── Per-book price snapshot ──────────────────────────────────────────────────

export interface BookPriceSnapshot {
  book: BookName
  side: Side
  priceAmerican: number
  /** Decimal odds derived from priceAmerican. */
  priceDecimal: number
  /**
   * RAW implied probability (with vig). Must never store devigged probability —
   * arb detection requires sum > 1.0 for a vigged market.
   */
  impliedProb: number
  point: number | null
  fetchedAt: Date | string
  sourceConfidence: SourceConfidence
  isClosing: boolean
}

// ─── Arb opportunity ─────────────────────────────────────────────────────────

export interface ArbOpportunity {
  sideA: BookPriceSnapshot
  sideB: BookPriceSnapshot
  /** Sum of the two best RAW implied probabilities. Must be < 1.0 for a valid arb. */
  sumRawImplied: number
  /** Guaranteed return % on a $100 total stake at equalized sizing. */
  totalReturnPct: number
  stakeA: number
  stakeB: number
  stakeAPct: number
  stakeBPct: number
  detectedAt: Date | string
}

// ─── Market-level analysis result ─────────────────────────────────────────────

export interface MarketAnalysis {
  market: CanonicalMarket
  snapshots: BookPriceSnapshot[]
  /** Best-priced snapshot keyed by side string; null when no snapshots exist for that side. */
  bestPrice: Record<string, BookPriceSnapshot | null>
  /** No-vig consensus probability keyed by side string; null when insufficient data. */
  noVigConsensus: Record<string, number | null>
  /** Pre-bet CLV vs. the no-vig consensus; null when consensus unavailable. */
  preBetCLV: number | null
  /** Detected arb opportunity across books; null when no arb exists. */
  arbOpportunity: ArbOpportunity | null
  /** Age of the oldest snapshot in milliseconds. */
  staleness: number
}
