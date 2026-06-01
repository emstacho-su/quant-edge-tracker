/**
 * kalshi-h2h.ts — slim Kalshi moneyline (h2h) fetcher for the CLV pipeline.
 *
 * The KalshiAdapter in api/_lib/line-shop is designed for the /line-shop page
 * (writes to book_prices, uses event_book_mappings). For CLV we want lighter
 * coupling: one fetch per sport per cron tick, returning events with the per-
 * side ask price ready to be emitted as odds_snapshots rows.
 *
 * Kalshi is a CFTC-regulated event-contracts exchange. Their public REST API
 * needs no auth. Each game event has two binary markets (one per team's "wins"
 * outcome); yes_ask_dollars is the price you'd pay (in dollars per $1 share)
 * for that side's YES contract — equivalent to the implied probability at the
 * ask. Conversion to American odds is the standard prob → American formula.
 *
 * Note: the two yes_asks per event don't generally sum to exactly 1.00; the
 * gap reflects the bid-ask spread (Kalshi's effective per-trade markup). For
 * PLM comparison purposes we still use yes_ask as the realised price — that's
 * what you actually pay to bet. Kalshi is added to SHARP_BOOKS so it
 * participates in "best across the sharp subset."
 *
 * Only h2h is supported — Kalshi has no spread / totals markets.
 */

const BASE = 'https://external-api.kalshi.com/trade-api/v2'

/** Map our bet.sport → Kalshi series tickers (one per game-line series). */
const SERIES_TICKERS: Record<string, string[]> = {
  mlb: ['KXMLBGAME'],
  nhl: ['KXNHLGAME'],
  nba: ['KXNBAGAME'],
  wnba: ['KXWNBAGAME'],
  nfl: ['KXNFLGAME'],
}

interface RawMarket {
  ticker: string
  yes_sub_title: string
  yes_ask_dollars: string
  status: string
  occurrence_datetime?: string
}

interface RawEvent {
  event_ticker: string
  title: string
  markets?: RawMarket[]
}

export interface KalshiH2hEvent {
  /** Kalshi event ticker (used as a stable id; not the Odds API event id). */
  eventTicker: string
  /** Home team name as Kalshi prints it (e.g. "Los Angeles D" for Dodgers). */
  homeTeam: string
  /** Away team name as Kalshi prints it. */
  awayTeam: string
  /** Kalshi's prob (yes_ask_dollars) for the home side, or null if illiquid. */
  homeProb: number | null
  /** Same for away side. */
  awayProb: number | null
  /** First-market occurrence_datetime, or null if unknown. */
  commenceTime: Date | null
}

/** Title convention: "Away vs Home". */
function splitTitle(title: string): { home: string; away: string } {
  const parts = title.split(' vs ')
  if (parts.length < 2) return { home: title, away: '' }
  return { home: parts[parts.length - 1].trim(), away: parts[0].trim() }
}

/** Convert a probability in (0,1) to American odds (rounded to int). Returns
 *  null for any out-of-range value. */
export function kalshiProbToAmerican(prob: number | null | undefined): number | null {
  if (prob == null) return null
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null
  if (prob >= 0.5) return -Math.round((prob / (1 - prob)) * 100)
  return Math.round(((1 - prob) / prob) * 100)
}

/** Convert a Kalshi yes_ask_dollars string in (0,1) to American odds. Returns
 *  null for "0.0000" (no transactable ask) or any out-of-range value. */
export function kalshiAskToAmerican(askDollars: string | null | undefined): number | null {
  if (!askDollars) return null
  return kalshiProbToAmerican(parseFloat(askDollars))
}

/** Fetch all open game events for a sport, with per-side ask price already
 *  extracted. Returns [] for unsupported sports or any network failure (Kalshi
 *  is best-effort — should never break the rest of the cron). */
export async function fetchKalshiH2hForSport(sport: string): Promise<KalshiH2hEvent[]> {
  const tickers = SERIES_TICKERS[sport.toLowerCase().trim()]
  if (!tickers || tickers.length === 0) return []

  const events: KalshiH2hEvent[] = []
  for (const seriesTicker of tickers) {
    try {
      const res = await fetch(
        `${BASE}/events?series_ticker=${seriesTicker}&status=open&with_nested_markets=true&limit=200`,
        { headers: { 'User-Agent': 'quant-edge-tracker/1.0' } },
      )
      if (!res.ok) continue
      const body = (await res.json()) as { events?: RawEvent[] }
      for (const e of body.events ?? []) {
        const { home, away } = splitTitle(e.title)
        const markets = (e.markets ?? []).filter((m) => m.status === 'active')
        // Kalshi posts two binary markets per game event — one per team. The
        // yes_sub_title carries the team name. The yes_ask is the implied prob
        // of THAT team winning.
        let homeProb: number | null = null
        let awayProb: number | null = null
        let commenceTime: Date | null = null
        for (const m of markets) {
          if (m.occurrence_datetime && !commenceTime) {
            commenceTime = new Date(m.occurrence_datetime)
          }
          const subTitle = m.yes_sub_title.toLowerCase()
          // Score-based match — Kalshi titles can be abbreviated ("Los Angeles D"
          // vs Dodgers), so accept substring overlap on the longer name.
          const matchesHome = subTitle.includes(home.toLowerCase()) || home.toLowerCase().includes(subTitle)
          const matchesAway = subTitle.includes(away.toLowerCase()) || away.toLowerCase().includes(subTitle)
          const prob = parseFloat(m.yes_ask_dollars)
          const valid = Number.isFinite(prob) && prob > 0 && prob < 1
          if (matchesHome && !matchesAway && valid) homeProb = prob
          else if (matchesAway && !matchesHome && valid) awayProb = prob
        }
        events.push({
          eventTicker: e.event_ticker,
          homeTeam: home,
          awayTeam: away,
          homeProb,
          awayProb,
          commenceTime,
        })
      }
    } catch {
      // Best-effort — skip this series silently. Pinnacle remains the anchor.
      continue
    }
  }
  return events
}
