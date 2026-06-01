import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { parseBet } from '../_lib/parse-bet.js'
import { findOutcome, findOutcomeNearestPoint, matchScore } from '../_lib/match.js'
import { fetchSportOdds, fetchSportEvents, fetchEventOdds, bookMarket, type OddsEvent, type OddsOutcome } from '../_lib/odds-api.js'
import { noVigMulti, clvPct, clvProbPoints, impliedFromAmerican, americanToDecimal, plmPct, plmProbPoints, SHARP_BOOKS } from '../_lib/clv.js'
import { kalshiEffectiveImpliedProb } from '../_lib/line-shop/kalshi-fee.js'
import { tierFor, cadenceMs, isDue } from '../_lib/clv-cadence.js'
import { candidateOddsKeys, activeTennisKeys, activeGolfKeys } from '../_lib/clv-resolve.js'
import { parsePropDescription } from '../_lib/evaluate-prop.js'
import { propMarketFor } from '../_lib/prop-market.js'
import { findPropOutcome } from '../_lib/prop-match.js'
import { fetchKalshiH2hForSport, kalshiProbToAmerican, type KalshiH2hEvent } from '../_lib/kalshi-h2h.js'

/**
 * GET /api/cron/line-movement
 *
 * Credit-smart line-movement + CLV tracker for ALL pending bets. Runs every
 * 15 min; a tiered scheduler decides which bets are due for a fetch this tick.
 *  - parses descriptions into structured markets (moneyline / spread / total;
 *    soccer 3-way incl. Draw; tennis player ML)
 *  - tiered due-gating (clv-cadence): standard team sports poll 30 min until
 *    T-3h then 15 min; a bet is only a candidate when its tier says it's due
 *  - sport → Odds API key(s): team sports use SPORT_KEYS; soccer sweeps a
 *    bounded league list; tennis uses keys discovered live from /sports. The
 *    resolved key is cached on the bet (odds_sport_key) so later ticks fetch one.
 *  - circuit breaker: sheds costly (non-standard) tiers when credits run low
 *  - snapshots Pinnacle (sharp ref); running CLV vs no-vig; locks at game start
 *
 * team_totals / props / futures are tracked via the per-event endpoint in a
 * later phase (the bulk /sports/{key}/odds endpoint only serves featured
 * markets: h2h, spreads, totals).
 *
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 */

const MATCH_LOOKBACK_DAYS = 3
const REFERENCE_BOOK = 'pinnacle'
// Major US books for the CLV "best available" marker. Credit-free: these come from the
// same already-fetched event response (displayBookSnaps just parses more of it). Books
// not present in a given response are skipped, so listing extras is harmless.
const DISPLAY_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'betrivers', 'espnbet', 'williamhill_us'] as const
const DAY = 86_400_000
const DISCOVERY_THROTTLE_MS = 60 * 60_000 // soccer/tennis re-discovery cap (sweeps many keys)

// bet.sport → The Odds API sport key (team sports). Soccer/tennis are resolved
// separately (multi-league / live tour keys) via clv-resolve.
const SPORT_KEYS: Record<string, string> = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  wnba: 'basketball_wnba',
  nhl: 'icehockey_nhl',
  nfl: 'americanfootball_nfl',
  ncaab: 'basketball_ncaab',
  ncaaf: 'americanfootball_ncaaf',
  mma: 'mma_mixed_martial_arts',
  ufc: 'mma_mixed_martial_arts',
}

// CLV-trackable markets on the bulk endpoint, mapped to Odds API market keys.
const MARKET_KEY: Record<string, string> = {
  moneyline: 'h2h',
  spread: 'spreads',
  total: 'totals',
}

function sportKeyFor(sport: string | null): string | null {
  if (!sport) return null
  return SPORT_KEYS[sport.toLowerCase().trim()] ?? null
}

/** Soccer/tennis are resolved via clv-resolve (no single SPORT_KEYS entry). */
function isSoccerOrTennis(sport: string | null): boolean {
  const s = (sport ?? '').toLowerCase().trim()
  return s === 'soccer' || s === 'tennis'
}

interface BetRow {
  id: string
  sport: string | null
  description: string
  is_prop: boolean
  odds_american: number | null
  placed_at: string
  clv_market: string | null
  clv_selection: string | null
  clv_line: number | null
  clv_period: string | null
  clv_status: string | null
  clv_updated_at: string | null
  odds_event_id: string | null
  odds_sport_key: string | null
  event_commence_time: string | null
}

