// One-shot bootstrap: hardcoded alias lists → team_aliases rows (source:'seed').
// Run: node scripts/seed-team-aliases.mjs
// Requires VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY in .env / .env.local
//
// The seeder is idempotent: re-runs upsert on_conflict=team_id,alias with merge-duplicates.
// Actual live upsert runs at cut-over in Plan 17-07; the pure buildSeedAliases() function is
// the testable contract (see seed-team-aliases.test.mjs).

// ---------------------------------------------------------------------------
// Inlined alias maps — copied verbatim from src/utils/team-matcher.ts
// (do NOT import from team-matcher; the seed must be self-contained so
//  deleting the regex modules at cut-over (D-16 Plan 17-07) does not break the seed)
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const MLB_ABBREVS = {
  astros: 'HOU', yankees: 'NYY', dodgers: 'LAD', orioles: 'BAL',
  braves: 'ATL', 'red sox': 'BOS', 'white sox': 'CHW', cubs: 'CHC',
  reds: 'CIN', guardians: 'CLE', rockies: 'COL', tigers: 'DET',
  marlins: 'MIA', twins: 'MIN', mets: 'NYM', athletics: 'OAK',
  phillies: 'PHI', pirates: 'PIT', padres: 'SD', giants: 'SF',
  mariners: 'SEA', cardinals: 'STL', rays: 'TB',
  'blue jays': 'TOR', nationals: 'WSH', brewers: 'MIL', royals: 'KC',
  angels: 'LAA', diamondbacks: 'ARI', rangers: 'TEX',
  // City abbreviations from bet descriptions
  hou: 'HOU', nyy: 'NYY', lad: 'LAD', bal: 'BAL', atl: 'ATL',
  bos: 'BOS', chw: 'CHW', chc: 'CHC', cin: 'CIN', cle: 'CLE',
  col: 'COL', det: 'DET', mia: 'MIA', min: 'MIN', nym: 'NYM',
  oak: 'OAK', phi: 'PHI', pit: 'PIT', sdp: 'SD', sfg: 'SF',
  sea: 'SEA', stl: 'STL', tbr: 'TB', tex: 'TEX', tor: 'TOR',
  wsn: 'WSH', mil: 'MIL', kcr: 'KC', kc: 'KC', laa: 'LAA',
  ari: 'ARI', sd: 'SD', sf: 'SF', tb: 'TB', wsh: 'WSH',
}

/** @type {Record<string, string>} */
const NBA_ABBREVS = {
  hawks: 'ATL', celtics: 'BOS', nets: 'BKN', hornets: 'CHA',
  bulls: 'CHI', cavaliers: 'CLE', mavericks: 'DAL', nuggets: 'DEN',
  pistons: 'DET', warriors: 'GS', rockets: 'HOU', pacers: 'IND',
  clippers: 'LAC', lakers: 'LAL', grizzlies: 'MEM', heat: 'MIA',
  bucks: 'MIL', timberwolves: 'MIN', pelicans: 'NOP', knicks: 'NY',
  thunder: 'OKC', magic: 'ORL', sixers: 'PHI', '76ers': 'PHI',
  suns: 'PHX', blazers: 'POR', 'trail blazers': 'POR',
  spurs: 'SA', raptors: 'TOR', jazz: 'UTAH', wizards: 'WSH',
  kings: 'SAC',
  // City abbreviations
  atl: 'ATL', bos: 'BOS', bkn: 'BKN', cha: 'CHA', chi: 'CHI',
  cle: 'CLE', dal: 'DAL', den: 'DEN', det: 'DET', gsw: 'GS', gs: 'GS',
  hou: 'HOU', ind: 'IND', lac: 'LAC', lal: 'LAL', mem: 'MEM',
  mia: 'MIA', mil: 'MIL', min: 'MIN', nop: 'NOP', nyk: 'NY', ny: 'NY',
  okc: 'OKC', orl: 'ORL', phi: 'PHI', phx: 'PHX', por: 'POR',
  sac: 'SAC', sas: 'SA', sa: 'SA', tor: 'TOR', uta: 'UTAH', was: 'WSH',
}

