// Run: node scripts/backfill-wnba-sport.mjs --dry-run  (preview — lists candidates, no writes)
//      node scripts/backfill-wnba-sport.mjs            (apply — patches matched bets to sport='WNBA')
//
// One-time maintenance script that re-tags bets mis-filed under sport='NBA' or sport='unknown'
// when the bet description indicates a WNBA game. Mirrors the sport-detector WNBA rule
// (WNBA_TEAMS + WNBA_KEYWORDS) as plain JS — cannot import TypeScript source directly.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

// Prefer .env, fall back to .env.local (Vite convention).
// Walks up from the script's directory to handle git worktrees where the
// working tree root may differ from the main repo root.
function readEnvFile() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    for (const name of ['.env', '.env.local']) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8')
    }
    const parent = resolve(dir, '..')
    if (parent === dir) break  // filesystem root
    dir = parent
  }
  throw new Error('No .env or .env.local found (searched up to 6 levels from scripts/)')
}

const env = readEnvFile()
const SUPABASE_URL = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
const KEY = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()
if (!SUPABASE_URL || !KEY) throw new Error('missing supabase env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function api(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
  })
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ---------------------------------------------------------------------------
// Inline WNBA matcher — mirrors sport-detector.ts WNBA_TEAMS + WNBA_KEYWORDS
// (plain JS; cannot import the TypeScript source directly)
// ---------------------------------------------------------------------------

// Team names from WNBA_TEAMS. Note:
// - 'Las Vegas Aces' instead of 'Aces' (bare 'Aces' is a Tennis keyword collision)
// - 'Dallas Wings' instead of 'Wings' (bare 'Wings' would match NHL Red Wings)
// - 'Sky' and 'Sun' omitted here (3-char names below word-boundary usefulness);
//   they are covered by the WNBA keyword check below.
const WNBA_TEAM_NAMES = [
  'Las Vegas Aces', 'Liberty', 'Dallas Wings', 'Fever', 'Storm', 'Lynx',
  'Mercury', 'Sun', 'Dream', 'Mystics', 'Sparks', 'Valkyries',
  // Also include short forms that appear in real bet descriptions
  'Sky',
]

const WNBA_KEYWORD_LIST = ['WNBA', "Women's Basketball", "Women's National Basketball"]

// Build a combined regex: team names (word-boundary) OR keywords (word-boundary)
const WNBA_TEAM_RE = new RegExp(
  `\\b(?:${WNBA_TEAM_NAMES.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
)
const WNBA_KEYWORD_RE = new RegExp(
  `\\b(?:${WNBA_KEYWORD_LIST.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
)

function isWnbaBet(description) {
  if (!description) return false
  return WNBA_KEYWORD_RE.test(description) || WNBA_TEAM_RE.test(description)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  if (isDryRun) {
    console.log('[dry-run] Scanning for WNBA bets — no writes will be made.')
  }

  // Fetch candidates: bets currently filed as NBA or unknown
  const bets = await api(
    '/bets?sport=in.(NBA,unknown)&select=id,description,sport&limit=500',
  )

  if (!bets || bets.length === 0) {
    console.log('No candidate bets found (sport=NBA or unknown).')
    return
  }

  // Filter to rows whose description matches the WNBA matcher
  const toUpdate = bets.filter(b => isWnbaBet(b.description))

  console.log(`Found ${toUpdate.length} bets to re-tag as WNBA (out of ${bets.length} candidates):`)
  for (const b of toUpdate) {
    console.log(`  ${b.id.slice(0, 8)} | sport=${b.sport} | ${b.description}`)
  }

  if (isDryRun) {
    console.log('\n[dry-run] No changes applied. Remove --dry-run to apply.')
    return
  }

  if (toUpdate.length === 0) {
    console.log('Nothing to update.')
    return
  }

  console.log('\nApplying updates...')
  for (const bet of toUpdate) {
    await api(`/bets?id=eq.${bet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sport: 'WNBA' }),
    })
    console.log(`  ✓ ${bet.description.slice(0, 60)} → sport='WNBA'`)
  }

  console.log(`\nDone. ${toUpdate.length} bet(s) re-tagged to sport='WNBA'.`)
  console.log('Run the app and verify: badge color, sport-performance stats, and live matching should now work.')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