export interface SnapRow {
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

export async function run() {
  const supabase = getServiceClient()
  const now = Date.now()
  const creditFloor = Number(process.env.ODDS_CREDIT_FLOOR ?? 500)

  const { data, error } = await supabase
    .from('bets')
    .select(
      'id, sport, description, is_prop, odds_american, placed_at, clv_market, clv_selection, clv_line, clv_period, clv_status, clv_updated_at, odds_event_id, odds_sport_key, event_commence_time',
    )
    .eq('status', 'pending')
  if (error) throw new Error(error.message)
  const bets = (data ?? []) as BetRow[]

  // 1) parse anything not yet parsed
  let parsed = 0
  for (const b of bets) {
    if (b.clv_status && b.clv_status !== 'unparsed') continue
    const pm = parseBet(b.description, b.is_prop)
    const patch = {
      clv_market: pm.market,
      clv_selection: pm.selection,
      clv_line: pm.line,
      clv_period: pm.period,
      clv_status: pm.supported ? 'pending' : 'unsupported',
    }
    await supabase.from('bets').update(patch).eq('id', b.id)
    Object.assign(b, patch)
    parsed++
  }

  // 2) lock matched bets whose game has already started
  let locked = 0
  for (const b of bets) {
    if (
      (b.clv_status === 'tracking' || b.clv_status === 'pending') &&
      b.clv_market !== 'outright' &&
      b.event_commence_time &&
      new Date(b.event_commence_time).getTime() <= now
    ) {
      await supabase
        .from('bets')
        .update({ clv_status: 'locked', clv_next_due_at: null, clv_updated_at: new Date().toISOString() })
        .eq('id', b.id)
      b.clv_status = 'locked'
      locked++
    }
  }

  // 3) candidates warranting an odds fetch — tiered due-gating
  const candidates = bets.filter((b) => {
    if (b.clv_status !== 'pending' && b.clv_status !== 'tracking') return false
    if (!(b.clv_market != null && b.clv_market in MARKET_KEY)) return false
    if (b.odds_american == null) return false
    const isTeam = sportKeyFor(b.sport) != null
    if (!isTeam && !isSoccerOrTennis(b.sport)) return false
    // not yet matched to an Odds API event → keep discovering it while recently placed
    if (b.event_commence_time == null) {
      if (new Date(b.placed_at).getTime() <= now - MATCH_LOOKBACK_DAYS * DAY) return false
      // soccer/tennis discovery sweeps many keys → throttle; team sports are 1 fetch so no throttle
      if (!isTeam) {
        const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
        if (lastMs != null && now - lastMs < DISCOVERY_THROTTLE_MS) return false
      }
      return true
    }
    // matched → the bet's tier + time-to-start decide whether to spend a credit
    const msToStart = new Date(b.event_commence_time).getTime() - now
    const tier = tierFor(b.sport, b.is_prop)
    const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
    return isDue(tier, msToStart, lastMs, now)
  })

  // 4) map each candidate to the Odds API key(s) to search; one fetch per key.
  const tennisKeys = candidates.some((b) => (b.sport ?? '').toLowerCase().trim() === 'tennis')
    ? await activeTennisKeys().catch(() => [])
    : []
  const keyToBets = new Map<string, BetRow[]>()
  for (const b of candidates) {
    for (const k of keysForBet(b, tennisKeys)) {
      const arr = keyToBets.get(k) ?? []
      arr.push(b)
      keyToBets.set(k, arr)
    }
  }

  const capturedAt = new Date().toISOString()
  const snaps: SnapRow[] = []
  const fetched: Array<{ sport: string; creditsRemaining: number | null; shed?: boolean }> = []
  let creditsRemaining: number | null = null
  let matched = 0
  let tracked = 0
  const matchedThisTick = new Set<string>()
  const searched = new Set<string>()

  // ── Kalshi pass setup ──────────────────────────────────────────────────────
  // Kalshi h2h prices are the implied probability directly (no vig). Cached per
  // sport per tick so we only hit Kalshi once even if many bets share the sport.
  // Best-effort: a Kalshi outage never breaks the rest of the cron.
  const kalshiBySport = new Map<string, KalshiH2hEvent[]>()
  async function kalshiForSport(sport: string): Promise<KalshiH2hEvent[]> {
    const lower = sport.toLowerCase().trim()
    let evs = kalshiBySport.get(lower)
    if (!evs) {
      evs = await fetchKalshiH2hForSport(lower).catch(() => [] as KalshiH2hEvent[])
      kalshiBySport.set(lower, evs)
    }
    return evs
  }
  function findKalshiEvent(
    evs: KalshiH2hEvent[],
    homeTeam: string,
    awayTeam: string,
  ): KalshiH2hEvent | null {
    let best: KalshiH2hEvent | null = null
    let bestScore = 0
    for (const k of evs) {
      const s = matchScore(k.homeTeam, homeTeam) + matchScore(k.awayTeam, awayTeam)
      if (s >= 2 && s > bestScore) {
        best = k
        bestScore = s
      }
    }
    return best
  }

  for (const [sportKey, group] of keyToBets) {
    const pending = group.filter((b) => !matchedThisTick.has(b.id))
    if (pending.length === 0) continue // every bet wanting this key already resolved on an earlier key

    // circuit breaker: shed costly (non-standard) tiers when credits run low.
    // standard team/soccer/tennis groups always proceed.
    const groupTier = tierFor(pending[0].sport, false)
    if (groupTier !== 'standard' && creditsRemaining != null && creditsRemaining < creditFloor) {
      fetched.push({ sport: sportKey, creditsRemaining, shed: true })
      continue
    }

    // mark as searched before the fetch so a fetch error still throttles re-discovery
    for (const b of pending) searched.add(b.id)

    let events: OddsEvent[]
    try {
      const r = await fetchSportOdds(sportKey, 'h2h,spreads,totals', 'us,eu')
      events = r.events
      creditsRemaining = r.creditsRemaining
      fetched.push({ sport: sportKey, creditsRemaining: r.creditsRemaining })
    } catch {
      continue
    }

    for (const b of pending) {
      const ev = findEvent(events, b)
      if (!ev) continue
      matchedThisTick.add(b.id)

      if (b.odds_event_id !== ev.id || b.event_commence_time == null || b.odds_sport_key !== sportKey) {
        await supabase
          .from('bets')
          .update({ odds_event_id: ev.id, event_commence_time: ev.commence_time, odds_sport_key: sportKey })
          .eq('id', b.id)
        b.odds_event_id = ev.id
        b.event_commence_time = ev.commence_time
        b.odds_sport_key = sportKey
        matched++
      }

      if (new Date(ev.commence_time).getTime() <= now) {
        await supabase.from('bets').update({ clv_status: 'locked', clv_next_due_at: null, clv_updated_at: capturedAt }).eq('id', b.id)
        locked++
        continue
      }

      const marketKey = MARKET_KEY[b.clv_market as string]
      if (!marketKey) continue
      const point = b.clv_market === 'spread' || b.clv_market === 'total' ? b.clv_line : null

      // ── No-vig source resolution (tiered fallback) ───────────────────────
      // Pinnacle's bulk feed sometimes drops the exact bet line (label
      // inversion on run lines, or a moved spread). Cascade through the sharp
      // subset until we get an outcome pair that matches the bet's exact
      // point, then fall back to a nearest-point match on Pinnacle. The
      // result tells us which book provided the fair so we can stamp it.
      const fairCandidates: Array<{ book: string; market: typeof bookMarket extends (...a: never[]) => infer R ? R : never }> = [
        { book: REFERENCE_BOOK, market: bookMarket(ev, REFERENCE_BOOK, marketKey) },
        { book: 'draftkings', market: bookMarket(ev, 'draftkings', marketKey) },
        { book: 'fanduel', market: bookMarket(ev, 'fanduel', marketKey) },
        { book: 'betmgm', market: bookMarket(ev, 'betmgm', marketKey) },
        { book: 'williamhill_us', market: bookMarket(ev, 'williamhill_us', marketKey) },
      ]
      let sel: { you: { name: string; price: number; point?: number }; others: Array<{ name: string; price: number; point?: number }>; pointUsed?: number } | null = null
      let fairBook = REFERENCE_BOOK
      // 1) exact-point pass through the sharp subset
      for (const { book, market } of fairCandidates) {
        if (!market || market.length < 2) continue
        const hit = findOutcome(market, b.clv_selection ?? '', point)
        if (hit) { sel = hit; fairBook = book; break }
      }
      // 2) nearest-point fallback (spread/total only; h2h has no point so the
      //    exact pass above is definitive).
      if (!sel && point != null) {
        for (const { book, market } of fairCandidates) {
          if (!market || market.length < 2) continue
          const hit = findOutcomeNearestPoint(market, b.clv_selection ?? '', point)
          if (hit) { sel = hit; fairBook = book; break }
        }
      }
      if (!sel) continue

      const fair = noVigMulti(sel.you.price, [sel.you.price, ...sel.others.map((o) => o.price)])
      for (const oc of [sel.you, ...sel.others]) {
        snaps.push({
          odds_event_id: ev.id,
          sport_key: sportKey,
          commence_time: ev.commence_time,
          home_team: ev.home_team,
          away_team: ev.away_team,
          bookmaker: fairBook,
          market: marketKey,
          selection: oc.name,
          point: oc.point ?? null,
          price_american: oc.price,
          captured_at: capturedAt,
        })
      }
      snaps.push(...displayBookSnaps(ev, marketKey, b.clv_selection ?? '', point, DISPLAY_BOOKS, { sportKey, capturedAt }))

      // ── Kalshi pass (h2h only — Kalshi has no spread/total markets) ──────
      // Emit both-side snapshots for the matched Kalshi event so the price
      // ladder + PLM "best" can consider Kalshi alongside Pinnacle/DK/etc.
      let kalshiBetSidePrice: number | null = null
      if (marketKey === 'h2h' && b.sport) {
        const kevs = await kalshiForSport(b.sport)
        const kev = findKalshiEvent(kevs, ev.home_team, ev.away_team)
        if (kev) {
          const homeAm = kalshiProbToAmerican(kev.homeProb)
          const awayAm = kalshiProbToAmerican(kev.awayProb)
          if (homeAm != null) {
            snaps.push({
              odds_event_id: ev.id,
              sport_key: sportKey,
              commence_time: ev.commence_time,
              home_team: ev.home_team,
              away_team: ev.away_team,
              bookmaker: 'kalshi',
              market: marketKey,
              selection: ev.home_team,
              point: null,
              price_american: homeAm,
              captured_at: capturedAt,
            })
          }
          if (awayAm != null) {
            snaps.push({
              odds_event_id: ev.id,
              sport_key: sportKey,
              commence_time: ev.commence_time,
              home_team: ev.home_team,
              away_team: ev.away_team,
              bookmaker: 'kalshi',
              market: marketKey,
              selection: ev.away_team,
              point: null,
              price_american: awayAm,
              captured_at: capturedAt,
            })
          }
          // Pick the side that matches the bet's selection for PLM comparison.
          const sel = b.clv_selection ?? ''
          const homeMatch = matchScore(sel, ev.home_team)
          const awayMatch = matchScore(sel, ev.away_team)
          if (homeMatch > awayMatch) kalshiBetSidePrice = homeAm
          else if (awayMatch > homeMatch) kalshiBetSidePrice = awayAm
        }
      }

      const yourOdds = b.odds_american as number
      const pct = clvPct(yourOdds, fair)
      let plmBest = bestPriceAcrossBooks(ev, marketKey, (bm) => findOutcome(bm, b.clv_selection ?? '', point)?.you.price ?? null)
      // Promote Kalshi if it's the best of the sharp subset for this bet's side.
      if (kalshiBetSidePrice != null) {
        if (plmBest == null || americanToDecimal(kalshiBetSidePrice) > americanToDecimal(plmBest.price)) {
          plmBest = { book: 'kalshi', price: kalshiBetSidePrice }
        }
      }
      const plm = plmBest ? plmPct(yourOdds, plmBest.price) : null
      const tier = tierFor(b.sport, b.is_prop)
      const interval = cadenceMs(tier, new Date(ev.commence_time).getTime() - now)
      const nextDue = interval != null ? new Date(now + interval).toISOString() : null
      await supabase
        .from('bets')
        .update({
          entry_fair_prob: impliedFromAmerican(yourOdds),
          closing_fair_prob: fair,
          clv_pct: pct,
          clv_prob_points: clvProbPoints(yourOdds, fair),
          beat_close: pct > 0,
          plm_best_american: plmBest?.price ?? null,
          plm_best_book: plmBest?.book ?? null,
          plm_pct: plm,
          plm_prob_points: plmBest ? plmProbPoints(yourOdds, plmBest.price) : null,
          plm_positive: plm != null ? plm >= 0 : null,
          clv_status: 'tracking',
          clv_tier: tier,
          clv_next_due_at: nextDue,
          clv_updated_at: capturedAt,
        })
        .eq('id', b.id)
      tracked++
    }
  }

  // throttle re-discovery for soccer/tennis bets we swept but couldn't match this tick
  for (const b of candidates) {
    if (searched.has(b.id) && !matchedThisTick.has(b.id) && b.event_commence_time == null && !sportKeyFor(b.sport)) {
      await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id)
    }
  }

