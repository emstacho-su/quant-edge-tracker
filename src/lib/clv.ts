/**
 * CLV / no-vig math + helpers (client). Mirrors api/_lib/clv.ts.
 */

import { kalshiEffectiveImpliedProb } from './kalshi-fee'

export function americanToDecimal(a: number): number {
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1
}

export function impliedFromAmerican(a: number): number {
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100)
}

export function noVigProb(aPrice: number, bPrice: number): number {
  const pa = impliedFromAmerican(aPrice)
  const pb = impliedFromAmerican(bPrice)
  const sum = pa + pb
  return sum > 0 ? pa / sum : pa
}

/** No-vig fair prob of a selection over all outcomes of a market (2-way or 3-way). */
export function noVigMulti(youPrice: number, allPrices: number[]): number {
  const pYou = impliedFromAmerican(youPrice)
  const sum = allPrices.reduce((s, p) => s + impliedFromAmerican(p), 0)
  return sum > 0 ? pYou / sum : pYou
}

function normName(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Shared significant-token count between two team/player names. */
export function matchScore(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter((t) => t.length > 2))
  let n = 0
  for (const t of normName(b).split(' ').filter((t) => t.length > 2)) if (ta.has(t)) n++
  return n
}

export function clvPct(yourAmerican: number, closeFairProb: number): number {
  if (!closeFairProb) return 0
  return americanToDecimal(yourAmerican) / (1 / closeFairProb) - 1
}

export function formatPct(x: number | null | undefined, digits = 1): string {
  if (x == null) return '—'
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
}

export function formatOdds(a: number | null | undefined): string {
  if (a == null) return '—'
  return a > 0 ? `+${a}` : String(a)
}

/** Fair American odds implied by a probability (inverse of impliedFromAmerican). */
export function probToAmerican(p: number): number {
  if (!(p > 0 && p < 1)) return NaN
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p)
}

// --- MLB team nickname resolver (mirror of api/_lib/mlb-teams.ts) ----------
const TOKENS: Array<[string, string]> = [
  ['red sox', 'redsox'], ['white sox', 'whitesox'], ['blue jays', 'bluejays'],
  ['diamondbacks', 'diamondbacks'], ['d-backs', 'diamondbacks'], ['dbacks', 'diamondbacks'],
  ['braves', 'braves'], ['orioles', 'orioles'], ['cubs', 'cubs'], ['reds', 'reds'],
  ['guardians', 'guardians'], ['rockies', 'rockies'], ['tigers', 'tigers'], ['astros', 'astros'],
  ['royals', 'royals'], ['angels', 'angels'], ['dodgers', 'dodgers'], ['marlins', 'marlins'],
  ['brewers', 'brewers'], ['twins', 'twins'], ['mets', 'mets'], ['yankees', 'yankees'],
  ['athletics', 'athletics'], ['phillies', 'phillies'], ['pirates', 'pirates'], ['padres', 'padres'],
  ['giants', 'giants'], ['mariners', 'mariners'], ['cardinals', 'cardinals'], ['rays', 'rays'],
  ['rangers', 'rangers'], ['nationals', 'nationals'],
]

export function canonicalNick(s: string | null | undefined): string | null {
  if (!s) return null
  const low = s.toLowerCase()
  for (const [token, canon] of TOKENS) if (low.includes(token)) return canon
  return null
}

// --- Line-movement series --------------------------------------------------
export interface OddsSnapshot {
  id: string
  odds_event_id: string
  commence_time: string | null
  home_team: string | null
  away_team: string | null
  bookmaker: string
  market: string
  selection: string
  point: number | null
  price_american: number
  captured_at: string
}

export interface FairPoint { t: number; fair: number }

/**
 * Build the bet-side no-vig fair-probability series from Pinnacle snapshots
 * (groups the two outcomes per capture time, de-vigs, picks the bet's side).
 */
