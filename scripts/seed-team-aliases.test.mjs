// Pure-function test for buildSeedAliases() — no DB calls.
// Run: npm run test -- seed-team-aliases.test.mjs --reporter=dot
import { describe, it, expect } from 'vitest'
import { buildSeedAliases } from './seed-team-aliases.mjs'

const aliases = buildSeedAliases()

// Helper: find records matching alias (case-insensitive) + sport + abbrev
function find(alias, sport, abbreviation) {
  const lower = alias.toLowerCase()
  return aliases.filter(
    (r) => r.alias === lower && r.sport === sport && r.abbreviation === abbreviation,
  )
}

// Helper: find ALL records for an alias across all sports
function findAll(alias) {
  const lower = alias.toLowerCase()
  return aliases.filter((r) => r.alias === lower)
}

describe('buildSeedAliases — source field', () => {
  it('every record has source: seed', () => {
    const bad = aliases.filter((r) => r.source !== 'seed')
    expect(bad).toHaveLength(0)
  })

  it('returns a non-empty array', () => {
    expect(aliases.length).toBeGreaterThan(0)
  })
})

describe('buildSeedAliases — Cardinals collision (D-03a)', () => {
  it('cardinals is present for MLB → STL', () => {
    expect(find('cardinals', 'MLB', 'STL')).toHaveLength(1)
  })

  it('cardinals is present for NFL → ARI', () => {
    expect(find('cardinals', 'NFL', 'ARI')).toHaveLength(1)
  })

  it('exactly two cardinals entries (one per sport)', () => {
    expect(findAll('cardinals')).toHaveLength(2)
  })
})

describe('buildSeedAliases — Panthers collision (D-03a)', () => {
  it('panthers is present for NFL → CAR', () => {
    expect(find('panthers', 'NFL', 'CAR')).toHaveLength(1)
  })

  it('panthers is present for NHL → FLA', () => {
    expect(find('panthers', 'NHL', 'FLA')).toHaveLength(1)
  })

  it('Carolina Panthers full name present for NFL → CAR', () => {
    expect(find('carolina panthers', 'NFL', 'CAR')).toHaveLength(1)
  })

  it('CAR Panthers variant present for NFL → CAR', () => {
    expect(find('car panthers', 'NFL', 'CAR')).toHaveLength(1)
  })

  it('Florida Panthers full name present for NHL → FLA', () => {
    expect(find('florida panthers', 'NHL', 'FLA')).toHaveLength(1)
  })

  it('FLA Panthers variant present for NHL → FLA', () => {
    expect(find('fla panthers', 'NHL', 'FLA')).toHaveLength(1)
  })
})

describe('buildSeedAliases — Kings collision (D-03a)', () => {
  it('kings is present for NBA → SAC', () => {
    expect(find('kings', 'NBA', 'SAC')).toHaveLength(1)
  })

  it('kings is present for NHL → LA', () => {
    expect(find('kings', 'NHL', 'LA')).toHaveLength(1)
  })

  it('Sacramento Kings full name present for NBA → SAC', () => {
    expect(find('sacramento kings', 'NBA', 'SAC')).toHaveLength(1)
  })

  it('SAC Kings variant present for NBA → SAC', () => {
    expect(find('sac kings', 'NBA', 'SAC')).toHaveLength(1)
  })

  it('LA Kings full name present for NHL → LA', () => {
    expect(find('la kings', 'NHL', 'LA')).toHaveLength(1)
  })

  it('Los Angeles Kings full name present for NHL → LA', () => {
    expect(find('los angeles kings', 'NHL', 'LA')).toHaveLength(1)
  })

  it('L.A. Kings variant present for NHL → LA', () => {
    expect(find('l.a. kings', 'NHL', 'LA')).toHaveLength(1)
  })
})

describe('buildSeedAliases — WNBA collision-safe variants (D-03a)', () => {
  it('Dallas Wings full name present for WNBA → DAL', () => {
    expect(find('dallas wings', 'WNBA', 'DAL')).toHaveLength(1)
  })

  it('bare wings maps to WNBA → DAL (not NHL Red Wings)', () => {
    // "wings" entry in WNBA_ABBREVS maps to DAL; NHL has no bare "wings" key
    // (it has "red wings" only) — bare 'wings' should resolve to WNBA:DAL only
    const wingRecords = findAll('wings')
    expect(wingRecords.length).toBeGreaterThanOrEqual(1)
    const wnbaDal = wingRecords.filter((r) => r.sport === 'WNBA' && r.abbreviation === 'DAL')
    expect(wnbaDal).toHaveLength(1)
    // NHL should NOT have bare 'wings' (it has 'red wings')
    const nhlWings = wingRecords.filter((r) => r.sport === 'NHL')
    expect(nhlWings).toHaveLength(0)
  })

  it('Las Vegas Aces full name present for WNBA → LV', () => {
    expect(find('las vegas aces', 'WNBA', 'LV')).toHaveLength(1)
  })

  it('bare aces maps to WNBA → LV', () => {
    const aceRecords = findAll('aces')
    expect(aceRecords.length).toBeGreaterThanOrEqual(1)
    const wnbaLv = aceRecords.filter((r) => r.sport === 'WNBA' && r.abbreviation === 'LV')
    expect(wnbaLv).toHaveLength(1)
  })
})

describe('buildSeedAliases — record shape', () => {
  it('every record has sport, abbreviation, alias, source fields', () => {
    for (const r of aliases) {
      expect(r).toHaveProperty('sport')
      expect(r).toHaveProperty('abbreviation')
      expect(r).toHaveProperty('alias')
      expect(r).toHaveProperty('source')
    }
  })

  it('every alias is lowercase', () => {
    const notLower = aliases.filter((r) => r.alias !== r.alias.toLowerCase())
    expect(notLower).toHaveLength(0)
  })
})