/** @type {Record<string, string>} */
const NHL_ABBREVS = {
  ducks: 'ANA', coyotes: 'ARI', bruins: 'BOS', sabres: 'BUF',
  flames: 'CGY', hurricanes: 'CAR', blackhawks: 'CHI', avalanche: 'COL',
  'blue jackets': 'CBJ', stars: 'DAL', 'red wings': 'DET', oilers: 'EDM',
  panthers: 'FLA', wild: 'MIN', canadiens: 'MTL',
  predators: 'NSH', devils: 'NJ', islanders: 'NYI', rangers: 'NYR',
  senators: 'OTT', flyers: 'PHI', penguins: 'PIT', sharks: 'SJ',
  kraken: 'SEA', blues: 'STL', lightning: 'TB', 'maple leafs': 'TOR',
  canucks: 'VAN', 'golden knights': 'VGK', capitals: 'WSH', jets: 'WPG',
  kings: 'LA',
  // City abbreviations
  ana: 'ANA', bos: 'BOS', buf: 'BUF', cgy: 'CGY', car: 'CAR',
  chi: 'CHI', col: 'COL', cbj: 'CBJ', dal: 'DAL', det: 'DET',
  edm: 'EDM', fla: 'FLA', la: 'LA', lak: 'LA', min: 'MIN', mtl: 'MTL',
  mon: 'MTL', nsh: 'NSH', njd: 'NJ', nj: 'NJ', nyi: 'NYI', nyr: 'NYR',
  ott: 'OTT', phi: 'PHI', pit: 'PIT', sjs: 'SJ', sj: 'SJ',
  sea: 'SEA', stl: 'STL', tbl: 'TB', tb: 'TB', tor: 'TOR',
  van: 'VAN', vgk: 'VGK', wsh: 'WSH', wpg: 'WPG', win: 'WPG',
}

/** @type {Record<string, string>} */
const NFL_ABBREVS = {
  cardinals: 'ARI', falcons: 'ATL', ravens: 'BAL', bills: 'BUF',
  panthers: 'CAR', bears: 'CHI', bengals: 'CIN', browns: 'CLE',
  cowboys: 'DAL', broncos: 'DEN', lions: 'DET', packers: 'GB',
  texans: 'HOU', colts: 'IND', jaguars: 'JAX', chiefs: 'KC',
  raiders: 'LV', chargers: 'LAC', rams: 'LAR', dolphins: 'MIA',
  vikings: 'MIN', patriots: 'NE', saints: 'NO', giants: 'NYG',
  jets: 'NYJ', eagles: 'PHI', steelers: 'PIT', '49ers': 'SF',
  niners: 'SF', seahawks: 'SEA', buccaneers: 'TB', titans: 'TEN',
  commanders: 'WSH',
  // City / common abbreviations
  ari: 'ARI', atl: 'ATL', bal: 'BAL', buf: 'BUF', car: 'CAR',
  chi: 'CHI', cin: 'CIN', cle: 'CLE', dal: 'DAL', den: 'DEN',
  det: 'DET', gb: 'GB', gbp: 'GB', hou: 'HOU', ind: 'IND',
  jax: 'JAX', kc: 'KC', kcc: 'KC', lv: 'LV', lvr: 'LV',
  lac: 'LAC', lar: 'LAR', mia: 'MIA', min: 'MIN', ne: 'NE',
  nep: 'NE', no: 'NO', nos: 'NO', nyg: 'NYG', nyj: 'NYJ',
  phi: 'PHI', pit: 'PIT', sf: 'SF', sfo: 'SF', sea: 'SEA',
  tb: 'TB', tbb: 'TB', ten: 'TEN', wsh: 'WSH', was: 'WSH',
}

