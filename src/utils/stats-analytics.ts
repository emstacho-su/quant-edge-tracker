// ---------------------------------------------------------------------------
// Stats analytics — pure compute functions
// Structured for future extraction to Supabase views/RPC
// ---------------------------------------------------------------------------

import type { Bet } from '@/lib/types'
import { parseBetLine } from './team-matcher'
import { getBetReportDay } from './daily-report'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ODDS_BRACKETS = [
  { key: 'heavy-fav', label: 'Heavy Fav', min: -Infinity, max: -300 },
  { key: 'moderate-fav', label: 'Mod Fav', min: -299, max: -150 },
  { key: 'slight-fav', label: 'Slight Fav', min: -149, max: -101 },
  { key: 'coin-flip', label: 'Coin Flip', min: -100, max: 100 },
  { key: 'slight-dog', label: 'Slight Dog', min: 101, max: 149 },
  { key: 'moderate-dog', label: 'Mod Dog', min: 150, max: 299 },
  { key: 'big-dog', label: 'Big Dog', min: 300, max: Infinity },
] as const

// ---------------------------------------------------------------------------
// Unit-size buckets. Boundaries are stake-to-unit-size ratios on half-open
// intervals [min, max), so every ratio falls into exactly one bucket. Ranges
// (rather than point buckets) make the conviction tiers easier to read and
// keep low-sample sizes from showing up as their own row.
// ---------------------------------------------------------------------------

export const UNIT_BUCKETS = [
  { key: 'lt-1u',  label: '<1u',  min: 0, max: 1 },
  { key: '1-2u',   label: '1–2u', min: 1, max: 2 },
  { key: '2-3u',   label: '2–3u', min: 2, max: 3 },
  { key: '3-5u',   label: '3–5u', min: 3, max: 5 },
  { key: '5u+',    label: '5u+',  min: 5, max: Infinity },
] as const

export type UnitBucketKey = (typeof UNIT_BUCKETS)[number]['key']

/**
 * Classify a bet by its stake-to-unit ratio. Returns the bucket key. Unit
 * size of 0 (or unset) returns null — caller should skip the bet.
 */