  // 5) prop pass — player props via the per-event endpoint (Phase 3). Props are
  // billed per event and the player is carried in an outcome `description`, so
  // they can't ride the bulk loop. Prop tier = only the final 3h, shed first.
  let propsTracked = 0
  const teamsCache = new Map<string, Map<string, string>>()
  const eventsCache = new Map<string, OddsEvent[]>()
  const evOddsCache = new Map<string, OddsEvent>()

  async function teamFullName(sport: string, abbrev: string): Promise<string | null> {
    let tmap = teamsCache.get(sport)
    if (!tmap) {
      const { data } = await supabase.from('teams').select('abbreviation, full_name, aliases').eq('sport', sport)
      tmap = new Map<string, string>()
      for (const t of (data ?? []) as Array<{ abbreviation: string | null; full_name: string; aliases: string[] | null }>) {
        if (t.abbreviation) tmap.set(t.abbreviation.toUpperCase(), t.full_name)
        for (const a of t.aliases ?? []) tmap.set(String(a).toUpperCase(), t.full_name)
      }
      teamsCache.set(sport, tmap)
    }
    return tmap.get(abbrev.toUpperCase()) ?? null
  }

  // ── Player → team abbreviation resolver (Phase 17 entity library) ────────
  // Used when a prop description omits its "(TEAM)" parenthetical. Paginated
  // because the players table is ~6k rows and PostgREST caps results at 1000.
  // The map keys are normalized names: full_name, short_name, and last-name-only
  // (where the last name is at least 5 chars to avoid common-name collisions).
  const playerTeamBySportName = new Map<string, Map<string, string>>()
  let playerIndexLoaded = false