/** @type {Record<string, string>} */
const WNBA_ABBREVS = {
  // Team names (lowercase) -> ESPN scoreboard abbreviation
  aces: 'LV',          // Las Vegas Aces
  liberty: 'NY',       // New York Liberty
  sky: 'CHI',          // Chicago Sky  <- 3 letters, MUST be here (fuzzy fallback drops it)
  fever: 'IND',        // Indiana Fever
  storm: 'SEA',        // Seattle Storm
  lynx: 'MIN',         // Minnesota Lynx
  mercury: 'PHX',      // Phoenix Mercury
  sun: 'CON',          // Connecticut Sun  <- 3 letters, MUST be here (verified vs ESPN teams + scoreboard)
  wings: 'DAL',        // Dallas Wings
  dream: 'ATL',        // Atlanta Dream
  mystics: 'WSH',      // Washington Mystics
  sparks: 'LA',        // Los Angeles Sparks
  valkyries: 'GS',     // Golden State Valkyries
  // City abbreviations (lowercase)
  lv: 'LV', ny: 'NY', chi: 'CHI', ind: 'IND', sea: 'SEA',
  min: 'MIN', phx: 'PHX', conn: 'CON', dal: 'DAL',
  atl: 'ATL', wsh: 'WSH', la: 'LA', gs: 'GS',
  // City full names
  'las vegas': 'LV', 'new york': 'NY', chicago: 'CHI',
  indiana: 'IND', seattle: 'SEA', minnesota: 'MIN',
  phoenix: 'PHX', connecticut: 'CON', dallas: 'DAL',
  atlanta: 'ATL', washington: 'WSH', 'los angeles': 'LA',
  'golden state': 'GS',
}

// Abbrev-map lookup by sport (matches team-matcher.ts ABBREV_BY_SPORT)
const ABBREV_BY_SPORT = {
  MLB: MLB_ABBREVS,
  NBA: NBA_ABBREVS,
  WNBA: WNBA_ABBREVS,
  NHL: NHL_ABBREVS,
  NFL: NFL_ABBREVS,
}

// ---------------------------------------------------------------------------
// Inlined display-name lists — copied verbatim from src/utils/sport-detector.ts
// D-03a collision variants are preserved exactly as they appear in the source.
// ---------------------------------------------------------------------------

const MLB_DISPLAY_NAMES = [
  'Astros', 'Yankees', 'Dodgers', 'Orioles', 'Braves', 'Red Sox', 'White Sox',
  'Cubs', 'Reds', 'Guardians', 'Rockies', 'Tigers', 'Marlins', 'Twins', 'Mets',
  'Athletics', 'Phillies', 'Pirates', 'Padres', 'Giants', 'Mariners', 'Cardinals',
  'Rays', 'Rangers', 'Blue Jays', 'Nationals', 'Brewers', 'Royals', 'Angels',
  'Diamondbacks',
]

const NBA_DISPLAY_NAMES = [
  'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks',
  'Nuggets', 'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers',
  'Grizzlies', 'Heat', 'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder',
  'Magic', 'Sixers', '76ers', 'Suns', 'Blazers', 'Trail Blazers',
  'Sacramento Kings', 'SAC Kings', 'Kings',      // D-03a: full-name collision variants
  'Spurs', 'Raptors', 'Jazz', 'Wizards',
]

const NFL_DISPLAY_NAMES = [
  'Cardinals', 'Falcons', 'Ravens', 'Bills',
  'Carolina Panthers', 'CAR Panthers', 'Panthers',  // D-03a: Panthers collision variants
  'Bears', 'Bengals',
  'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts',
  'Jaguars', 'Chiefs', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots',
  'Saints', 'Jets', 'Raiders', 'Eagles', 'Steelers', 'Seahawks', 'Buccaneers',
  'Titans', 'Commanders', '49ers', 'Niners',
]

const NHL_DISPLAY_NAMES = [
  'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes', 'Blackhawks',
  'Avalanche', 'Blue Jackets', 'Stars', 'Red Wings', 'Oilers',
  'Florida Panthers', 'FLA Panthers', 'FLO Panthers', 'Panthers',  // D-03a: Panthers NHL variants
  'LA Kings', 'Los Angeles Kings', 'L.A. Kings', 'Kings',           // D-03a: Kings NHL variants
  'Wild', 'Canadiens', 'Predators', 'Devils', 'Islanders', 'Senators',
  'Flyers', 'Penguins', 'Sharks', 'Kraken', 'Blues', 'Lightning', 'Maple Leafs',
  'Canucks', 'Golden Knights', 'Capitals', 'Jets',
]

