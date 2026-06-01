// One-shot local populate of the canonical Odds API slate into `odds_snapshots`.
// Mirrors api/_lib/odds-slate.ts so it can be run for verification WITHOUT a
// Vercel deploy (the production cron is api/cron/odds-slate.ts).
//
// Requires ODDS_API_KEY + Supabase service-role key in the environment.
// Run:  node --env-file=.env.local scripts/populate-odds-slate.mjs [sportKey ...]
// e.g.  node --env-file=.env.local scripts/populate-odds-slate.mjs baseball_mlb
import { createClient } from '@supabase/supabase-js'

const SPORTS = process.argv.slice(2).length ? process.argv.slice(2) : ['baseball_mlb']
const MARKETS = 'h2h,spreads,totals'
const REGIONS = 'us,eu'

const ODDS_KEY = process.env.ODDS_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!ODDS_KEY) throw new Error('ODDS_API_KEY missing — add it to .env.local')
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase URL / service-role key missing in .env.local')

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const capturedAt = new Date().toISOString()

for (const sportKey of SPORTS) {
  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds?apiKey=${ODDS_KEY}` +
    `&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=american&dateFormat=iso`
  const res = await fetch(url)
  const remaining = res.headers.get('x-requests-remaining')
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const events = await res.json()

  const rows = []
  for (const ev of events)
    for (const bk of ev.bookmakers ?? [])
      for (const mk of bk.markets ?? [])
        for (const oc of mk.outcomes ?? [])
          rows.push({
            odds_event_id: ev.id,
            sport_key: sportKey,
            commence_time: ev.commence_time,
            home_team: ev.home_team,
            away_team: ev.away_team,
            bookmaker: bk.key,
            market: mk.key,
            selection: oc.name,
            point: oc.point ?? null,
            price_american: oc.price,
            captured_at: capturedAt,
          })

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('odds_snapshots').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`insert ${sportKey}: ${error.message}`)
  }
  console.log(`${sportKey}: ${events.length} events → ${rows.length} snapshots (credits remaining: ${remaining})`)
}
console.log(`Done @ ${capturedAt}`)