  function normName(s: string): string {
    return s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’.]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async function ensurePlayerIndex() {
    if (playerIndexLoaded) return
    playerIndexLoaded = true
    // Build sport → (espn_id → abbreviation) from the teams table first.
    const { data: teamRows } = await supabase.from('teams').select('sport, espn_id, abbreviation')
    const teamAbbrev = new Map<string, string>()
    for (const t of (teamRows ?? []) as Array<{ sport: string | null; espn_id: string | null; abbreviation: string | null }>) {
      if (t.sport && t.espn_id && t.abbreviation) {
        teamAbbrev.set(`${t.sport}|${t.espn_id}`, t.abbreviation)
      }
    }
    // Page through players (PostgREST default cap = 1000 rows / page).
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('players')
        .select('full_name, short_name, sport, team_espn_id')
        .eq('active', true)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) break
      const page = data ?? []
      for (const p of page as Array<{ full_name: string | null; short_name: string | null; sport: string | null; team_espn_id: string | null }>) {
        if (!p.full_name || !p.sport || !p.team_espn_id) continue
        const abbr = teamAbbrev.get(`${p.sport}|${p.team_espn_id}`)
        if (!abbr) continue
        let sub = playerTeamBySportName.get(p.sport)
        if (!sub) {
          sub = new Map<string, string>()
          playerTeamBySportName.set(p.sport, sub)
        }
        const keys = new Set<string>()
        const full = normName(p.full_name)
        keys.add(full)
        if (p.short_name) keys.add(normName(p.short_name))
        const parts = full.split(/\s+/)
        if (parts.length >= 2 && parts[parts.length - 1].length >= 5) keys.add(parts[parts.length - 1])
        for (const k of keys) if (k && !sub.has(k)) sub.set(k, abbr)
      }
      if (page.length < PAGE) break
    }
  }

  async function resolvePlayerTeam(sport: string, playerName: string): Promise<string | null> {
    await ensurePlayerIndex()
    const sub = playerTeamBySportName.get(sport)
    if (!sub) return null
    return sub.get(normName(playerName)) ?? null
  }

  for (const b of bets) {
    if (b.clv_status === 'locked') continue
    if (b.odds_american == null || !b.sport) continue
    const prop = parsePropDescription(b.description)
    if (!prop) continue
    const market = propMarketFor(b.sport, prop.statKey)
    if (!market) continue
    const sportKey = sportKeyFor(b.sport)
    if (!sportKey) continue

    // Promote step-1's 'unsupported' to 'pending' once we know the prop is at
    // least parseable AND on a supported sport+stat. Without this the bet
    // would stay in /clv's "Untracked" bucket forever even while the prop
    // pass is genuinely working on it. Also stamp clv_market='prop' +
    // selection/line so the UI can render something meaningful before the
    // first snapshot lands.
    if (b.clv_status === 'unsupported' || b.clv_status === 'unparsed' || b.clv_status === null) {
      await supabase
        .from('bets')
        .update({
          clv_status: 'pending',
          clv_market: 'prop',
          clv_selection: prop.player,
          clv_line: prop.line,
        })
        .eq('id', b.id)
      b.clv_status = 'pending'
      b.clv_market = 'prop'
      b.clv_selection = prop.player
      b.clv_line = prop.line
    }

    // due-gating: prop tier (≤3h) once resolved; before that, discovery throttle + lookback
    if (b.event_commence_time == null) {
      if (new Date(b.placed_at).getTime() <= now - MATCH_LOOKBACK_DAYS * DAY) continue
      const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
      if (lastMs != null && now - lastMs < DISCOVERY_THROTTLE_MS) continue
    } else {
      const msToStart = new Date(b.event_commence_time).getTime() - now
      const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
      if (!isDue('prop', msToStart, lastMs, now)) continue
    }

    // resolve the Odds API event once (team abbrev → teams table → match free events list).
    // When the description didn't carry a "(TEAM)" annotation, ask the players-table
    // resolver to fill it in (Phase 17 entity library).
    if (!b.odds_event_id || !b.odds_sport_key) {
      let teamAbbrev = prop.team
      if (!teamAbbrev) {
        teamAbbrev = await resolvePlayerTeam(b.sport, prop.player)
      }
      if (!teamAbbrev) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
      const fullName = await teamFullName(b.sport, teamAbbrev)
      if (!fullName) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
      let events = eventsCache.get(sportKey)
      if (!events) { events = await fetchSportEvents(sportKey); eventsCache.set(sportKey, events) }
      // A team can have multiple upcoming events listed (playoffs / future series).
      // Pick the SOONEST future event for the bet. Strict `length !== 1` was
      // dropping bets like De'Aaron Fox when the Spurs had two scheduled games
      // (tonight vs OKC + a later round vs NY).
      const evMatches = events
        .filter((e) => matchScore(e.home_team, fullName) >= 1 || matchScore(e.away_team, fullName) >= 1)
        .filter((e) => new Date(e.commence_time).getTime() > now)
        .sort((a, z) => +new Date(a.commence_time) - +new Date(z.commence_time))
      if (evMatches.length === 0) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
      const ev = evMatches[0]
      await supabase.from('bets').update({ odds_event_id: ev.id, odds_sport_key: sportKey, event_commence_time: ev.commence_time }).eq('id', b.id)
      b.odds_event_id = ev.id
      b.odds_sport_key = sportKey
      b.event_commence_time = ev.commence_time
    }

    // lock if the game has started
    if (b.event_commence_time && new Date(b.event_commence_time).getTime() <= now) {
      await supabase.from('bets').update({ clv_status: 'locked', clv_next_due_at: null, clv_updated_at: capturedAt }).eq('id', b.id)
      locked++
      continue
    }

    // per-event fetch (cache by event+market so 2 props on the same game share one fetch)
    const cacheKey = `${b.odds_event_id}:${market}`
    let evOdds = evOddsCache.get(cacheKey)
    if (!evOdds) {
      // circuit breaker: props are the costliest tier → shed first when credits run low
      if (creditsRemaining != null && creditsRemaining < creditFloor) {
        await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id)
        fetched.push({ sport: `${b.odds_sport_key}/prop`, creditsRemaining, shed: true })
        continue
      }
      try {
        const r = await fetchEventOdds(b.odds_sport_key as string, b.odds_event_id as string, market, 'us,eu')
        evOdds = r.events[0]
        creditsRemaining = r.creditsRemaining
        evOddsCache.set(cacheKey, evOdds)
        fetched.push({ sport: `${b.odds_sport_key}/${market}`, creditsRemaining: r.creditsRemaining })
      } catch {
        await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id)
        continue
      }
    }

    const pin = bookMarket(evOdds, REFERENCE_BOOK, market)
    if (!pin || pin.length < 2) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
    const sel = findPropOutcome(pin, prop.player, prop.direction, prop.line)
    if (!sel) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }

    const fair = noVigMulti(sel.you.price, [sel.you.price, ...sel.others.map((o) => o.price)])
    for (const oc of [sel.you, ...sel.others]) {
      snaps.push({
        odds_event_id: b.odds_event_id as string,
        sport_key: b.odds_sport_key as string,
        commence_time: b.event_commence_time as string,
        home_team: evOdds.home_team,
        away_team: evOdds.away_team,
        bookmaker: REFERENCE_BOOK,
        market,
        selection: `${oc.description ?? ''} ${oc.name}`.trim(),
        point: oc.point ?? null,
        price_american: oc.price,
        captured_at: capturedAt,
      })
    }
    const yourOdds = b.odds_american as number
    const pct = clvPct(yourOdds, fair)
    const plmBest = bestPriceAcrossBooks(evOdds, market, (bm) => findPropOutcome(bm, prop.player, prop.direction, prop.line)?.you.price ?? null)
    const plm = plmBest ? plmPct(yourOdds, plmBest.price) : null
    const interval = cadenceMs('prop', new Date(b.event_commence_time as string).getTime() - now)
    const nextDue = interval != null ? new Date(now + interval).toISOString() : null
    await supabase
      .from('bets')
      .update({
        entry_fair_prob: impliedFromAmerican(yourOdds),
        closing_fair_prob: fair,
        clv_pct: pct,
        clv_prob_points: clvProbPoints(yourOdds, fair),
        beat_close: pct > 0,
        plm_best_american: plmBest?.price ?? null,
        plm_best_book: plmBest?.book ?? null,
        plm_pct: plm,
        plm_prob_points: plmBest ? plmProbPoints(yourOdds, plmBest.price) : null,
        plm_positive: plm != null ? plm >= 0 : null,
        clv_status: 'tracking',
        clv_tier: 'prop',
        clv_next_due_at: nextDue,
        clv_updated_at: capturedAt,
      })
      .eq('id', b.id)
    propsTracked++
  }

  // 6) golf pass — outright futures (raw implied-prob movement; bulk outrights endpoint).
  // No Pinnacle for golf → book preference list. Outright = single price (no no-vig over
  // the field). Golfer may appear in multiple active tournaments → pick the soonest.
  let golfTracked = 0
  const GOLF_BOOKS = ['betfair_ex_eu', 'pinnacle', 'draftkings', 'betmgm', 'fanduel', 'betrivers', 'lowvig', 'betonlineag', 'everygame']
  const golfKeys = bets.some((b) => b.clv_market === 'outright' && b.clv_status !== 'locked') ? await activeGolfKeys() : []
  const golfOutrightsCache = new Map<string, OddsEvent[]>()

  for (const b of bets) {
    if (b.clv_market !== 'outright' || b.clv_status === 'locked') continue
    if (b.odds_american == null || !b.clv_selection) continue

    // futures due-gating: 12h >24h / 1.5h ≤24h. Unresolved → throttle at 12h (futures are
    // long-lived; no 3-day placed_at lookback).
    const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
    if (b.event_commence_time == null) {
      if (lastMs != null && now - lastMs < 12 * 3_600_000) continue
    } else {
      const msToStart = new Date(b.event_commence_time).getTime() - now
      if (!isDue('futures', msToStart, lastMs, now)) continue
    }

    // circuit breaker: futures are shed first when credits run low
    if (creditsRemaining != null && creditsRemaining < creditFloor) {
      fetched.push({ sport: 'golf', creditsRemaining, shed: true })
      continue
    }

    // resolve the tournament: sweep active golf keys' outrights, find the golfer, pick the
    // soonest-commencing event that lists them. A resolved bet re-fetches just its key.
    let chosen: { ev: OddsEvent; sportKey: string; you: { name: string; price: number; book: string } } | null = null
    const keysToSearch = b.odds_sport_key ? [b.odds_sport_key] : golfKeys
    for (const gk of keysToSearch) {
      let evs = golfOutrightsCache.get(gk)
      if (!evs) {
        try {
          const r = await fetchSportOdds(gk, 'outrights', 'us,eu')
          evs = r.events
          creditsRemaining = r.creditsRemaining
          golfOutrightsCache.set(gk, evs)
          fetched.push({ sport: gk, creditsRemaining: r.creditsRemaining })
        } catch {
          continue
        }
      }
      for (const ev of evs) {
        let best: { name: string; price: number; book: string } | null = null
        for (const bookKey of GOLF_BOOKS) {
          const mk = bookMarket(ev, bookKey, 'outrights')
          if (!mk) continue
          // unique best golfer match — avoid first-name-only ties in a 60-player field
          let pick: { name: string; price: number } | null = null
          let pickScore = 0
          let tie = false
          for (const o of mk) {
            const s = matchScore(o.name, b.clv_selection as string)
            if (s > pickScore) { pickScore = s; pick = { name: o.name, price: o.price }; tie = false }
            else if (s === pickScore && s > 0) tie = true
          }
          if (pick && pickScore >= 1 && !tie) { best = { ...pick, book: bookKey }; break }
        }
        if (best && (!chosen || new Date(ev.commence_time).getTime() < new Date(chosen.ev.commence_time).getTime())) {
          chosen = { ev, sportKey: gk, you: best }
        }
      }
    }
    if (!chosen) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }

    if (b.odds_event_id !== chosen.ev.id || b.odds_sport_key !== chosen.sportKey || b.event_commence_time == null) {
      await supabase.from('bets').update({ odds_event_id: chosen.ev.id, odds_sport_key: chosen.sportKey, event_commence_time: chosen.ev.commence_time }).eq('id', b.id)
      b.odds_event_id = chosen.ev.id
      b.odds_sport_key = chosen.sportKey
      b.event_commence_time = chosen.ev.commence_time
      matched++
    }

    const yourOdds = b.odds_american as number
    const entryImplied = impliedFromAmerican(yourOdds)
    const currentImplied = impliedFromAmerican(chosen.you.price)
    const pct = clvPct(yourOdds, currentImplied)
    const golfBest = bestGolfPrice(chosen.ev, b.clv_selection as string, GOLF_BOOKS)
    const plm = golfBest ? plmPct(yourOdds, golfBest.price) : null
    const interval = cadenceMs('futures', new Date(chosen.ev.commence_time).getTime() - now)
    const nextDue = interval != null ? new Date(now + interval).toISOString() : null
    await supabase
      .from('bets')
      .update({
        entry_fair_prob: entryImplied,
        closing_fair_prob: currentImplied,
        clv_pct: pct,
        clv_prob_points: clvProbPoints(yourOdds, currentImplied),
        beat_close: currentImplied > entryImplied,
        plm_best_american: golfBest?.price ?? null,
        plm_best_book: golfBest?.book ?? null,
        plm_pct: plm,
        plm_prob_points: golfBest ? plmProbPoints(yourOdds, golfBest.price) : null,
        plm_positive: plm != null ? plm >= 0 : null,
        clv_status: 'tracking',
        clv_tier: 'futures',
        clv_next_due_at: nextDue,
        clv_updated_at: capturedAt,
      })
      .eq('id', b.id)
    snaps.push({
      odds_event_id: chosen.ev.id,
      sport_key: chosen.sportKey,
      commence_time: chosen.ev.commence_time,
      home_team: chosen.ev.home_team ?? '',
      away_team: chosen.ev.away_team ?? '',
      bookmaker: chosen.you.book,
      market: 'outrights',
      selection: chosen.you.name,
      point: null,
      price_american: chosen.you.price,
      captured_at: capturedAt,
    })
    golfTracked++
  }

  // 7) team_totals pass — per-event (team carried in the outcome `description`, like props).
  // Reuses findPropOutcome with the team as the "player"; event + team resolved by nickname
  // token overlap (e.g. "Detroit Pistons" vs "DET Pistons"), so no teams-table lookup needed.
  let teamTotalsTracked = 0
  const ttEventsCache = new Map<string, OddsEvent[]>()
  const ttOddsCache = new Map<string, OddsEvent>()

  for (const b of bets) {
    if (b.clv_status === 'locked') continue
    if (b.odds_american == null || !b.sport) continue
    const pm = parseBet(b.description, b.is_prop)
    if (pm.market !== 'team_total' || !pm.supported || !pm.team) continue
    const sportKey = sportKeyFor(b.sport)
    if (!sportKey) continue

    // due-gating: standard cadence once resolved; discovery throttle before resolution
    if (b.event_commence_time == null) {
      if (new Date(b.placed_at).getTime() <= now - MATCH_LOOKBACK_DAYS * DAY) continue
      const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
      if (lastMs != null && now - lastMs < DISCOVERY_THROTTLE_MS) continue
    } else {
      const msToStart = new Date(b.event_commence_time).getTime() - now
      const lastMs = b.clv_updated_at ? Date.parse(b.clv_updated_at) : null
      if (!isDue('standard', msToStart, lastMs, now)) continue
    }

    // resolve the event by the bet's team (nickname token overlaps the Odds API name)
    if (!b.odds_event_id || !b.odds_sport_key) {
      let events = ttEventsCache.get(sportKey)
      if (!events) { events = await fetchSportEvents(sportKey); ttEventsCache.set(sportKey, events) }
      const m = events.filter((e) => matchScore(e.home_team, pm.team as string) >= 1 || matchScore(e.away_team, pm.team as string) >= 1)
      if (m.length !== 1) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
      const ev = m[0]
      await supabase.from('bets').update({ odds_event_id: ev.id, odds_sport_key: sportKey, event_commence_time: ev.commence_time }).eq('id', b.id)
      b.odds_event_id = ev.id
      b.odds_sport_key = sportKey
      b.event_commence_time = ev.commence_time
    }

    // lock if the game has started
    if (b.event_commence_time && new Date(b.event_commence_time).getTime() <= now) {
      await supabase.from('bets').update({ clv_status: 'locked', clv_next_due_at: null, clv_updated_at: capturedAt }).eq('id', b.id)
      locked++
      continue
    }

    // per-event fetch (cache by event so both teams' totals share one fetch)
    const cacheKey = b.odds_event_id as string
    let evOdds = ttOddsCache.get(cacheKey)
    if (!evOdds) {
      if (creditsRemaining != null && creditsRemaining < creditFloor) {
        await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id)
        fetched.push({ sport: `${sportKey}/team_totals`, creditsRemaining, shed: true })
        continue
      }
      try {
        const r = await fetchEventOdds(b.odds_sport_key as string, cacheKey, 'team_totals', 'us,eu')
        evOdds = r.events[0]
        creditsRemaining = r.creditsRemaining
        ttOddsCache.set(cacheKey, evOdds)
        fetched.push({ sport: `${sportKey}/team_totals`, creditsRemaining: r.creditsRemaining })
      } catch {
        await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id)
        continue
      }
    }

    const pin = bookMarket(evOdds, REFERENCE_BOOK, 'team_totals')
    if (!pin || pin.length < 2) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }
    const sel = findPropOutcome(pin, pm.team, pm.selection as 'over' | 'under', pm.line as number)
    if (!sel) { await supabase.from('bets').update({ clv_updated_at: capturedAt }).eq('id', b.id); continue }

    const fair = noVigMulti(sel.you.price, [sel.you.price, ...sel.others.map((o) => o.price)])
    const yourOdds = b.odds_american as number
    const pct = clvPct(yourOdds, fair)
    const plmBest = bestPriceAcrossBooks(evOdds, 'team_totals', (bm) => findPropOutcome(bm, pm.team as string, pm.selection as 'over' | 'under', pm.line as number)?.you.price ?? null)
    const plm = plmBest ? plmPct(yourOdds, plmBest.price) : null
    const interval = cadenceMs('standard', new Date(b.event_commence_time as string).getTime() - now)
    const nextDue = interval != null ? new Date(now + interval).toISOString() : null
    await supabase
      .from('bets')
      .update({
        entry_fair_prob: impliedFromAmerican(yourOdds),
        closing_fair_prob: fair,
        clv_pct: pct,
        clv_prob_points: clvProbPoints(yourOdds, fair),
        beat_close: pct > 0,
        plm_best_american: plmBest?.price ?? null,
        plm_best_book: plmBest?.book ?? null,
        plm_pct: plm,
        plm_prob_points: plmBest ? plmProbPoints(yourOdds, plmBest.price) : null,
        plm_positive: plm != null ? plm >= 0 : null,
        clv_status: 'tracking',
        clv_tier: 'standard',
        clv_next_due_at: nextDue,
        clv_updated_at: capturedAt,
      })
      .eq('id', b.id)
    for (const oc of [sel.you, ...sel.others]) {
      snaps.push({
        odds_event_id: cacheKey,
        sport_key: b.odds_sport_key as string,
        commence_time: b.event_commence_time as string,
        home_team: evOdds.home_team,
        away_team: evOdds.away_team,
        bookmaker: REFERENCE_BOOK,
        market: 'team_totals',
        selection: `${oc.description ?? ''} ${oc.name}`.trim(),
        point: oc.point ?? null,
        price_american: oc.price,
        captured_at: capturedAt,
      })
    }
    teamTotalsTracked++
  }

  let snapshots = 0
  if (snaps.length) {
    const { error: snapErr } = await supabase.from('odds_snapshots').insert(snaps)
    if (snapErr) throw new Error(`snapshot insert: ${snapErr.message}`)
    snapshots = snaps.length
  }

  return { parsed, locked, candidates: candidates.length, matched, tracked, propsTracked, golfTracked, teamTotalsTracked, snapshots, fetched }
}

