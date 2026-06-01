import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getServiceClient } from '../_lib/supabase-admin.js'
import {
  LEAGUES,
  fetchLeagueTeams,
  parseEspnTeams,
  type TeamRow,
} from '../_lib/espn-teams.js'

/**
 * mm-dd ranges (inclusive) for each sport's active season.
 * Year-wrap sports (NBA, NHL, NFL) have start > end — in-season when mmdd >= start OR mmdd <= end.
 * Unknown sports default to in-season (never accidentally skip).
 */
const SEASON_WINDOWS: Record<string, [string, string]> = {
  MLB:  ['04-01', '10-31'],
  NBA:  ['10-01', '06-30'],
  NHL:  ['10-01', '06-30'],
  NFL:  ['09-01', '02-28'],
  WNBA: ['05-01', '10-31'],
}

/**
 * Returns true when `sport` is in-season as of `now`.
 * Unknown sport → true (fail-open: never skip an unrecognised league).
 * Exported so tests can inject a fixed `now` date.
 */
export function isInSeason(sport: string, now: Date = new Date()): boolean {
  const window = SEASON_WINDOWS[sport]
  if (!window) return true // unknown sport → always refresh

  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const mmdd = `${mm}-${dd}`

  const [start, end] = window
  if (start > end) {
    // Year-wrap window (e.g. NBA Oct–Jun): in-season when on or after start OR on or before end
    return mmdd >= start || mmdd <= end
  }
  // Normal window (e.g. MLB Apr–Oct): in-season when within [start, end]
  return mmdd >= start && mmdd <= end
}

/**
 * GET /api/cron/refresh-teams — daily-in-season upsert of the `teams` table from ESPN.
 * Secured by CRON_SECRET (Vercel sends `Authorization: Bearer <CRON_SECRET>`).
 * Off-season leagues are skipped via the isInSeason gate (D-14/D-15).
 * This cron is TEAM-ONLY — roster pulls and the resolution agent run on the daemon (D-15 split).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const rows: TeamRow[] = []
  for (const lg of LEAGUES) {
    if (!isInSeason(lg.sport)) continue
    try {
      rows.push(...parseEspnTeams(await fetchLeagueTeams(lg.path), lg.sport, lg.league))
    } catch (e) {
      console.error(`refresh-teams ${lg.league}:`, (e as Error).message)
    }
  }
  if (rows.length === 0) return res.status(502).json({ error: 'no teams fetched' })

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('teams')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'league,abbreviation' },
    )
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, upserted: rows.length })
}
