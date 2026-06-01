import { describe, it, expect } from 'vitest'
import { buildFuseIndex, fuzzyResolve, FUZZY_AUTO_ACCEPT_THRESHOLD } from './entity-fuzzy'
import type { TeamRow } from '../../api/_lib/espn-teams.js'

// ---------------------------------------------------------------------------
// Inline fixtures — no Supabase mock needed; entity-fuzzy is a pure utility
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

const MLB_TEAMS: TeamRow[] = [
  makeTeam({
    sport: 'MLB',
    league: 'mlb',
    full_name: 'St. Louis Cardinals',
    location: 'St. Louis',
    nickname: 'Cardinals',
    abbreviation: 'STL',
    espn_id: '24',
  }),
  makeTeam({
    sport: 'MLB',
    league: 'mlb',
    full_name: 'Milwaukee Brewers',
    location: 'Milwaukee',
    nickname: 'Brewers',
    abbreviation: 'MIL',
    espn_id: '8',
  }),
  makeTeam({
    sport: 'MLB',
    league: 'mlb',
    full_name: 'New York Yankees',
    location: 'New York',
    nickname: 'Yankees',
    abbreviation: 'NYY',
    espn_id: '10',
  }),
]

const NFL_TEAMS: TeamRow[] = [
  makeTeam({
    sport: 'NFL',
    league: 'nfl',
    full_name: 'Arizona Cardinals',
    location: 'Arizona',
    nickname: 'Cardinals',
    abbreviation: 'ARI',
    espn_id: '22',
  }),
  makeTeam({
    sport: 'NFL',
    league: 'nfl',
    full_name: 'Kansas City Chiefs',
    location: 'Kansas City',
    nickname: 'Chiefs',
    abbreviation: 'KC',
    espn_id: '12',
  }),
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FUZZY_AUTO_ACCEPT_THRESHOLD', () => {
  it('is 0.10 (Fuse.js: lower = better; 0 = perfect match)', () => {
    expect(FUZZY_AUTO_ACCEPT_THRESHOLD).toBe(0.10)
  })
})

describe('buildFuseIndex', () => {
  it('returns a Fuse instance for the given teams array', () => {
    const fuse = buildFuseIndex(MLB_TEAMS)
    expect(fuse).toBeDefined()
    // Fuse instance has a search method
    expect(typeof fuse.search).toBe('function')
  })
})

describe('fuzzyResolve', () => {
  it('auto-accepts "Brewers" against an MLB index with a low (good) score', () => {
    const fuse = buildFuseIndex(MLB_TEAMS)
    const result = fuzzyResolve('Brewers', fuse)
    expect(result).not.toBeNull()
    expect(result!.entity.full_name).toBe('Milwaukee Brewers')
    // score must be <= threshold to qualify for auto-accept
    expect(result!.score).toBeLessThanOrEqual(FUZZY_AUTO_ACCEPT_THRESHOLD)
  })

  it('returns a result above threshold for a poor match (does NOT auto-accept)', () => {
    const fuse = buildFuseIndex(MLB_TEAMS)
    // "Xyzzy" should produce no result or a score > threshold
    const result = fuzzyResolve('Xyzzy', fuse)
    if (result !== null) {
      expect(result.score).toBeGreaterThan(FUZZY_AUTO_ACCEPT_THRESHOLD)
    }
  })

  it('returns null when the query matches nothing within the search ceiling', () => {
    const fuse = buildFuseIndex(MLB_TEAMS)
    const result = fuzzyResolve('ZZZZZ', fuse)
    expect(result).toBeNull()
  })

  it('sport-scoped MLB index resolves "Cardinals" to St. Louis Cardinals (NOT Arizona)', () => {
    // Build an index from MLB-only teams — Arizona Cardinals are NFL, not in this index
    const fuse = buildFuseIndex(MLB_TEAMS)
    const result = fuzzyResolve('Cardinals', fuse)
    expect(result).not.toBeNull()
    expect(result!.entity.full_name).toBe('St. Louis Cardinals')
    expect(result!.entity.sport).toBe('MLB')
  })

  it('sport-scoped NFL index resolves "Cardinals" to Arizona Cardinals (NOT St. Louis)', () => {
    // Build an index from NFL-only teams — St. Louis Cardinals are MLB, not in this index
    const fuse = buildFuseIndex(NFL_TEAMS)
    const result = fuzzyResolve('Cardinals', fuse)
    expect(result).not.toBeNull()
    expect(result!.entity.full_name).toBe('Arizona Cardinals')
    expect(result!.entity.sport).toBe('NFL')
  })

  it('returns the raw score so the caller can decide to auto-accept or fall through', () => {
    const fuse = buildFuseIndex(MLB_TEAMS)
    const result = fuzzyResolve('Yankees', fuse)
    expect(result).not.toBeNull()
    expect(typeof result!.score).toBe('number')
    expect(result!.score).toBeGreaterThanOrEqual(0)
    expect(result!.score).toBeLessThanOrEqual(1)
  })
})