export function classifyUnitBucket(
  stake: number,
  unitSize: number,
): UnitBucketKey | null {
  if (!Number.isFinite(stake) || !Number.isFinite(unitSize) || unitSize <= 0) {
    return null
  }
  const ratio = stake / unitSize
  for (const b of UNIT_BUCKETS) {
    if (ratio >= b.min && ratio < b.max) return b.key
  }
  return UNIT_BUCKETS[UNIT_BUCKETS.length - 1].key
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EdgeRow {
  label: string
  totalBets: number
  wins: number
  losses: number
  actualWinRate: number   // 0-100
  expectedWinRate: number // 0-100
  edge: number            // actual - expected
  profitLoss: number
}

export interface BracketRow extends EdgeRow {
  bracketKey: string
}

export interface EdgeStats {
  overall: EdgeRow
  bySport: EdgeRow[]
  byBracket: BracketRow[]
}

export interface LineTypeRow {
  label: string
  bets: number
  wins: number
  losses: number
  pushes: number
  winPct: number
  expectedWinRate: number
  edge: number
  roi: number
  units: number
}

export interface TrendPoint {
  label: string
  actualWinRate: number
  expectedWinRate: number
  betsInPeriod: number
}

export interface DailyTrendPoint {
  label: string
  sortKey: number
  actualWinRate: number | null
  expectedWinRate: number | null
  betsInPeriod: number
}

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

/**
 * Convert American odds to implied probability (0–1).
 * No vig removal — raw implied probability. Beating vig = profit.
 *
 * Supabase migration: CREATE FUNCTION implied_probability(odds INT) RETURNS NUMERIC
 */
export function impliedProbability(oddsAmerican: number): number {
  if (oddsAmerican < 0) {
    return Math.abs(oddsAmerican) / (Math.abs(oddsAmerican) + 100)
  }
  return 100 / (oddsAmerican + 100)
}

/**
 * Classify American odds into a bracket key.
 *
 * Supabase migration: CREATE FUNCTION classify_odds_bracket(odds INT) RETURNS TEXT
 */
export function classifyOddsBracket(oddsAmerican: number): string {
  for (const bracket of ODDS_BRACKETS) {
    if (oddsAmerican >= bracket.min && oddsAmerican <= bracket.max) {
      return bracket.key
    }
  }
  return 'coin-flip'
}

// ---------------------------------------------------------------------------
// Edge stats
// ---------------------------------------------------------------------------

function buildEdgeRow(label: string, bets: readonly Bet[]): EdgeRow {
  const settled = bets.filter(
    (b) => (b.status === 'won' || b.status === 'lost') && b.odds_american != null,
  )

  const wins = settled.filter((b) => b.status === 'won').length
  const losses = settled.filter((b) => b.status === 'lost').length
  const decided = wins + losses
  const actualWinRate = decided > 0 ? (wins / decided) * 100 : 0

  const expectedWinRate =
    decided > 0
      ? (settled.reduce((sum, b) => sum + impliedProbability(b.odds_american!), 0) /
          decided) *
        100
      : 0

  const profitLoss = settled.reduce((sum, b) => sum + (b.profit_loss ?? 0), 0)

  return {
    label,
    totalBets: decided,
    wins,
    losses,
    actualWinRate,
    expectedWinRate,
    edge: actualWinRate - expectedWinRate,
    profitLoss,
  }
}

/**
 * Compute edge stats: overall, by sport, and by odds bracket.
 *
 * Supabase migration:
 *   CREATE VIEW edge_stats_by_sport AS SELECT sport, ...
 *   CREATE VIEW edge_stats_by_bracket AS SELECT classify_odds_bracket(odds_american), ...
 */
export function computeEdgeStats(bets: readonly Bet[]): EdgeStats {
  const withOdds = bets.filter(
    (b) => b.odds_american != null && b.bet_type === 'single',
  )

  const overall = buildEdgeRow('Overall', withOdds)

  // By sport
  const sportGroups = new Map<string, Bet[]>()
  for (const bet of withOdds) {
    const group = sportGroups.get(bet.sport) ?? []
    group.push(bet)
    sportGroups.set(bet.sport, group)
  }
  const bySport = Array.from(sportGroups.entries())
    .map(([sport, group]) => buildEdgeRow(sport, group))
    .filter((r) => r.totalBets > 0)
    .sort((a, b) => b.edge - a.edge)

  // By bracket
  const bracketGroups = new Map<string, Bet[]>()
  for (const bet of withOdds) {
    if (bet.odds_american == null) continue
    const key = classifyOddsBracket(bet.odds_american)
    const group = bracketGroups.get(key) ?? []
    group.push(bet)
    bracketGroups.set(key, group)
  }
  const byBracket: BracketRow[] = ODDS_BRACKETS.map((bracket) => {
    const group = bracketGroups.get(bracket.key) ?? []
    const row = buildEdgeRow(bracket.label, group)
    return { ...row, bracketKey: bracket.key }
  })

  return { overall, bySport, byBracket }
}

// ---------------------------------------------------------------------------
// Line type performance
// ---------------------------------------------------------------------------

function classifyLineType(bet: Bet): string {
  if (bet.bet_type === 'parlay') return 'Parlay'
  const parsed = parseBetLine(bet.description)
  switch (parsed.lineType) {
    case 'moneyline':
      return 'Moneyline'
    case 'spread':
      return 'Spread'
    case 'over':
      return 'Over'
    case 'under':
      return 'Under'
    default:
      return 'Other'
  }
}

/**
 * Break down performance by line type (ML, spread, O/U, parlay).
 *
 * Supabase migration: CREATE VIEW performance_by_line_type AS ...
 */
export function computeLineTypePerformance(
  bets: readonly Bet[],
  unitSize: number,
): LineTypeRow[] {
  const groups = new Map<
    string,
    {
      bets: number
      wins: number
      losses: number
      pushes: number
      pl: number
      stake: number
      impliedProbSum: number
      decidedWithOdds: number
    }
  >()

  for (const bet of bets) {
    const key = classifyLineType(bet)
    const cur = groups.get(key) ?? {
      bets: 0, wins: 0, losses: 0, pushes: 0,
      pl: 0, stake: 0, impliedProbSum: 0, decidedWithOdds: 0,
    }

    cur.bets += 1
    if (bet.status === 'won') cur.wins += 1
    if (bet.status === 'lost') cur.losses += 1
    if (bet.status === 'push') cur.pushes += 1
    cur.pl += bet.profit_loss ?? 0
    cur.stake += bet.stake

    if (
      (bet.status === 'won' || bet.status === 'lost') &&
      bet.odds_american != null
    ) {
      cur.impliedProbSum += impliedProbability(bet.odds_american)
      cur.decidedWithOdds += 1
    }

    groups.set(key, cur)
  }

  const order = ['Moneyline', 'Spread', 'Over', 'Under', 'Parlay', 'Other']

  return Array.from(groups.entries())
    .map(([label, s]) => {
      const decided = s.wins + s.losses
      const winPct = decided > 0 ? (s.wins / decided) * 100 : 0
      const expectedWinRate =
        s.decidedWithOdds > 0
          ? (s.impliedProbSum / s.decidedWithOdds) * 100
          : 0
      return {
        label,
        bets: s.bets,
        wins: s.wins,
        losses: s.losses,
        pushes: s.pushes,
        winPct,
        expectedWinRate,
        edge: s.decidedWithOdds > 0 ? winPct - expectedWinRate : 0,
        roi: s.stake > 0 ? (s.pl / s.stake) * 100 : 0,
        units: unitSize > 0 ? s.pl / unitSize : 0,
      }
    })
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
}

// ---------------------------------------------------------------------------
// Unit-size performance
// ---------------------------------------------------------------------------

export interface UnitBucketRow {
  bucketKey: UnitBucketKey
  label: string
  bets: number
  wins: number
  losses: number
  pushes: number
  winPct: number          // 0-100
  expectedWinRate: number // 0-100
  edge: number            // actual - expected, percentage points
  roi: number             // (pl / stake) * 100
  units: number           // pl / unitSize
  profitLoss: number
  totalStake: number
  avgStake: number
}

/**
 * Break down performance by unit-size bucket. Excludes parlays (variance
 * dominates the bucket signal) and freeplays (no cash stake to bucket on).
 *
 * Supabase migration: CREATE VIEW performance_by_unit_size AS ...
 */
export function computeUnitSizePerformance(
  bets: readonly Bet[],
  unitSize: number,
): UnitBucketRow[] {
  if (unitSize <= 0) return []

  const groups = new Map<
    UnitBucketKey,
    {
      bets: number
      wins: number
      losses: number
      pushes: number
      pl: number
      stake: number
      impliedProbSum: number
      decidedWithOdds: number
    }
  >()

  for (const bet of bets) {
    if (bet.bet_type === 'parlay') continue
    if (bet.is_freeplay) continue

    const key = classifyUnitBucket(bet.stake, unitSize)
    if (!key) continue

    const cur = groups.get(key) ?? {
      bets: 0, wins: 0, losses: 0, pushes: 0,
      pl: 0, stake: 0, impliedProbSum: 0, decidedWithOdds: 0,
    }

    cur.bets += 1
    if (bet.status === 'won') cur.wins += 1
    if (bet.status === 'lost') cur.losses += 1
    if (bet.status === 'push') cur.pushes += 1
    cur.pl += bet.profit_loss ?? 0
    cur.stake += bet.stake

    if (
      (bet.status === 'won' || bet.status === 'lost') &&
      bet.odds_american != null
    ) {
      cur.impliedProbSum += impliedProbability(bet.odds_american)
      cur.decidedWithOdds += 1
    }

    groups.set(key, cur)
  }

  return UNIT_BUCKETS.map((bucket) => {
    const s = groups.get(bucket.key) ?? {
      bets: 0, wins: 0, losses: 0, pushes: 0,
      pl: 0, stake: 0, impliedProbSum: 0, decidedWithOdds: 0,
    }
    const decided = s.wins + s.losses
    const winPct = decided > 0 ? (s.wins / decided) * 100 : 0
    const expectedWinRate =
      s.decidedWithOdds > 0
        ? (s.impliedProbSum / s.decidedWithOdds) * 100
        : 0
    return {
      bucketKey: bucket.key,
      label: bucket.label,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      winPct,
      expectedWinRate,
      edge: s.decidedWithOdds > 0 ? winPct - expectedWinRate : 0,
      roi: s.stake > 0 ? (s.pl / s.stake) * 100 : 0,
      units: s.pl / unitSize,
      profitLoss: s.pl,
      totalStake: s.stake,
      avgStake: s.bets > 0 ? s.stake / s.bets : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Win rate trend (weekly buckets)
// ---------------------------------------------------------------------------

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day) // Sunday start
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Build weekly win rate trend: actual vs expected.
 *
 * Supabase migration:
 *   SELECT date_trunc('week', settled_at), avg(...) FROM bets GROUP BY 1
 */
export function computeWinRateTrend(bets: readonly Bet[]): TrendPoint[] {
  const settled = bets.filter(
    (b) =>
      (b.status === 'won' || b.status === 'lost') &&
      b.settled_at != null &&
      b.odds_american != null,
  )

  if (settled.length === 0) return []

  const sorted = [...settled].sort(
    (a, b) => new Date(a.settled_at!).getTime() - new Date(b.settled_at!).getTime(),
  )

  // Group by week
  const weeks = new Map<
    string,
    { wins: number; total: number; impliedProbSum: number; sortKey: number }
  >()

  for (const bet of sorted) {
    const date = new Date(bet.settled_at!)
    const weekLabel = getWeekStart(date)
    const cur = weeks.get(weekLabel) ?? {
      wins: 0, total: 0, impliedProbSum: 0,
      sortKey: date.getTime(),
    }

    cur.total += 1
    if (bet.status === 'won') cur.wins += 1
    cur.impliedProbSum += impliedProbability(bet.odds_american!)
    // Keep earliest date as sort key
    if (date.getTime() < cur.sortKey) cur.sortKey = date.getTime()

    weeks.set(weekLabel, cur)
  }

  return Array.from(weeks.entries())
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([label, w]) => ({
      label,
      actualWinRate: w.total > 0 ? (w.wins / w.total) * 100 : 0,
      expectedWinRate: w.total > 0 ? (w.impliedProbSum / w.total) * 100 : 0,
      betsInPeriod: w.total,
    }))
}

// ---------------------------------------------------------------------------
// Win rate trend (daily buckets with rolling average)
// ---------------------------------------------------------------------------

/**
 * Build daily win rate trend — actual vs expected per calendar day.
 * A day with no settled bets produces a null value for that day.
 */
export function computeDailyWinRateTrend(
  bets: readonly Bet[],
): DailyTrendPoint[] {
  const settled = bets.filter(
    (b) =>
      (b.status === 'won' || b.status === 'lost') &&
      b.settled_at != null &&
      b.odds_american != null,
  )

  if (settled.length === 0) return []

  const days = new Map<
    string,
    {
      wins: number
      total: number
      impliedProbSum: number
      sortKey: number
      label: string
    }
  >()

  for (const bet of settled) {
    const dayKey = getBetReportDay(bet) // 'YYYY-MM-DD' in ET (placed-at by default)
    const [y, m, d] = dayKey.split('-').map(Number)
    const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
    const label = anchor.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    const sortKey = anchor.getTime()
    const cur = days.get(dayKey) ?? {
      wins: 0,
      total: 0,
      impliedProbSum: 0,
      sortKey,
      label,
    }

    cur.total += 1
    if (bet.status === 'won') cur.wins += 1
    cur.impliedProbSum += impliedProbability(bet.odds_american!)

    days.set(dayKey, cur)
  }

  return Array.from(days.values())
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((d) => ({
      label: d.label,
      sortKey: d.sortKey,
      actualWinRate: d.total > 0 ? (d.wins / d.total) * 100 : null,
      expectedWinRate: d.total > 0 ? (d.impliedProbSum / d.total) * 100 : null,
      betsInPeriod: d.total,
    }))
}

// ---------------------------------------------------------------------------
// Existing helpers (extracted from Stats.tsx for reuse)
// ---------------------------------------------------------------------------

export function computeStats(bets: readonly Bet[]) {
  const settled = bets.filter((b) => b.status !== 'pending')
  const wins = settled.filter((b) => b.status === 'won').length
  const losses = settled.filter((b) => b.status === 'lost').length
  const pushes = settled.filter((b) => b.status === 'push').length
  const decided = wins + losses
  const winRate = decided > 0 ? (wins / decided) * 100 : 0

  const totalCashWagered = bets
    .filter((b) => !b.is_freeplay)
    .reduce((s, b) => s + b.stake, 0)
  const totalFpWagered = bets
    .filter((b) => b.is_freeplay)
    .reduce((s, b) => s + b.stake, 0)
  const totalWagered = totalCashWagered + totalFpWagered

  const totalPl = settled.reduce((s, b) => s + (b.profit_loss ?? 0), 0)
  const cashPl = settled
    .filter((b) => !b.is_freeplay)
    .reduce((s, b) => s + (b.profit_loss ?? 0), 0)
  const fpPl = settled
    .filter((b) => b.is_freeplay)
    .reduce((s, b) => s + (b.profit_loss ?? 0), 0)
  const roi = totalCashWagered > 0 ? (cashPl / totalCashWagered) * 100 : 0
  const avgStake = bets.length > 0 ? totalWagered / bets.length : 0
  const biggestWin = settled.reduce(
    (max, b) => Math.max(max, b.profit_loss ?? 0),
    0,
  )
  const biggestLoss = settled.reduce(
    (min, b) => Math.min(min, b.profit_loss ?? 0),
    0,
  )
  const pending = bets.filter((b) => b.status === 'pending').length

  // Edge: expected win rate from odds
  const withOdds = settled.filter(
    (b) =>
      (b.status === 'won' || b.status === 'lost') && b.odds_american != null,
  )
  const expectedWinRate =
    withOdds.length > 0
      ? (withOdds.reduce(
          (sum, b) => sum + impliedProbability(b.odds_american!),
          0,
        ) /
          withOdds.length) *
        100
      : 0
  const edge = withOdds.length > 0 ? winRate - expectedWinRate : 0

  return {
    total: bets.length,
    wins,
    losses,
    pushes,
    winRate,
    totalWagered,
    totalCashWagered,
    totalFpWagered,
    totalPl,
    cashPl,
    fpPl,
    roi,
    avgStake,
    biggestWin,
    biggestLoss,
    pending,
    expectedWinRate,
    edge,
  }
}

export function buildCumulativePl(
  bets: readonly Bet[],
): { date: string; pl: number; sortKey: number }[] {
  const settled = bets.filter(
    (b) => b.status !== 'pending' && b.status !== 'void' && b.settled_at && b.profit_loss !== null,
  )

  // Bucket by report day (ET, 16hr rule), then label the bucket by month/day
  const dailyMap = new Map<string, { label: string; pl: number; sortKey: string }>()
  for (const bet of settled) {
    const reportDay = getBetReportDay(bet) // 'YYYY-MM-DD' in ET
    const [y, m, d] = reportDay.split('-').map(Number)
    const label = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
    const cur = dailyMap.get(reportDay) ?? { label, pl: 0, sortKey: reportDay }
    cur.pl += bet.profit_loss ?? 0
    dailyMap.set(reportDay, cur)
  }

  let cumulative = 0
  return Array.from(dailyMap.values())
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ label, pl, sortKey }) => {
      cumulative += pl
      const [y, m, d] = sortKey.split('-').map(Number)
      const sortKeyMs = Date.UTC(y, m - 1, d, 12, 0, 0)
      return {
        date: label,
        pl: Math.round(cumulative * 100) / 100,
        sortKey: sortKeyMs,
      }
    })
}