/** Odds API key(s) to search for a bet: team sports → one SPORT_KEYS entry;
 *  soccer/tennis → clv-resolve (cached key, else league sweep / live tour keys). */
function keysForBet(b: BetRow, tennisKeys: string[]): string[] {
  const teamKey = sportKeyFor(b.sport)
  if (teamKey) return [teamKey]
  return candidateOddsKeys(b.sport, b.odds_sport_key, tennisKeys)
}

function findEvent(events: OddsEvent[], b: BetRow): OddsEvent | null {
  if (b.odds_event_id) {
    const hit = events.find((e) => e.id === b.odds_event_id)
    if (hit) return hit
  }
  // team/player names match via clv_selection; Draw + totals carry no team name,
  // so fall back to the full description (which still names both teams).
  const term = b.clv_market === 'total' || b.clv_selection === 'Draw' ? b.description : b.clv_selection ?? ''
  return (
    events
      .filter((e) => Math.max(matchScore(e.home_team, term), matchScore(e.away_team, term)) >= 1)
      .sort((a, z) => +new Date(a.commence_time) - +new Date(z.commence_time))[0] ?? null
  )
}

/** Best (highest-decimal) price for a side across the sharp subset, from a fresh event.
 *  `pick` extracts the bet-side price from one book's outcomes (null if absent).
 *
 *  D-13: Kalshi's contribution is fee-adjusted before comparison. The returned price
 *  for Kalshi is the effective taker-fee-adjusted American equivalent. */
