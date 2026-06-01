// Run: node scripts/seed-teams.mjs
// Fetches ESPN teams for all LEAGUES and upserts them into public.teams.
// Requires VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY
// in .env / .env.local (teams is read-only to anon; writes need the service role).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

function readEnvFile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    for (const name of ['.env', '.env.local']) {
      const p = join(dir, name)
      if (existsSync(p)) return readFileSync(p, 'utf8')
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('No .env/.env.local found')
}

const env = readEnvFile()
const URL =
  env.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim() ??
  env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
const KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim()
if (!URL || !KEY) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

const LEAGUES = [
  ['MLB', 'mlb', 'baseball/mlb'],
  ['NBA', 'nba', 'basketball/nba'],
  ['WNBA', 'wnba', 'basketball/wnba'],
  ['NHL', 'nhl', 'hockey/nhl'],
  ['NFL', 'nfl', 'football/nfl'],
]

const rows = []
for (const [sport, league, path] of LEAGUES) {
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams`)
  const j = await r.json()
  for (const { team: t } of j?.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    if (!t?.abbreviation || !t?.displayName) continue
    rows.push({
      sport,
      league,
      full_name: t.displayName,
      location: t.location ?? null,
      nickname: t.name ?? null,
      abbreviation: t.abbreviation,
      aliases: [...new Set([t.shortDisplayName, t.slug, t.name, t.location].filter(Boolean))],
      espn_id: t.id != null ? String(t.id) : null,
    })
  }
}

const res = await fetch(`${URL}/rest/v1/teams?on_conflict=league,abbreviation`, {
  method: 'POST',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(rows),
})
if (!res.ok) throw new Error(`upsert failed ${res.status}: ${await res.text()}`)
console.log(`seeded ${rows.length} teams across ${LEAGUES.length} leagues`)
