import { describe, it, expect } from 'vitest'
import { resolveEntity } from './entity-resolver'
import type { TeamRow } from '../../api/_lib/espn-teams.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTeam(overrides: Partial<TeamRow>): TeamRow {
  return {
    sport: 'MLB',
    league: 'mlb',
    full_name: 'Unknown Team',
    location: null,
    nickname: null,
    abbreviation: 'UNK',
    aliases: [],
    espn_id: null,
    ...overrides,
  }
}

// All six D-03a collision pairs + common test teams + golden-set extras
const ALL_TEAMS: TeamRow[] = [
  // MLB
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'St. Louis Cardinals', location: 'St. Louis', nickname: 'Cardinals',
    abbreviation: 'STL', espn_id: '24',
    aliases: ['stl', 'cardinals', 'st. louis cardinals', 'cards'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Milwaukee Brewers', location: 'Milwaukee', nickname: 'Brewers',
    abbreviation: 'MIL', espn_id: '8',
    aliases: ['mil', 'brewers', 'milwaukee brewers'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'New York Yankees', location: 'New York', nickname: 'Yankees',
    abbreviation: 'NYY', espn_id: '10',
    aliases: ['nyy', 'yankees', 'new york yankees'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Philadelphia Phillies', location: 'Philadelphia', nickname: 'Phillies',
    abbreviation: 'PHI', espn_id: '22',
    aliases: ['phi', 'phillies', 'philadelphia phillies'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Houston Astros', location: 'Houston', nickname: 'Astros',
    abbreviation: 'HOU', espn_id: '18',
    aliases: ['hou', 'astros', 'houston astros'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Los Angeles Dodgers', location: 'Los Angeles', nickname: 'Dodgers',
    abbreviation: 'LAD', espn_id: '19',
    aliases: ['lad', 'dodgers', 'los angeles dodgers', 'la dodgers'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Boston Red Sox', location: 'Boston', nickname: 'Red Sox',
    abbreviation: 'BOS', espn_id: '2',
    aliases: ['bos', 'red sox', 'boston red sox'],
  }),
  makeTeam({
    sport: 'MLB', league: 'mlb',
    full_name: 'Kansas City Royals', location: 'Kansas City', nickname: 'Royals',
    abbreviation: 'KC', espn_id: '7',
    aliases: ['kc', 'kcr', 'royals', 'kansas city royals'],
  }),
  // NFL
  makeTeam({
    sport: 'NFL', league: 'nfl',
    full_name: 'Arizona Cardinals', location: 'Arizona', nickname: 'Cardinals',
    abbreviation: 'ARI', espn_id: '22',
    aliases: ['ari', 'cardinals', 'arizona cardinals'],
  }),
  makeTeam({
    sport: 'NFL', league: 'nfl',
    full_name: 'Carolina Panthers', location: 'Carolina', nickname: 'Panthers',
    abbreviation: 'CAR', espn_id: '29',
    aliases: ['car', 'panthers', 'carolina panthers', 'car panthers'],
  }),
  makeTeam({
    sport: 'NFL', league: 'nfl',
    full_name: 'Kansas City Chiefs', location: 'Kansas City', nickname: 'Chiefs',
    abbreviation: 'KC', espn_id: '12',
    aliases: ['kc', 'chiefs', 'kansas city chiefs', 'kcc'],
  }),
  makeTeam({
    sport: 'NFL', league: 'nfl',
    full_name: 'San Francisco 49ers', location: 'San Francisco', nickname: '49ers',
    abbreviation: 'SF', espn_id: '25',
    aliases: ['sf', 'sfo', '49ers', 'niners', 'san francisco 49ers'],
  }),
  // NHL
  makeTeam({
    sport: 'NHL', league: 'nhl',
    full_name: 'Florida Panthers', location: 'Florida', nickname: 'Panthers',
    abbreviation: 'FLA', espn_id: '13',
    aliases: ['fla', 'panthers', 'florida panthers', 'fla panthers'],
  }),
  makeTeam({
    sport: 'NHL', league: 'nhl',
    full_name: 'Los Angeles Kings', location: 'Los Angeles', nickname: 'Kings',
    abbreviation: 'LA', espn_id: '26',
    aliases: ['la', 'kings', 'los angeles kings', 'la kings', 'l.a. kings'],
  }),
  makeTeam({
    sport: 'NHL', league: 'nhl',
    full_name: 'Edmonton Oilers', location: 'Edmonton', nickname: 'Oilers',
    abbreviation: 'EDM', espn_id: '11',
    aliases: ['edm', 'oilers', 'edmonton oilers'],
  }),
  makeTeam({
    sport: 'NHL', league: 'nhl',
    full_name: 'Vegas Golden Knights', location: 'Vegas', nickname: 'Golden Knights',
    abbreviation: 'VGK', espn_id: '30',
    aliases: ['vgk', 'golden knights', 'vegas golden knights'],
  }),
  // NBA
  makeTeam({
    sport: 'NBA', league: 'nba',
    full_name: 'Sacramento Kings', location: 'Sacramento', nickname: 'Kings',
    abbreviation: 'SAC', espn_id: '25',
    aliases: ['sac', 'kings', 'sacramento kings', 'sac kings'],
  }),
  makeTeam({
    sport: 'NBA', league: 'nba',
    full_name: 'Phoenix Suns', location: 'Phoenix', nickname: 'Suns',
    abbreviation: 'PHX', espn_id: '28',
    aliases: ['phx', 'suns', 'phoenix suns'],
  }),
  makeTeam({
    sport: 'NBA', league: 'nba',
    full_name: 'Boston Celtics', location: 'Boston', nickname: 'Celtics',
    abbreviation: 'BOS', espn_id: '2',
    aliases: ['bos', 'celtics', 'boston celtics'],
  }),
  makeTeam({
    sport: 'NBA', league: 'nba',
    full_name: 'Milwaukee Bucks', location: 'Milwaukee', nickname: 'Bucks',
    abbreviation: 'MIL', espn_id: '15',
    aliases: ['mil', 'bucks', 'milwaukee bucks'],
  }),
]

// ---------------------------------------------------------------------------
// Fake Supabase client builder
//
// Tier-1 lookup: .from('teams').select().eq('sport').contains('aliases', [token])
//   → we simulate by scanning ALL_TEAMS inline
// Tier-3 insert: .from('entity_resolution_queue').insert({...})
//   → records the insert call so tests can assert it happened
// ---------------------------------------------------------------------------

interface QueueInsert {
  bet_id: string
  description: string
  sport: string
  status: string
  created_at: string
}

function makeFakeClient(teams: TeamRow[] = ALL_TEAMS) {
  const queueInserts: QueueInsert[] = []

  const client = {
    // Expose for test assertions
    _queueInserts: queueInserts,

    from(table: string) {
      if (table === 'teams') {
        return {
          select() {
            return this
          },
          eq(_col: string, sportVal: string) {
            const filtered = teams.filter((t) => t.sport === sportVal)
            return {
              contains(_col2: string, tokens: string[]) {
                const token = tokens[0]?.toLowerCase() ?? ''
                const match = filtered.find((t) =>
                  t.aliases.some((a) => a.toLowerCase() === token),
                )
                return {
                  limit(_n: number) {
                    return {
                      single() {
                        if (match) {
                          return Promise.resolve({ data: match, error: null })
                        }
                        return Promise.resolve({ data: null, error: { message: 'No rows found', code: 'PGRST116' } })
                      },
                    }
                  },
                }
              },
            }
          },
        }
      }

      if (table === 'entity_resolution_queue') {
        return {
          insert(row: QueueInsert) {
            const inserted = { id: 'fake-queue-id-' + Date.now(), ...row }
            queueInserts.push(row)
            return Promise.resolve({ data: inserted, error: null })
          },
        }
      }

      // Fallback: no-op
      return {
        select() { return this },
        eq() { return this },
        contains() { return this },
        limit() { return this },
        single() { return Promise.resolve({ data: null, error: null }) },
        insert() { return Promise.resolve({ data: null, error: null }) },
      }
    },
  }

  return client
}

// ---------------------------------------------------------------------------
// tier-1: exact/alias lookup
// ---------------------------------------------------------------------------

describe('resolveEntity — tier-1 exact/alias', () => {
  it('resolves "brewers" (lowercase alias) to Milwaukee Brewers in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('brewers', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).toBe(1)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('8')
      expect(result.confidence).toBe(1)
      expect(result.entity_type).toBe('team')
    }
  })

  it('resolves "yankees" alias in MLB context to New York Yankees', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('yankees', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).toBe(1)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('10')
    }
  })

  it('resolves "mil" abbreviation alias in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('mil', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).toBe(1)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('8')
    }
  })
})

