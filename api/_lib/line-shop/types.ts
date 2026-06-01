/**
 * Shared types for the line-shop analysis layer.
 * Pure TypeScript — no runtime imports. Every later v3.0 phase imports from here.
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
  | 'betvegas23'   // Phase 11: DGS-PPH drop-in instance; registered-but-disabled until account exists
  | 'odds_api'

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
  id: string                    // UUID — markets.id
  sport: string                 // 'mlb','nhl','nba','nfl','golf' (lowercase)
  eventId: string               // e.g. 'MLB_20260521_MIL_CHC' or 'MLB_20260521_CHC_MIL_G2'
  eventName: string             // e.g. 'Brewers @ Cubs'
  eventStart: Date
  oddsApiEventId: string | null // soft ref to odds_snapshots.odds_event_id; no hard FK
  marketType: MarketType
  marketParam: string | null    // '-1.5', '8.5', null for moneyline
}

// ─── Per-book price snapshot ──────────────────────────────────────────────────

export interface BookPriceSnapshot {
  book: BookName
  side: Side
  priceAmerican: number
  /** Decimal odds derived from priceAmerican via americanToDecimal(). */
  priceDecimal: number
  /**
   * RAW implied probability (with vig) = impliedFromAmerican(priceAmerican).
   *
   * INVARIANT (D-02): This field MUST store the raw implied probability —
   * never a devigged / no-vig probability. Arb detection sums these values
   * and requires them to sum > 1.0 for a vigged market. Storing devigged
   * probs here causes false arb alerts on every normal market.
   */
  impliedProb: number
  /** Spread or total point value. Must match market.marketParam for arb grouping. */
  point: number | null
  fetchedAt: Date
  sourceConfidence: SourceConfidence
  /** True when this snapshot was captured after event_start (closing-line snapshot). */
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
  /** stakeA as a fraction of total stake (0–1). */
  stakeAPct: number
  /** stakeB as a fraction of total stake (0–1). */
  stakeBPct: number
  detectedAt: Date
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