function bestPriceAcrossBooks(
  ev: OddsEvent,
  marketKey: string,
  pick: (outcomes: OddsOutcome[]) => number | null,
): { book: string; price: number } | null {
  let best: { book: string; price: number } | null = null
  for (const book of SHARP_BOOKS) {
    const bm = bookMarket(ev, book, marketKey)
    if (!bm) continue
    const rawPrice = pick(bm)
    if (rawPrice == null) continue
    // D-13: fee-adjust Kalshi's price before comparison (price-level, not threshold-level)
    let effectiveDec = americanToDecimal(rawPrice)
    let effectivePrice = rawPrice
    if (book === 'kalshi') {
      const p = 1 / effectiveDec
      const pEff = kalshiEffectiveImpliedProb(p)
      effectiveDec = 1 / pEff
      // Convert fee-adjusted decimal back to American for the returned price
      effectivePrice = effectiveDec >= 2 ? (effectiveDec - 1) * 100 : -(100 / (effectiveDec - 1))
    }
    if (!best || effectiveDec > americanToDecimal(best.price)) best = { book, price: effectivePrice }
  }
  return best
}

/** Best outright price for a golfer across the golf book set (single-price market;
 *  unique-match to avoid first-name ties in a large field). */
function bestGolfPrice(
  ev: OddsEvent,
  selection: string,
  books: readonly string[],
): { book: string; price: number } | null {
  let best: { book: string; price: number } | null = null
  for (const bookKey of books) {
    const mk = bookMarket(ev, bookKey, 'outrights')
    if (!mk) continue
    let pick: number | null = null
    let pickScore = 0
    let tie = false
    for (const o of mk) {
      const s = matchScore(o.name, selection)
      if (s > pickScore) { pickScore = s; pick = o.price; tie = false }
      else if (s === pickScore && s > 0) tie = true
    }
    if (pick != null && pickScore >= 1 && !tie) {
      if (!best || americanToDecimal(pick) > americanToDecimal(best.price)) best = { book: bookKey, price: pick }
    }
  }
  return best
}

/** Bet-side raw lines from the largest US books, for the CLV card's odds box.
 *  Pulled from the same paid event response (no extra credits); Pinnacle remains
 *  the CLV reference. Returns one row per book that offers the market. */
export function displayBookSnaps(
  ev: OddsEvent,
  marketKey: string,
  selection: string,
  point: number | null,
  books: readonly string[],
  meta: { sportKey: string; capturedAt: string },
): SnapRow[] {
  const rows: SnapRow[] = []
  for (const book of books) {
    const bm = bookMarket(ev, book, marketKey)
    if (!bm) continue
    const sel = findOutcome(bm, selection, point)
    if (!sel) continue
    rows.push({
      odds_event_id: ev.id,
      sport_key: meta.sportKey,
      commence_time: ev.commence_time,
      home_team: ev.home_team,
      away_team: ev.away_team,
      bookmaker: book,
      market: marketKey,
      selection: sel.you.name,
      point: sel.you.point ?? null,
      price_american: sel.you.price,
      captured_at: meta.capturedAt,
    })
  }
  return rows
}