export interface PerformanceRow {
  label: string
  bets: number
  wins: number
  losses: number
  pushes: number
  winPct: number
  expectedWinRate: number
  edge: number
  roi: number
  units: number
}

export function computeSportPerformance(
  bets: readonly Bet[],
  unitSize: number,
): PerformanceRow[] {
  const groups = new Map<
    string,
    {
      bets: number
      wins: number
      losses: number
      pushes: number
      pl: number
      stake: number
      impliedProbSum: number
      decidedWithOdds: number
    }
  >()

  for (const bet of bets) {
    const key = bet.sport
    const cur = groups.get(key) ?? {
      bets: 0, wins: 0, losses: 0, pushes: 0,
      pl: 0, stake: 0, impliedProbSum: 0, decidedWithOdds: 0,
    }
    cur.bets += 1
    if (bet.status === 'won') cur.wins += 1
    if (bet.status === 'lost') cur.losses += 1
    if (bet.status === 'push') cur.pushes += 1
    cur.pl += bet.profit_loss ?? 0
    cur.stake += bet.stake

    if (
      (bet.status === 'won' || bet.status === 'lost') &&
      bet.odds_american != null
    ) {
      cur.impliedProbSum += impliedProbability(bet.odds_american)
      cur.decidedWithOdds += 1
    }

    groups.set(key, cur)
  }

  return Array.from(groups.entries())
    .map(([label, s]) => {
      const decided = s.wins + s.losses
      const winPct = decided > 0 ? (s.wins / decided) * 100 : 0
      const expectedWinRate =
        s.decidedWithOdds > 0
          ? (s.impliedProbSum / s.decidedWithOdds) * 100
          : 0
      return {
        label,
        bets: s.bets,
        wins: s.wins,
        losses: s.losses,
        pushes: s.pushes,
        winPct,
        expectedWinRate,
        edge: s.decidedWithOdds > 0 ? winPct - expectedWinRate : 0,
        roi: s.stake > 0 ? (s.pl / s.stake) * 100 : 0,
        units: unitSize > 0 ? s.pl / unitSize : 0,
      }
    })
    .sort((a, b) => b.units - a.units)
}
