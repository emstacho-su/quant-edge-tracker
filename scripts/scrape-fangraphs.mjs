// Daily FanGraphs pitcher scrape -> public.fangraphs_pitchers (season-to-date cache).
//
// Logs into FanGraphs (WordPress wp-login) with FANGRAPHS_USER / FANGRAPHS_PASS read
// from the environment at runtime (never printed/committed), then pulls the pitching
// leaderboard via FanGraphs' authenticated JSON API and upserts on (player_id, season).
// Using the API rather than scraping the rendered grid keeps this robust; the login
// cookie also unlocks member-gated endpoints (e.g. splits) for future expansion.
//
// Feeds the mlb-pick-analysis skill's Tier-1 pitcher peripherals (FIP/xFIP/SIERA/K-BB%).
//
// Run locally:  node --env-file=.env.local scripts/scrape-fangraphs.mjs [season]
// As a routine: schedule this command daily (see api/cron note — Vercel can't host a
// browser, so this runs via a scheduled Claude routine or the local runner/Task Scheduler).
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const SEASON = Number(process.argv[2]) || new Date().getUTCFullYear()
const { FANGRAPHS_USER, FANGRAPHS_PASS } = process.env
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!FANGRAPHS_USER || !FANGRAPHS_PASS) throw new Error('FANGRAPHS_USER / FANGRAPHS_PASS missing in env (.env.local)')
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Supabase URL / service-role key missing in env (.env.local)')

const stripTags = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : s)
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
const int = (v) => (v == null || v === '' ? null : Math.trunc(Number(v)))

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const browser = await chromium.launch({ headless: true })
try {
  // A real UA is required — the default "HeadlessChrome" UA gets a bot challenge
  // instead of the login form.
  const page = await browser.newContext({ userAgent: USER_AGENT }).then((c) => c.newPage())

  // --- Login (standard WordPress form) ---
  await page.goto('https://www.fangraphs.com/blogs/wp-login.php?redirect_to=https://www.fangraphs.com/', {
    waitUntil: 'domcontentloaded',
  })
  await page.fill('#user_login', FANGRAPHS_USER)
  await page.fill('#user_pass', FANGRAPHS_PASS)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('#wp-submit'),
  ])
  if (page.url().includes('wp-login.php')) {
    const err = await page.textContent('#login_error').catch(() => null)
    throw new Error('FanGraphs login failed' + (err ? `: ${stripTags(err)}` : ' (still on wp-login)'))
  }

  // --- Pull pitching leaderboard via the authenticated JSON API ---
  const apiUrl =
    `https://www.fangraphs.com/api/leaders/major-league/data?pos=all&stats=pit&lg=all&qual=0&type=8` +
    `&season=${SEASON}&season1=${SEASON}&ind=0&team=0&month=0&pageitems=100000`
  const data = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error('FanGraphs API ' + r.status)
    const j = await r.json()
    return Array.isArray(j) ? j : j.data || j.rows || []
  }, apiUrl)
  if (!data.length) throw new Error('FanGraphs API returned 0 rows')

  const rows = data.map((p) => ({
    player_id: p.playerid,
    mlbam_id: int(p.xMLBAMID),
    season: SEASON,
    player_name: p.PlayerName ?? stripTags(p.Name),
    team: p.TeamNameAbb ?? stripTags(p.Team),
    throws: p.Throws ?? null,
    g: int(p.G),
    gs: int(p.GS),
    ip: num(p.IP),
    tbf: int(p.TBF),
    era: num(p.ERA),
    fip: num(p.FIP),
    xfip: num(p.xFIP),
    siera: num(p.SIERA),
    tera: num(p.tERA),
    xera: num(p.xERA),
    era_minus: num(p['ERA-']),
    fip_minus: num(p['FIP-']),
    xfip_minus: num(p['xFIP-']),
    k_pct: num(p['K%']),
    bb_pct: num(p['BB%']),
    k_bb_pct: num(p['K-BB%']),
    k9: num(p['K/9']),
    bb9: num(p['BB/9']),
    k_bb: num(p['K/BB']),
    whip: num(p.WHIP),
    babip: num(p.BABIP),
    lob_pct: num(p['LOB%']),
    hr9: num(p['HR/9']),
    barrel_pct: num(p['Barrel%']),
    war: num(p.WAR),
    stats: p,
    captured_at: new Date().toISOString(),
  }))

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  let upserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { error } = await supabase
      .from('fangraphs_pitchers')
      .upsert(chunk, { onConflict: 'player_id,season' })
    if (error) throw new Error('upsert: ' + error.message)
    upserted += chunk.length
  }
  console.log(`FanGraphs ${SEASON}: ${rows.length} pitchers → ${upserted} upserted`)
} finally {
  await browser.close()
}