// WNBA display names — collision-safe variants (not in sport-detector.ts WNBA section,
// but required by D-03a: 'Dallas Wings' not bare 'Wings', 'Las Vegas Aces' not bare 'Aces').
// The full-name variants are embedded here to survive as seed rows.
const WNBA_DISPLAY_NAMES = [
  'Las Vegas Aces',    // collision-safe: bare 'Aces' avoided (tennis "Aces" clash)
  'New York Liberty',
  'Chicago Sky',
  'Indiana Fever',
  'Seattle Storm',
  'Minnesota Lynx',
  'Phoenix Mercury',
  'Connecticut Sun',
  'Dallas Wings',      // collision-safe: bare 'Wings' alone would collide with NHL Red Wings
  'Atlanta Dream',
  'Washington Mystics',
  'Los Angeles Sparks',
  'Golden State Valkyries',
]

// Per-sport display-name lists
const DISPLAY_NAMES_BY_SPORT = {
  MLB: MLB_DISPLAY_NAMES,
  NBA: NBA_DISPLAY_NAMES,
  NFL: NFL_DISPLAY_NAMES,
  NHL: NHL_DISPLAY_NAMES,
  WNBA: WNBA_DISPLAY_NAMES,
}

// ---------------------------------------------------------------------------
// buildSeedAliases — pure function (no I/O)
// ---------------------------------------------------------------------------

/**
 * Returns an array of {sport, abbreviation, alias, source:'seed'} records derived from:
 *   (a) every key of each *_ABBREVS map → {sport, abbreviation: mapValue, alias: key}
 *   (b) every display-name from the display-name lists → resolved to abbreviation via
 *       the same sport's ABBREV_BY_SPORT map; drop if no mapping found (unmatchable display name).
 *
 * Every record is sport-scoped: "cardinals" yields BOTH {MLB,STL} and {NFL,ARI}.
 * All aliases are lowercased. Deduplication is by (sport, abbreviation, alias) triple.
 *
 * @returns {{ sport: string, abbreviation: string, alias: string, source: 'seed' }[]}
 */
export function buildSeedAliases() {
  /** @type {Map<string, { sport: string, abbreviation: string, alias: string, source: 'seed' }>} */
  const seen = new Map()

  /**
   * @param {string} sport
   * @param {string} abbreviation
   * @param {string} alias
   */
  function emit(sport, abbreviation, alias) {
    const key = `${sport}|${abbreviation}|${alias}`
    if (!seen.has(key)) {
      seen.set(key, { sport, abbreviation, alias, source: 'seed' })
    }
  }

  // (a) Emit every key from each *_ABBREVS map
  for (const [sport, map] of Object.entries(ABBREV_BY_SPORT)) {
    for (const [alias, abbreviation] of Object.entries(map)) {
      emit(sport, abbreviation, alias.toLowerCase())
    }
  }

  // (b) Emit every display-name, resolving abbreviation via the same sport's abbrev map
  for (const [sport, names] of Object.entries(DISPLAY_NAMES_BY_SPORT)) {
    const abbrevMap = ABBREV_BY_SPORT[sport]
    for (const name of names) {
      const lower = name.toLowerCase()
      const abbreviation = abbrevMap[lower]
      if (abbreviation) {
        emit(sport, abbreviation, lower)
      } else {
        // Display name not found in abbrev map — warn but continue (error-continue pattern)
        // This happens for multi-word display names whose single-word key is the lookup
        // (e.g. 'Sacramento Kings' → abbrevMap['sacramento kings'] may not exist; the
        //  bare key 'kings' IS in the map). We still want the full-name variant as an alias.
        // Strategy: emit with the abbreviation resolved from the bare last-word token, or
        // do a manual lookup pass for the D-03a multi-word variants.
        const resolved = resolveDisplayNameAbbrev(sport, name, abbrevMap)
        if (resolved) {
          emit(sport, resolved, lower)
        } else {
          console.warn(`[seed-team-aliases] no abbrev found for "${name}" in ${sport} — skipped`)
        }
      }
    }
  }

  return [...seen.values()]
}

