import { describe, it, expect } from 'vitest'
import { parseEspnTeams } from './espn-teams.js'

const SAMPLE = {
  sports: [{ leagues: [{ teams: [
    { team: { id: '29', location: 'Arizona', name: 'Diamondbacks',
      abbreviation: 'ARI', displayName: 'Arizona Diamondbacks',
      shortDisplayName: 'Diamondbacks', slug: 'arizona-diamondbacks' } },
    { team: { id: '15', location: 'Chicago', name: 'Sky',
      abbreviation: 'CHI', displayName: 'Chicago Sky',
      shortDisplayName: 'Sky', slug: 'chicago-sky' } },
  ] }] }],
}

describe('parseEspnTeams', () => {
  it('maps ESPN team objects to TeamRow with sport/league stamped', () => {
    const rows = parseEspnTeams(SAMPLE, 'WNBA', 'wnba')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      sport: 'WNBA', league: 'wnba', full_name: 'Arizona Diamondbacks',
      location: 'Arizona', nickname: 'Diamondbacks', abbreviation: 'ARI',
      espn_id: '29',
    })
    expect(rows[0].aliases).toContain('arizona-diamondbacks')
    expect(rows[1].abbreviation).toBe('CHI') // the Sky/Sun 3-letter case
  })

  it('returns [] for a malformed payload', () => {
    expect(parseEspnTeams({}, 'MLB', 'mlb')).toEqual([])
  })
})