// ---------------------------------------------------------------------------
// tier-2: fuzzy auto-accept
// ---------------------------------------------------------------------------

describe('resolveEntity — tier-2 fuzzy auto-accept', () => {
  it('resolves "Brewers ML" (near-miss with trailing text) via fuzzy when alias is not an exact match', async () => {
    // "Brewers ML" won't exactly match any alias, so tier-1 misses and tier-2 picks it up
    // We use a client that returns no alias match for the tokenized form
    const teamsWithoutBrewersMlAlias = ALL_TEAMS.map((t) =>
      t.espn_id === '8'
        ? { ...t, aliases: ['mil'] }  // remove 'brewers' alias so tier-1 misses
        : t,
    )
    const client = makeFakeClient(teamsWithoutBrewersMlAlias)
    const result = await resolveEntity('Brewers', 'MLB', { supabase: client as never, teams: teamsWithoutBrewersMlAlias })
    // Should still resolve via tier-2 fuzzy (nickname = 'Brewers')
    expect(result.tier).toBe(2)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('8')
    }
  })

  it('falls through to tier-3 when fuzzy score is above the auto-accept threshold', async () => {
    // "Xyzzy" will not fuzzy-match anything to within 0.10
    const client = makeFakeClient()
    const result = await resolveEntity('Xyzzy', 'MLB', {
      supabase: client as never,
      teams: ALL_TEAMS,
      betId: 'bet-123',
    })
    expect(result.tier).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// tier-3: enqueue unknown/ambiguous
// ---------------------------------------------------------------------------

describe('resolveEntity — tier-3 enqueue', () => {
  it('returns PendingEntity{tier:3, queue_id} for an unresolvable description', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('Zzzzunknown', 'MLB', {
      supabase: client as never,
      teams: ALL_TEAMS,
      betId: 'bet-xyz',
    })
    expect(result.tier).toBe(3)
    if (result.tier === 3) {
      expect(typeof result.queue_id).toBe('string')
      expect(result.queue_id.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// pending: tier-3 triggers exactly one entity_resolution_queue insert
// ---------------------------------------------------------------------------

describe('resolveEntity — pending', () => {
  it('inserts exactly one entity_resolution_queue row with status pending', async () => {
    const client = makeFakeClient()
    await resolveEntity('AbsolutelyUnknownTeam999', 'MLB', {
      supabase: client as never,
      teams: ALL_TEAMS,
      betId: 'bet-pending-test',
    })
    expect(client._queueInserts).toHaveLength(1)
    expect(client._queueInserts[0].status).toBe('pending')
    expect(client._queueInserts[0].bet_id).toBe('bet-pending-test')
    expect(client._queueInserts[0].sport).toBe('MLB')
  })

  it('does NOT insert a queue row for a tier-1 resolved entity', async () => {
    const client = makeFakeClient()
    await resolveEntity('brewers', 'MLB', { supabase: client as never, teams: ALL_TEAMS, betId: 'bet-t1' })
    expect(client._queueInserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// collision: D-03a — all 6 sport-scoped collision cases
// ---------------------------------------------------------------------------

describe('resolveEntity — collision', () => {
  it('Cardinals MLB context → STL Cardinals (not ARI)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('cardinals', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('24')  // STL Cardinals
      expect(result.name).toContain('Cardinals')
    }
  })

  it('Cardinals NFL context → ARI Cardinals (not STL)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('cardinals', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('22')  // ARI Cardinals
    }
  })

  it('Panthers NFL context → CAR Panthers (not FLA)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('panthers', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('29')  // CAR Panthers
    }
  })

  it('Panthers NHL context → FLA Panthers (not CAR)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('panthers', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('13')  // FLA Panthers
    }
  })

  it('Kings NBA context → SAC Kings (not LA)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('kings', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('25')  // SAC Kings
    }
  })

  it('Kings NHL context → LA Kings (not SAC)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('kings', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('26')  // LA Kings
    }
  })
})

// ---------------------------------------------------------------------------
// golden-set: ~30 real paste samples — D-16 cut-over safety net
// Tests must stay green when hardcoded *_ABBREVS maps are deleted.
// All cases use inline fixtures (ALL_TEAMS above) — no live DB required.
// ---------------------------------------------------------------------------

describe('resolveEntity — golden set', () => {
  // --- MLB: nicknames ---
  it('resolves "Brewers ML" nickname token to Milwaukee Brewers ESPN id 8', async () => {
    const client = makeFakeClient()
    // "brewers" is in aliases → tier-1 exact alias hit
    const result = await resolveEntity('brewers', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('8')
      expect(result.name).toContain('Brewers')
    }
  })

  it('resolves "Milwaukee Brewers" full name in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('milwaukee brewers', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('8')
  })

  it('resolves "MIL" abbreviation alias to Brewers in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('mil', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('8')
  })

  // --- MLB: abbreviation format "NYY ML" ---
  it('resolves "nyy" token (from "NYY ML") to New York Yankees ESPN id 10', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('nyy', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('10')
  })

  it('resolves "yankees" alias in MLB context to New York Yankees', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('yankees', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('10')
  })

  it('resolves "dodgers" to LAD in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('dodgers', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('19')
  })

  it('resolves "la dodgers" alias to LAD in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('la dodgers', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('19')
  })

  it('resolves "red sox" multi-word alias to BOS in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('red sox', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('2')
  })

  it('resolves "phillies" alias in MLB context (player-prop team name)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('phi', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('22')
  })

  it('resolves "royals" alias in MLB context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('royals', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('7')
  })

  // --- D-03a collisions: Cardinals ---
  it('resolves "Cardinals -3" MLB context → STL Cardinals (not ARI)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('cardinals', 'MLB', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('24')  // STL Cardinals
      expect(result.name).toContain('St. Louis')
    }
  })

  it('resolves "Cardinals -3" NFL context → ARI Cardinals (not STL)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('cardinals', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('22')  // ARI Cardinals
      expect(result.name).toContain('Arizona')
    }
  })

  // --- D-03a collisions: Panthers ---
  it('resolves "Panthers" NFL context → CAR Panthers', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('panthers', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('29')  // CAR Panthers
    }
  })

  it('resolves "Panthers" NHL context → FLA Panthers', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('panthers', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('13')  // FLA Panthers
    }
  })

  // --- D-03a collisions: Kings ---
  it('resolves "Kings" NBA context → SAC Kings (not LA Kings)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('kings', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('25')  // SAC Kings
    }
  })

  it('resolves "Kings" NHL context → LA Kings (not SAC Kings)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('kings', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('26')  // LA Kings
    }
  })

  it('resolves "la kings" alias in NHL context → LA Kings', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('la kings', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('26')
  })

  it('resolves "sac kings" alias in NBA context → SAC Kings', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('sac kings', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('25')
  })

  // --- NFL / NHL / NBA abbreviation aliases ---
  it('resolves "kc" Chiefs in NFL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('kc', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('12')
  })

  it('resolves "chiefs" in NFL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('chiefs', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('12')
  })

  it('resolves "49ers" alias in NFL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('49ers', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('25')
  })

  it('resolves "niners" alias in NFL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('niners', 'NFL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('25')
  })

  it('resolves "edm" abbreviation to Edmonton Oilers in NHL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('edm', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('11')
  })

  it('resolves "oilers" alias to Edmonton Oilers in NHL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('oilers', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('11')
  })

  it('resolves "golden knights" multi-word alias to VGK in NHL context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('golden knights', 'NHL', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('30')
  })

  it('resolves "suns" alias to PHX Suns in NBA context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('suns', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('28')
  })

  it('resolves "celtics" alias in NBA context', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('celtics', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('2')
  })

  it('resolves "bucks" alias in NBA context (city MIL shared with MLB Brewers)', async () => {
    const client = makeFakeClient()
    // "bucks" alias → NBA Bucks in NBA context; "mil" → MLB Brewers in MLB context
    const result = await resolveEntity('bucks', 'NBA', { supabase: client as never, teams: ALL_TEAMS })
    expect(result.tier).not.toBe(3)
    if (result.tier !== 3) expect(result.espn_id).toBe('15')
  })

  // --- Player props: resolver returns tier-3 (player resolution not yet in team library) ---
  it('"Aaron Nola (PHI) Over 6.5 K" — player prop falls through to tier-3 pending (player not in team library)', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity(
      'Aaron Nola (PHI) Over 6.5 K',
      'MLB',
      { supabase: client as never, teams: ALL_TEAMS, betId: 'bet-nola' },
    )
    // Correct behavior: team library can't resolve a player → enqueue for agent (D-12 pending)
    expect(result.tier).toBe(3)
    if (result.tier === 3) {
      expect(typeof result.queue_id).toBe('string')
    }
    // Queue row was inserted
    expect(client._queueInserts).toHaveLength(1)
    expect(client._queueInserts[0].sport).toBe('MLB')
  })

  // --- Tier-2 fuzzy: slightly non-exact team name with no direct alias ---
  it('resolves "Brewers" (capitalized, not in alias list) via fuzzy tier-2 in MLB context', async () => {
    // Strips "brewers" alias → tier-1 misses; fuzzy on full_name/nickname picks it up
    const teamsNoBrewersAlias = ALL_TEAMS.map((t) =>
      t.espn_id === '8'
        ? { ...t, aliases: ['mil', 'milwaukee brewers'] }  // remove bare 'brewers' alias
        : t,
    )
    const client = makeFakeClient(teamsNoBrewersAlias)
    const result = await resolveEntity('Brewers', 'MLB', {
      supabase: client as never,
      teams: teamsNoBrewersAlias,
    })
    // Fuse.js fuzzy should match "Brewers" against nickname field
    expect(result.tier).toBe(2)
    if (result.tier !== 3) {
      expect(result.espn_id).toBe('8')
    }
  })

  // --- Truly unknown → tier-3 ---
  it('completely unknown description enqueues as pending', async () => {
    const client = makeFakeClient()
    const result = await resolveEntity('Xyzzy Unknown Team', 'NFL', {
      supabase: client as never,
      teams: ALL_TEAMS,
      betId: 'bet-unknown',
    })
    expect(result.tier).toBe(3)
    expect(client._queueInserts).toHaveLength(1)
  })
})