export function buildFairSeries(
  snaps: OddsSnapshot[],
  betSelection: string,
  marketKey: string,
): FairPoint[] {
  const byTime = new Map<string, OddsSnapshot[]>()
  for (const s of snaps) {
    if (s.bookmaker !== 'pinnacle') continue
    if (s.market !== marketKey) continue
    const arr = byTime.get(s.captured_at) ?? []
    arr.push(s)
    byTime.set(s.captured_at, arr)
  }
  const out: FairPoint[] = []
  for (const [t, group] of byTime) {
    if (group.length < 2) continue
    let you = group[0]
    let best = 0
    for (const o of group) {
      const sc = matchScore(o.selection, betSelection)
      if (sc > best) {
        best = sc
        you = o
      }
    }
    if (best < 1) continue
    out.push({
      t: new Date(t).getTime(),
      fair: noVigMulti(you.price_american, group.map((g) => g.price_american)),
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Single-price outright (e.g. golf) movement: raw implied prob over time for the
 * bet's selection. No de-vig — each snapshot is one outcome. Outright snapshots
 * are written one-per-tick by the cron's golf pass (unique captured_at each tick),
 * and the tracked book can vary tick-to-tick, so the series is a rough cross-book
 * movement view rather than a single-book line. Intentional — do not filter by book.
 */
export function buildOutrightSeries(
  snaps: OddsSnapshot[],
  betSelection: string,
  marketKey = 'outrights',
): FairPoint[] {
  const out: FairPoint[] = []
  for (const s of snaps) {
    if (s.market !== marketKey) continue
    if (matchScore(s.selection, betSelection) < 1) continue
    out.push({ t: new Date(s.captured_at).getTime(), fair: impliedFromAmerican(s.price_american) })
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * Newest snapshot price for a given book + selection (+ exact point for
 * spread/total). Powers the current DraftKings / BetMGM cells. Null if absent.
 */
export function latestBookPrice(
  snaps: OddsSnapshot[],
  opts: { bookmaker: string; selection: string; market: string; point?: number | null },
): number | null {
  let best: OddsSnapshot | null = null
  for (const s of snaps) {
    if (s.bookmaker !== opts.bookmaker) continue
    if (s.market !== opts.market) continue
    if (opts.point != null && s.point !== opts.point) continue
    if (matchScore(s.selection, opts.selection) < 1) continue
    // newest wins; ties (equal captured_at) resolve to the last-seen row (array order)
    if (!best || new Date(s.captured_at).getTime() >= new Date(best.captured_at).getTime()) best = s
  }
  return best ? best.price_american : null
}

// --- Bet market → snapshot market key ---------------------------------------
const SNAPSHOT_MARKET: Record<string, string> = {
  moneyline: 'h2h', spread: 'spreads', runline: 'spreads', puckline: 'spreads',
  total: 'totals', team_total: 'team_totals', outright: 'outrights',
}
export function marketKeyForBet(clvMarket: string | null | undefined): string {
  return SNAPSHOT_MARKET[(clvMarket ?? '').toLowerCase().trim()] ?? 'h2h'
}

/** Signed American-odds "cents" gap vs fair. + = you're worse than fair, − = you beat fair.
 *  null when the two prices straddle even money (sign mismatch) — caller falls back to %. */
export function centsVsFair(yourAmerican: number, fairAmerican: number): number | null {
  const sameSign = (yourAmerican < 0) === (fairAmerican < 0)
  if (!sameSign) return null
  return yourAmerican < 0
    ? Math.abs(yourAmerican) - Math.abs(fairAmerican) // favorites: bigger magnitude = worse
    : fairAmerican - yourAmerican                      // dogs: smaller payout = worse
}

/** Best currently-available price for a side (highest decimal), newest snapshot per book,
 *  excluding the listed books (Pinnacle is the fair anchor, not a bettable "best").
 *
 *  Freshness-aware: a book whose newest matching snapshot is older than `freshnessMs`
 *  behind the latest tick is dropped — this rejects stale one-off rows (e.g. the daily
 *  odds-slate dump's exchange/EU books) so "best available" reflects prices live *now*. */
export function bestAvailable(
  snaps: OddsSnapshot[],
  opts: { selection: string; market: string; point?: number | null; exclude?: string[]; include?: string[]; freshnessMs?: number },
): { book: string; price: number } | null {
  const exclude = new Set(opts.exclude ?? [])
  const include = opts.include ? new Set(opts.include) : null
  const freshnessMs = opts.freshnessMs ?? 60 * 60_000
  const matching = snaps.filter(
    (s) =>
      !exclude.has(s.bookmaker) &&
      (include == null || include.has(s.bookmaker)) &&
      s.market === opts.market &&
      (opts.point == null || s.point === opts.point) &&
      matchScore(s.selection, opts.selection) >= 1,
  )
  if (matching.length === 0) return null
  const latest = Math.max(...matching.map((s) => new Date(s.captured_at).getTime()))
  const byBook = new Map<string, OddsSnapshot>()
  for (const s of matching) {
    const t = new Date(s.captured_at).getTime()
    if (latest - t > freshnessMs) continue // drop books whose freshest price is stale
    const cur = byBook.get(s.bookmaker)
    if (!cur || t >= new Date(cur.captured_at).getTime()) byBook.set(s.bookmaker, s)
  }
  // D-13: fee-adjust Kalshi prices before comparison so its contribution to the
  // sharp-subset reference reflects the effective taker cost, not the raw ask.
  // effectiveDecimalFor: computes fee-adjusted decimal for Kalshi, raw decimal for others.
  // Do NOT mutate the byBook map — adjusted copies only.
  function effectiveDecimalFor(s: OddsSnapshot): number {
    const rawDec = americanToDecimal(s.price_american)
    if (s.bookmaker !== 'kalshi') return rawDec
    // Kalshi: P = 1/rawDec; P_eff = kalshiEffectiveImpliedProb(P); decimalEff = 1/P_eff
    const p = 1 / rawDec
    const pEff = kalshiEffectiveImpliedProb(p)
    return 1 / pEff
  }

  let best: { book: string; price: number } | null = null
  for (const s of byBook.values()) {
    const dec = effectiveDecimalFor(s)
    const bestDec = best ? americanToDecimal(best.price) : -Infinity
    if (dec > bestDec) {
      // Return fee-adjusted American for Kalshi so PLM callers use the true effective rate.
      // For all other books, return the raw American price unchanged.
      const effectiveAmerican = s.bookmaker === 'kalshi'
        ? (dec >= 2 ? (dec - 1) * 100 : -(100 / (dec - 1)))
        : s.price_american
      best = { book: s.bookmaker, price: effectiveAmerican }
    }
  }
  return best
}

export interface LadderMarker { key: string; impliedProb: number }
/** Map markers' implied probs to x in [0,1]; lower implied (better value) = smaller x (left). */
export function ladderPositions<T extends LadderMarker>(
  markers: T[],
  pad = 0.12,
): Array<T & { x: number }> {
  const probs = markers.map((m) => m.impliedProb)
  const lo = Math.min(...probs)
  const hi = Math.max(...probs)
  const span = hi - lo || 1
  const min = lo - span * pad
  const max = hi + span * pad
  return markers.map((m) => ({ ...m, x: (m.impliedProb - min) / (max - min) }))
}

/** Plain-language verdict line for the card. Uses cents when both prices share a sign,
 *  otherwise falls back to the CLV percentage. */
export function verdictText(opts: {
  yourAmerican: number
  fairAmerican: number | null
  clvPct: number | null
  state: 'tracking' | 'locked'
}): string {
  const { yourAmerican, fairAmerican, clvPct, state } = opts
  if (fairAmerican == null || clvPct == null) return 'Awaiting the line.'
  const worse = clvPct < 0
  const cents = centsVsFair(yourAmerican, fairAmerican)
  const mag = cents != null ? `${Math.abs(cents)}¢` : `${Math.abs(clvPct * 100).toFixed(1)}%`
  if (state === 'locked') {
    return worse
      ? `✗ Missed the close — ${mag} worse than the closing line.`
      : `✓ Beat the close — ${mag} better than the closing line.`
  }
  return worse
    ? `You're paying ${mag} over the fair price.`
    : `You're getting ${mag} better than fair.`
}

// --- Positive Line Movement (PLM) -------------------------------------------
/** Sharp/major book subset for the PLM "best available" reference. Caesars =
 *  williamhill_us in The Odds API. Pinnacle's *actual* (vigged) price is eligible
 *  here — distinct from the no-vig fair derived from it. Kalshi is a CFTC-
 *  regulated event-contracts exchange (h2h-only); its ask price IS the implied
 *  probability so it's a clean sharp reference. */
export const SHARP_BOOKS = ['pinnacle', 'kalshi', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us'] as const

/** Does this bet have a Pinnacle-anchored no-vig reference (closing_fair_prob)?
 *  Bets without one — props, exotics, markets where Pinnacle was absent — are
 *  bucketed separately on /clv and NOT aggregated with main-market CLV stats.
 *  Andrews/Unabated's "CLV is meaningless in props" failure mode. */
export function hasNoVigAnchor(bet: {
  closing_fair_prob?: number | null
  clv_pct?: number | null
}): boolean {
  return bet.closing_fair_prob != null || bet.clv_pct != null
}

/** Where PLM measures "the line now." Default 'subset' (best across SHARP_BOOKS);
 *  flip to 'entry_book' or 'pinnacle' here if the subset benchmark reads too negative. */
export type PlmReference = 'subset' | 'entry_book' | 'pinnacle'
export const PLM_REFERENCE: PlmReference = 'subset'

/** PLM% = your payout decimal / best-available decimal − 1.
 *  + ⇒ your locked price pays more than the best available now ⇒ line moved your way. */
export function plmPct(yourAmerican: number, bestAmerican: number): number {
  return americanToDecimal(yourAmerican) / americanToDecimal(bestAmerican) - 1
}

/** PLM in probability points = best-available implied − your entry implied.
 *  + ⇒ favorable (your price implies a lower probability than the best now). */
export function plmProbPoints(yourAmerican: number, bestAmerican: number): number {
  return impliedFromAmerican(bestAmerican) - impliedFromAmerican(yourAmerican)
}

/** Plain-language PLM verdict. Uses cents when your price and the best share a sign,
 *  otherwise falls back to the PLM percentage. */
export function plmVerdictText(opts: {
  yourAmerican: number
  bestAmerican: number | null
  bestBook?: string | null
  plmPct: number | null
  state: 'tracking' | 'locked'
}): string {
  const { yourAmerican, bestAmerican, bestBook, plmPct: pct, state } = opts
  if (bestAmerican == null || pct == null) return 'Awaiting the line.'
  const favorable = pct >= 0
  const cents = centsVsFair(yourAmerican, bestAmerican)
  const mag = cents != null ? `${Math.abs(cents)}¢` : `${Math.abs(pct * 100).toFixed(1)}%`
  if (state === 'locked') {
    return favorable
      ? `✓ Line moved your way — beat the closing market by ${mag}.`
      : `✗ Line moved against you — closing best was ${mag} better.`
  }
  const book = bestBook ? ` @ ${bestBook}` : ''
  return favorable
    ? `Your price beats the market best (${formatOdds(bestAmerican)}${book}) by ${mag}.`
    : `You'd get ${mag} better elsewhere now (${formatOdds(bestAmerican)}${book}).`
}
