/**
 * roster-fetch.test.ts
 * Unit tests for per-sport roster + active-field fetchers.
 * All tests mock global.fetch — no live HTTP calls.
 * Run individual sport groups: -t "mlb" / -t "nhl" / -t "nba"
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchMlbActiveRoster,
  fetchNhlRoster,
  fetchNbaRoster,
  fetchEspnRoster,
  fetchActiveField,
  SPORT_PATHS,
} from './roster-fetch.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
}

function makeFetchFail(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(`HTTP ${status}`),
  })
}

// ---------------------------------------------------------------------------
// MLB — statsapi.mlb.com
// ---------------------------------------------------------------------------
describe('fetchMlbActiveRoster — mlb', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const MLB_SAMPLE = {
    roster: [
      { person: { id: 605400, fullName: 'Aaron Nola' }, jerseyNumber: '27', position: { abbreviation: 'P' } },
      { person: { id: 671096, fullName: 'Bryce Harper' }, jerseyNumber: '3', position: { abbreviation: '1B' } },
    ],
  }

  it('maps ESPN abbrev → MLB team id and fetches roster', async () => {
    vi.stubGlobal('fetch', makeFetchOk(MLB_SAMPLE))
    const players = await fetchMlbActiveRoster('PHI')
    expect(players).toHaveLength(2)
    expect(players[0].full_name).toBe('Aaron Nola')
    expect(players[1].full_name).toBe('Bryce Harper')
  })

  it('stores source_id as the MLB person.id string (NOT ESPN id) — Pitfall 7', async () => {
    vi.stubGlobal('fetch', makeFetchOk(MLB_SAMPLE))
    const players = await fetchMlbActiveRoster('PHI')
    // MLB person id, not ESPN athlete id
    expect(players[0].source_id).toBe('605400')
    expect(players[1].source_id).toBe('671096')
    expect(typeof players[0].source_id).toBe('string')
  })

  it('includes jersey and position fields', async () => {
    vi.stubGlobal('fetch', makeFetchOk(MLB_SAMPLE))
    const players = await fetchMlbActiveRoster('PHI')
    expect(players[0].jersey).toBe('27')
    expect(players[0].position).toBe('P')
  })

  it('calls the MLB StatsAPI endpoint (not ESPN) for the correct MLB team id', async () => {
    const mockFetch = makeFetchOk(MLB_SAMPLE)
    vi.stubGlobal('fetch', mockFetch)
    await fetchMlbActiveRoster('PHI')
    const url = mockFetch.mock.calls[0][0] as string
    // PHI → MLB id 143
    expect(url).toContain('statsapi.mlb.com')
    expect(url).toContain('143')
    expect(url).toContain('rosterType=active')
  })

  it('throws on unknown abbreviation', async () => {
    vi.stubGlobal('fetch', makeFetchOk(MLB_SAMPLE))
    await expect(fetchMlbActiveRoster('BOGUS')).rejects.toThrow(/Unknown MLB abbreviation/)
  })

  it('throws on non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', makeFetchFail(404))
    await expect(fetchMlbActiveRoster('PHI')).rejects.toThrow(/404/)
  })
})

// ---------------------------------------------------------------------------
// NHL — api-web.nhle.com
// ---------------------------------------------------------------------------
describe('fetchNhlRoster — nhl', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const NHL_SAMPLE = {
    forwards: [
      { id: 8478042, firstName: { default: 'Viktor' }, lastName: { default: 'Arvidsson' }, sweaterNumber: 33, positionCode: 'L' },
      { id: 8481559, firstName: { default: 'Anze' }, lastName: { default: 'Kopitar' }, sweaterNumber: 11, positionCode: 'C' },
    ],
    defensemen: [
      { id: 8480027, firstName: { default: 'Drew' }, lastName: { default: 'Doughty' }, sweaterNumber: 8, positionCode: 'D' },
    ],
    goalies: [
      { id: 8476883, firstName: { default: 'Cam' }, lastName: { default: 'Talbot' }, sweaterNumber: 39, positionCode: 'G' },
    ],
  }

  it('flattens forwards + defensemen + goalies into a single array', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NHL_SAMPLE))
    const players = await fetchNhlRoster('LAK')
    expect(players).toHaveLength(4)
  })

  it('builds full_name from firstName.default + lastName.default — Pitfall 3 (not [object Object])', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NHL_SAMPLE))
    const players = await fetchNhlRoster('LAK')
    expect(players[0].full_name).toBe('Viktor Arvidsson')
    expect(players[1].full_name).toBe('Anze Kopitar')
    expect(players[2].full_name).toBe('Drew Doughty')
    expect(players[3].full_name).toBe('Cam Talbot')
    // Ensure none contain "[object Object]"
    for (const p of players) {
      expect(p.full_name).not.toContain('[object')
    }
  })

  it('stores source_id as the NHL player id string', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NHL_SAMPLE))
    const players = await fetchNhlRoster('LAK')
    expect(players[0].source_id).toBe('8478042')
  })

  it('calls api-web.nhle.com endpoint with the team abbreviation', async () => {
    const mockFetch = makeFetchOk(NHL_SAMPLE)
    vi.stubGlobal('fetch', mockFetch)
    await fetchNhlRoster('BOS')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('api-web.nhle.com')
    expect(url).toContain('BOS')
  })

  it('handles missing position groups gracefully (e.g. empty goalies)', async () => {
    const partialSample = { forwards: NHL_SAMPLE.forwards, defensemen: [], goalies: [] }
    vi.stubGlobal('fetch', makeFetchOk(partialSample))
    const players = await fetchNhlRoster('BOS')
    expect(players).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// NBA — stats.nba.com (required headers)
// ---------------------------------------------------------------------------
describe('fetchNbaRoster — nba', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const NBA_SAMPLE = {
    resultSets: [{
      name: 'CommonTeamRoster',
      headers: ['TeamID', 'SEASON', 'LeagueID', 'PLAYER', 'NICKNAME', 'PLAYER_SLUG', 'NUM', 'POSITION', 'PLAYER_ID'],
      rowSet: [
        [1610612738, '2024-25', '00', 'Jayson Tatum', 'J. Tatum', 'jayson-tatum', '0', 'SF-PF', 1629029],
        [1610612738, '2024-25', '00', 'Jaylen Brown', 'J. Brown', 'jaylen-brown', '7', 'SG-SF', 1627759],
      ],
    }],
  }

  it('parses column-indexed rowSet using headers', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NBA_SAMPLE))
    const players = await fetchNbaRoster('BOS')
    expect(players).toHaveLength(2)
    expect(players[0].full_name).toBe('Jayson Tatum')
    expect(players[0].jersey).toBe('0')
    expect(players[0].position).toBe('SF-PF')
  })

  it('stores source_id as the NBA PLAYER_ID string', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NBA_SAMPLE))
    const players = await fetchNbaRoster('BOS')
    expect(players[0].source_id).toBe('1629029')
    expect(players[1].source_id).toBe('1627759')
  })

  it('sends the 4 required NBA headers — Pitfall 2', async () => {
    const mockFetch = makeFetchOk(NBA_SAMPLE)
    vi.stubGlobal('fetch', mockFetch)
    await fetchNbaRoster('BOS')
    const requestInit = mockFetch.mock.calls[0][1] as RequestInit
    const headers = requestInit.headers as Record<string, string>
    expect(headers['x-nba-stats-origin']).toBe('stats')
    expect(headers['x-nba-stats-token']).toBe('true')
    expect(headers['Referer']).toBe('https://www.nba.com/')
    expect(headers['User-Agent']).toBeDefined()
  })

  it('calls stats.nba.com endpoint with the NBA team id', async () => {
    const mockFetch = makeFetchOk(NBA_SAMPLE)
    vi.stubGlobal('fetch', mockFetch)
    await fetchNbaRoster('BOS')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('stats.nba.com')
    // BOS → 1610612738
    expect(url).toContain('1610612738')
    expect(url).toContain('Season=2024-25')
  })

  it('throws on unknown NBA abbreviation', async () => {
    vi.stubGlobal('fetch', makeFetchOk(NBA_SAMPLE))
    await expect(fetchNbaRoster('BOGUS')).rejects.toThrow(/Unknown NBA abbreviation/)
  })

  it('throws on 403 so caller can fall back to ESPN', async () => {
    vi.stubGlobal('fetch', makeFetchFail(403))
    await expect(fetchNbaRoster('BOS')).rejects.toThrow(/403/)
  })
})

// ---------------------------------------------------------------------------
// ESPN roster — flat and grouped shapes
// ---------------------------------------------------------------------------
describe('fetchEspnRoster', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const FLAT_SAMPLE = {
    athletes: [
      { id: '11001', displayName: 'Player One', fullName: 'Player One', jersey: '10', position: { abbreviation: 'C' } },
      { id: '11002', displayName: 'Player Two', fullName: 'Player Two', jersey: '20', position: { abbreviation: 'LW' } },
    ],
  }

  const GROUPED_SAMPLE = {
    athletes: [
      { position: 'Offense', items: [
        { id: '22001', displayName: 'Offense One', fullName: 'Offense One', jersey: '88', position: { abbreviation: 'WR' } },
        { id: '22002', displayName: 'Offense Two', fullName: 'Offense Two', jersey: '12', position: { abbreviation: 'QB' } },
      ]},
      { position: 'Defense', items: [
        { id: '22003', displayName: 'Defense One', fullName: 'Defense One', jersey: '55', position: { abbreviation: 'LB' } },
      ]},
    ],
  }

  it('handles flat athletes[] shape (MLB, NBA)', async () => {
    vi.stubGlobal('fetch', makeFetchOk(FLAT_SAMPLE))
    const players = await fetchEspnRoster('NHL', '14')
    expect(players).toHaveLength(2)
    expect(players[0].id).toBe('11001')
    expect(players[1].id).toBe('11002')
  })

  it('handles grouped [{items:[...]}] shape (NFL, NHL) — flattens all groups', async () => {
    vi.stubGlobal('fetch', makeFetchOk(GROUPED_SAMPLE))
    const players = await fetchEspnRoster('NFL', '12')
    expect(players).toHaveLength(3)
    expect(players[0].id).toBe('22001')
    expect(players[2].id).toBe('22003')
  })

  it('includes ESPN athlete id, fullName, jersey, position', async () => {
    vi.stubGlobal('fetch', makeFetchOk(FLAT_SAMPLE))
    const players = await fetchEspnRoster('NHL', '14')
    expect(players[0].fullName).toBe('Player One')
    expect(players[0].jersey).toBe('10')
  })

  it('throws on unknown sport', async () => {
    vi.stubGlobal('fetch', makeFetchOk(FLAT_SAMPLE))
    await expect(fetchEspnRoster('SOCCER', '999')).rejects.toThrow(/No ESPN path/)
  })
})

// ---------------------------------------------------------------------------
// SPORT_PATHS — NCAAF must be present (D-06 logic present)
// ---------------------------------------------------------------------------
describe('SPORT_PATHS', () => {
  it('includes football/college-football for NCAAF (D-06)', () => {
    expect(SPORT_PATHS['NCAAF']).toBe('football/college-football')
  })

  it('includes all major prop sports', () => {
    expect(SPORT_PATHS['MLB']).toBeDefined()
    expect(SPORT_PATHS['NBA']).toBeDefined()
    expect(SPORT_PATHS['NHL']).toBeDefined()
    expect(SPORT_PATHS['NFL']).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// fetchActiveField — Tennis/Golf/MMA scoreboard
// ---------------------------------------------------------------------------
describe('fetchActiveField', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const TENNIS_SCOREBOARD = {
    events: [
      {
        groupings: [
          {
            competitions: [
              {
                competitors: [
                  { id: '3149', type: 'athlete', athlete: { fullName: 'Guo Hanyu', displayName: 'Guo Hanyu', shortName: 'H. Guo' } },
                  { id: '4012', type: 'athlete', athlete: { fullName: 'Carlos Alcaraz', displayName: 'Carlos Alcaraz', shortName: 'C. Alcaraz' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  }

  const GOLF_SCOREBOARD = {
    events: [
      {
        groupings: [
          {
            competitions: [
              {
                competitors: [
                  { id: '5001', type: 'athlete', athlete: { fullName: 'Scottie Scheffler', displayName: 'Scottie Scheffler', shortName: 'S. Scheffler' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  }

  it('extracts competitors from Tennis scoreboard with team_espn_id null (D-08)', async () => {
    vi.stubGlobal('fetch', makeFetchOk(TENNIS_SCOREBOARD))
    const players = await fetchActiveField('atp')
    expect(players.length).toBeGreaterThan(0)
    for (const p of players) {
      expect(p.team_espn_id).toBeNull()
    }
  })

  it('returns espn_id from competitor.id', async () => {
    vi.stubGlobal('fetch', makeFetchOk(TENNIS_SCOREBOARD))
    const players = await fetchActiveField('atp')
    expect(players[0].espn_id).toBe('3149')
    expect(players[1].espn_id).toBe('4012')
  })

  it('returns full_name from athlete.fullName', async () => {
    vi.stubGlobal('fetch', makeFetchOk(TENNIS_SCOREBOARD))
    const players = await fetchActiveField('atp')
    expect(players[0].full_name).toBe('Guo Hanyu')
    expect(players[1].full_name).toBe('Carlos Alcaraz')
  })

  it('returns short_name from athlete.shortName', async () => {
    vi.stubGlobal('fetch', makeFetchOk(TENNIS_SCOREBOARD))
    const players = await fetchActiveField('atp')
    expect(players[0].short_name).toBe('H. Guo')
  })

  it('returns source as "espn"', async () => {
    vi.stubGlobal('fetch', makeFetchOk(TENNIS_SCOREBOARD))
    const players = await fetchActiveField('atp')
    for (const p of players) {
      expect(p.source).toBe('espn')
    }
  })

  it('works with Golf PGA scoreboard', async () => {
    vi.stubGlobal('fetch', makeFetchOk(GOLF_SCOREBOARD))
    const players = await fetchActiveField('pga')
    expect(players).toHaveLength(1)
    expect(players[0].espn_id).toBe('5001')
    expect(players[0].full_name).toBe('Scottie Scheffler')
    expect(players[0].team_espn_id).toBeNull()
  })

  it('deduplicates competitors that appear in multiple competitions', async () => {
    const dupeScoreboard = {
      events: [
        {
          groupings: [
            {
              competitions: [
                { competitors: [{ id: '3149', type: 'athlete', athlete: { fullName: 'Player A', displayName: 'Player A', shortName: 'P. A' } }] },
                { competitors: [{ id: '3149', type: 'athlete', athlete: { fullName: 'Player A', displayName: 'Player A', shortName: 'P. A' } }] },
              ],
            },
          ],
        },
      ],
    }
    vi.stubGlobal('fetch', makeFetchOk(dupeScoreboard))
    const players = await fetchActiveField('atp')
    expect(players.filter(p => p.espn_id === '3149')).toHaveLength(1)
  })
})
