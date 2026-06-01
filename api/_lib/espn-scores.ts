import type { FinalGame } from './evaluate-selection.js'

/** A final game with its ESPN event id + how it ended (for matching + audit). */
export interface FinalGameRow extends FinalGame {
  espnId: string
  statusDetail: string // ESPN shortDetail: 'Final', 'Final/OT', 'Final/SO', 'Final/10'
  finalType: string // classified: 'regulation' | 'overtime' | 'shootout' | 'extra_innings'
}

/** Sport → ESPN scoreboard league path(s). Team sports the settler handles. */
export const LEAGUES_BY_SPORT: Record<string, readonly string[]> = {
  MLB: ['baseball/mlb'],
  NBA: ['basketball/nba'],
  WNBA: ['basketball/wnba'],
  NHL: ['hockey/nhl'],
  NFL: ['football/nfl'],
  NCAAB: ['basketball/mens-college-basketball'],
  NCAAF: ['football/college-football'],
}

interface EspnCompetitor {
  homeAway?: 'home' | 'away'
  score?: string
  team?: { abbreviation?: string; shortDisplayName?: string }
}
interface EspnStatusType {
  name?: string
  state?: string
  completed?: boolean
  shortDetail?: string
}
interface EspnEvent {
  id?: string
  competitions?: Array<{
    competitors?: EspnCompetitor[]
    status?: { type?: EspnStatusType }
  }>
}

function num(s: string | undefined): number {
  const n = parseInt(s ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sport-specific classification of HOW a final game ended, from ESPN's
 * shortDetail. Recorded in the settlement audit so OT/SO/extra-inning results
 * are transparent. The final SCORE already reflects OT, so this is for the log,
 * not the math.
 */
export function finalTypeFor(sport: string, statusDetail: string): string {
  const d = statusDetail.toLowerCase()
  if (sport === 'MLB') return /\/\d+/.test(d) ? 'extra_innings' : 'regulation'
  if (sport === 'NHL') {
    if (d.includes('so')) return 'shootout'
    if (d.includes('ot')) return 'overtime'
    return 'regulation'
  }
  // NBA / NFL / NCAA*: OT shows as "Final/OT" (or "/2OT", etc.)
  return d.includes('ot') ? 'overtime' : 'regulation'
}

/**
 * Pure: extract only truly-ended games from an ESPN scoreboard payload.
 * Finality uses `status.type.completed` — which ESPN keeps false through OT,
 * shootouts, and extra innings until the game is actually over (OT-aware).
 */
export function parseScoreboard(json: unknown, sport = ''): FinalGameRow[] {
  const events = (json as { events?: EspnEvent[] })?.events ?? []
  const out: FinalGameRow[] = []
  for (const ev of events) {
    const comp = ev.competitions?.[0]
    const t = comp?.status?.type
    if (!comp || t?.completed !== true || t?.state !== 'post') continue
    const cs = comp.competitors ?? []
    const home = cs.find((c) => c.homeAway === 'home') ?? cs[0]
    const away = cs.find((c) => c.homeAway === 'away') ?? cs[1]
    if (!home || !away || !ev.id) continue
    const statusDetail = t.shortDetail ?? 'Final'
    out.push({
      espnId: ev.id,
      homeAbbrev: home.team?.abbreviation ?? '',
      homeName: home.team?.shortDisplayName ?? '',
      awayAbbrev: away.team?.abbreviation ?? '',
      awayName: away.team?.shortDisplayName ?? '',
      homeScore: num(home.score),
      awayScore: num(away.score),
      statusDetail,
      finalType: finalTypeFor(sport, statusDetail),
    })
  }
  return out
}

/** Fetch + parse all final games for a sport on a given YYYYMMDD date. */
export async function fetchFinalGames(sport: string, dateStr: string): Promise<FinalGameRow[]> {
  const leagues = LEAGUES_BY_SPORT[sport] ?? []
  const out: FinalGameRow[] = []
  for (const path of leagues) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateStr}`,
      )
      if (!res.ok) continue
      out.push(...parseScoreboard(await res.json(), sport))
    } catch {
      // swallow per-league fetch errors; other leagues/dates still settle
    }
  }
  return out
}

/** YYYYMMDD strings to query: each bet's placed-at day plus today. */
export function dateStringsFor(placedAtIsos: readonly string[]): string[] {
  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const set = new Set<string>([fmt(new Date())])
  for (const iso of placedAtIsos) set.add(fmt(new Date(iso)))
  return Array.from(set)
}