/**
 * Resolve abbreviation for display names not directly in the abbrev map.
 * Used for multi-word variants like 'Sacramento Kings', 'Carolina Panthers',
 * 'Florida Panthers', 'LA Kings', 'Los Angeles Kings', 'Dallas Wings', 'Las Vegas Aces'.
 *
 * Strategy: check the last word(s) of the name against the abbrev map;
 * also check well-known prefix mappings.
 *
 * @param {string} sport
 * @param {string} name
 * @param {Record<string, string>} abbrevMap
 * @returns {string | undefined}
 */
function resolveDisplayNameAbbrev(sport, name, abbrevMap) {
  const lower = name.toLowerCase()
  const words = lower.split(/\s+/)

  // Try last word (e.g. 'Kings', 'Panthers', 'Wings', 'Aces')
  const lastWord = words[words.length - 1]
  if (abbrevMap[lastWord]) return abbrevMap[lastWord]

  // Try last two words
  if (words.length >= 2) {
    const lastTwo = words.slice(-2).join(' ')
    if (abbrevMap[lastTwo]) return abbrevMap[lastTwo]
  }

  // Try first word — covers abbreviation-prefixed variants like 'CAR Panthers', 'FLA Panthers',
  // 'SAC Kings', 'LA Kings'
  const firstWord = words[0]
  if (abbrevMap[firstWord]) return abbrevMap[firstWord]

  // Try known city + nickname patterns for NHL multi-word variants
  // 'Los Angeles Kings' → 'los angeles' prefix → WNBA has 'los angeles' key; NHL uses lastWord
  // 'L.A. Kings' → remove periods → 'l.a.' not in map; fallback to 'kings'
  const noPeriods = lower.replace(/\./g, '')
  if (abbrevMap[noPeriods]) return abbrevMap[noPeriods]

  return undefined
}

// ---------------------------------------------------------------------------
// Runner — gated behind import.meta.url check so importing for tests is safe
// ---------------------------------------------------------------------------

if (import.meta.url === new URL(import.meta.url).href &&
    process.argv[1] &&
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  await runSeeder()
}

async function runSeeder() {
  const { readFileSync, existsSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join, resolve } = await import('node:path')

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
  const SUPABASE_URL =
    env.match(/^SUPABASE_URL=(.+)$/m)?.[1]?.trim() ??
    env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1]?.trim()
  const KEY = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m)?.[1]?.trim()
  if (!SUPABASE_URL || !KEY) throw new Error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

  // 1. Fetch existing teams to build (sport+abbreviation) → team_id lookup
  const teamsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?select=id,sport,abbreviation`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
  if (!teamsRes.ok) throw new Error(`fetch teams failed ${teamsRes.status}: ${await teamsRes.text()}`)
  const teams = await teamsRes.json()

  /** @type {Map<string, string>} sport+abbrev → team_id */
  const teamLookup = new Map()
  for (const { id, sport, abbreviation } of teams) {
    teamLookup.set(`${sport}|${abbreviation}`, id)
  }

  // 2. Build alias records, join to team_id
  const seedRecords = buildSeedAliases()
  const rows = []
  let skipped = 0

  for (const { sport, abbreviation, alias } of seedRecords) {
    const teamId = teamLookup.get(`${sport}|${abbreviation}`)
    if (!teamId) {
      console.warn(`[seed-team-aliases] no team row for ${sport}/${abbreviation} — skipping alias "${alias}"`)
      skipped++
      continue
    }
    rows.push({ team_id: teamId, alias, source: 'seed' })
  }

  if (rows.length === 0) {
    console.log('No alias rows to upsert (all teams missing from DB?). Ensure seed-teams.mjs ran first.')
    return
  }

  // 3. Upsert into team_aliases; conflict key is (team_id, alias)
  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/team_aliases?on_conflict=team_id,alias`,
    {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  )
  if (!upsertRes.ok) throw new Error(`upsert failed ${upsertRes.status}: ${await upsertRes.text()}`)

  console.log(`seeded ${rows.length} team_aliases rows (source:'seed'); ${skipped} skipped (no matching team row)`)
}
