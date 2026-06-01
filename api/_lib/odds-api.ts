/**
 * The Odds API client (server-side). Pinnacle is included via the `eu` region.
 * Credit cost per /odds call = (#markets) × (#regions).
 */
const BASE = 'https://api.the-odds-api.com/v4'

export interface OddsOutcome { name: string; price: number; point?: number; description?: string }
export interface OddsMarket { key: string; outcomes: OddsOutcome[] }
export interface OddsBookmaker { key: string; title: string; last_update: string; markets: OddsMarket[] }
export interface OddsEvent {
  id: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

export interface OddsFetchResult {
  events: OddsEvent[]
  creditsRemaining: number | null
  creditsUsed: number | null
}

export async function fetchSportOdds(
  sportKey: string,
  markets = 'h2h,spreads',
  regions = 'us,eu',
): Promise<OddsFetchResult> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const url =
    `${BASE}/sports/${sportKey}/odds?apiKey=${key}` +
    `&regions=${regions}&markets=${markets}&oddsFormat=american&dateFormat=iso`
  const res = await fetch(url)
  const creditsRemaining = numOrNull(res.headers.get('x-requests-remaining'))
  const creditsUsed = numOrNull(res.headers.get('x-requests-used'))
  if (!res.ok) {
    throw new Error(`Odds API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const events = (await res.json()) as OddsEvent[]
  return { events, creditsRemaining, creditsUsed }
}

function numOrNull(s: string | null): number | null {
  if (s == null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Pull a bookmaker's outcomes for a market key from an event. */
export function bookMarket(
  event: OddsEvent,
  bookmakerKey: string,
  marketKey: string,
): OddsOutcome[] | null {
  const bk = event.bookmakers.find((b) => b.key === bookmakerKey)
  if (!bk) return null
  const mk = bk.markets.find((m) => m.key === marketKey)
  return mk ? mk.outcomes : null
}

/** List active Odds API sport keys in a group (e.g. 'Tennis', 'Golf'). 0 credits. */
export async function fetchActiveSportKeysByGroup(group: string): Promise<string[]> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const res = await fetch(`${BASE}/sports?apiKey=${key}&all=false`)
  if (!res.ok) return []
  const sports = (await res.json()) as Array<{ key: string; group: string; active: boolean }>
  return sports.filter((s) => s.group === group && s.active).map((s) => s.key)
}

/** Free (0-credit) list of a sport's upcoming events (id + teams + commence). */
export async function fetchSportEvents(sportKey: string): Promise<OddsEvent[]> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const res = await fetch(`${BASE}/sports/${sportKey}/events?apiKey=${key}&dateFormat=iso`)
  if (!res.ok) return []
  return (await res.json()) as OddsEvent[]
}

/** Per-event odds for specific markets (player props / team_totals). Billed per
 *  event = (#markets) × (#regions). */
export async function fetchEventOdds(
  sportKey: string,
  eventId: string,
  markets: string,
  regions = 'us,eu',
): Promise<OddsFetchResult> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const url =
    `${BASE}/sports/${sportKey}/events/${eventId}/odds?apiKey=${key}` +
    `&regions=${regions}&markets=${markets}&oddsFormat=american&dateFormat=iso`
  const res = await fetch(url)
  const creditsRemaining = numOrNull(res.headers.get('x-requests-remaining'))
  const creditsUsed = numOrNull(res.headers.get('x-requests-used'))
  if (!res.ok) throw new Error(`Odds API event ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const ev = (await res.json()) as OddsEvent
  return { events: [ev], creditsRemaining, creditsUsed }
}

// ── Historical endpoint (Phase 15 backtest) ─────────────────────────────────────
// The /v4/historical endpoints wrap results in a snapshot envelope { timestamp,
// previous_timestamp, next_timestamp, data } — unlike the live endpoints which
// return a bare array/object. Historical bills MORE than live (markets × regions ×
// a historical multiplier whose exact value is measured by the Phase-15 spike).

export interface HistoricalOddsFetchResult extends OddsFetchResult {
  /** Per-call credit cost: `x-requests-last` when present, else the `x-requests-used` delta. */
  perCallCredits: number | null
  /** Effective ISO timestamp of the returned historical snapshot (≤ requested date). */
  snapshotTimestamp: string | null
}

interface HistoricalEnvelope<T> {
  timestamp: string
  previous_timestamp: string | null
  next_timestamp: string | null
  data: T
}

/** Per-call credit cost: prefer the literal `x-requests-last` header; otherwise
 *  fall back to the `x-requests-used` delta across the call (needs a prior reading). */
function perCallCost(
  res: Response,
  creditsUsed: number | null,
  priorCreditsUsed?: number,
): number | null {
  const last = numOrNull(res.headers.get('x-requests-last'))
  if (last != null) return last
  if (priorCreditsUsed != null && creditsUsed != null) return creditsUsed - priorCreditsUsed
  return null
}

/**
 * Historical odds for a whole sport at a past snapshot
 * (`/v4/historical/sports/{sport}/odds?date=<iso>`). Pinnacle lives in `eu`.
 * `dateIso` is the snapshot time, e.g. `2026-05-15T23:59:00Z`.
 */
export async function fetchHistoricalSportOdds(
  sportKey: string,
  dateIso: string,
  markets = 'h2h,spreads,totals',
  regions = 'eu',
  priorCreditsUsed?: number,
): Promise<HistoricalOddsFetchResult> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const url =
    `${BASE}/historical/sports/${sportKey}/odds?apiKey=${key}` +
    `&regions=${regions}&markets=${markets}&oddsFormat=american&dateFormat=iso&date=${encodeURIComponent(dateIso)}`
  const res = await fetch(url)
  const creditsRemaining = numOrNull(res.headers.get('x-requests-remaining'))
  const creditsUsed = numOrNull(res.headers.get('x-requests-used'))
  if (!res.ok) {
    throw new Error(`Odds API historical ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const env = (await res.json()) as HistoricalEnvelope<OddsEvent[]>
  return {
    events: env.data ?? [],
    creditsRemaining,
    creditsUsed,
    perCallCredits: perCallCost(res, creditsUsed, priorCreditsUsed),
    snapshotTimestamp: env.timestamp ?? null,
  }
}

/**
 * Historical odds for ONE event at a past snapshot
 * (`/v4/historical/sports/{sport}/events/{eventId}/odds?date=<iso>`). Used for the
 * pre-commence look-ahead-guarded snapshot.
 */
export async function fetchHistoricalEventOdds(
  sportKey: string,
  eventId: string,
  dateIso: string,
  markets = 'h2h,spreads,totals',
  regions = 'eu',
  priorCreditsUsed?: number,
): Promise<HistoricalOddsFetchResult> {
  const key = process.env.ODDS_API_KEY
  if (!key) throw new Error('ODDS_API_KEY is not set in the environment')
  const url =
    `${BASE}/historical/sports/${sportKey}/events/${eventId}/odds?apiKey=${key}` +
    `&regions=${regions}&markets=${markets}&oddsFormat=american&dateFormat=iso&date=${encodeURIComponent(dateIso)}`
  const res = await fetch(url)
  const creditsRemaining = numOrNull(res.headers.get('x-requests-remaining'))
  const creditsUsed = numOrNull(res.headers.get('x-requests-used'))
  if (!res.ok) {
    throw new Error(`Odds API historical event ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const env = (await res.json()) as HistoricalEnvelope<OddsEvent>
  return {
    events: env.data ? [env.data] : [],
    creditsRemaining,
    creditsUsed,
    perCallCredits: perCallCost(res, creditsUsed, priorCreditsUsed),
    snapshotTimestamp: env.timestamp ?? null,
  }
}
