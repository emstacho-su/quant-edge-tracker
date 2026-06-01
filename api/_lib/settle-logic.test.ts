import { describe, it, expect, vi } from 'vitest'
import { decideSingle, decideParlay } from './settle-logic.js'
import type { FinalGameRow } from './espn-scores.js'

const g = (o: Partial<FinalGameRow>): FinalGameRow => ({
  espnId: '1', homeAbbrev: 'KC', homeName: 'Royals', awayAbbrev: 'BOS', awayName: 'Red Sox',
  homeScore: 5, awayScore: 3, statusDetail: 'Final', finalType: 'regulation', ...o,
})

const KC = g({ espnId: 'mlb1' })
const NHL = g({ espnId: 'nhl1', homeAbbrev: 'COL', homeName: 'Avalanche', awayAbbrev: 'VGK', awayName: 'Golden Knights', homeScore: 4, awayScore: 2 })
const NBA_GAME = g({ espnId: 'nba99', homeAbbrev: 'GSW', homeName: 'Warriors', awayAbbrev: 'LAL', awayName: 'Lakers', homeScore: 110, awayScore: 105 })

describe('decideSingle', () => {
  it('settles a matched ML bet', () => {
    const d = decideSingle({ clv_market: 'moneyline', clv_selection: 'KC Royals', clv_line: null, live_game_id: null }, [KC])
    expect(d).toMatchObject({ kind: 'settle', outcome: 'won' })
  })
  it('skips when no final game matches', () => {
    const d = decideSingle({ clv_market: 'moneyline', clv_selection: 'LA Lakers', clv_line: null, live_game_id: null }, [KC])
    expect(d).toMatchObject({ kind: 'skip', reason: 'no_unique_final_match' })
  })
})

describe('decideParlay', () => {
  const finals = { MLB: [KC], NHL: [NHL] }
  it('settles won when all straight legs win', () => {
    const d = decideParlay(
      [
        { description: 'KC Royals ML', sport: 'MLB' },
        { description: 'COL Avalanche -1.5', sport: 'NHL' },
      ],
      finals,
    )
    expect(d).toMatchObject({ kind: 'settle', outcome: 'won' })
  })
  it('settles lost when any leg loses', () => {
    const d = decideParlay(
      [
        { description: 'KC Royals ML', sport: 'MLB' },
        { description: 'VGK Golden Knights ML', sport: 'NHL' }, // VGK lost 2-4
      ],
      finals,
    )
    expect(d).toMatchObject({ kind: 'settle', outcome: 'lost' })
  })
  it('pending when a leg game is not yet final', () => {
    const d = decideParlay(
      [
        { description: 'KC Royals ML', sport: 'MLB' },
        { description: 'COL Avalanche -1.5', sport: 'NHL' },
      ],
      { MLB: [KC], NHL: [] }, // NHL game not final
    )
    expect(d).toMatchObject({ kind: 'pending' })
  })
  it('skips an unparseable leg', () => {
    const d = decideParlay([{ description: 'mystery wager', sport: 'MLB' }], finals)
    expect(d).toMatchObject({ kind: 'skip', reason: 'leg_unparseable' })
  })

  // --- D-07: prop leg routing (replacing the old leg_is_prop skip) ---

  it('needs-agent when prop leg has no live_game_id', () => {
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: null }],
      { NBA: [] },
    )
    expect(d).toMatchObject({ kind: 'needs-agent', reason: 'prop_leg_no_game_link' })
  })

  it('needs-agent when prop leg has live_game_id but no grading_spec', () => {
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99', grading_spec: null }],
      { NBA: [NBA_GAME] },
    )
    expect(d).toMatchObject({ kind: 'needs-agent', reason: 'prop_leg_no_game_link' })
  })

  it('pending when prop leg has live_game_id + grading_spec but game not yet final', () => {
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
        grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } }],
      { NBA: [] }, // game not final yet
    )
    expect(d).toMatchObject({ kind: 'pending' })
  })

  it('pending when straight leg wins and prop leg game is not yet final (mixed parlay)', () => {
    const d = decideParlay(
      [
        { description: 'KC Royals ML', sport: 'MLB' },
        { description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
          grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } },
      ],
      { MLB: [KC], NBA: [] }, // NBA not final
    )
    expect(d).toMatchObject({ kind: 'pending' })
  })

  it('prop leg uses leg.sport (not parent sport) for finals lookup — Pitfall 4', () => {
    // NBA prop leg — only MLB finals are in the map for non-NBA. NBA is empty → pending.
    const d = decideParlay(
      [
        { description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
          grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } },
      ],
      { MLB: [KC], NBA: [] }, // uses leg.sport='NBA' → empty → pending
    )
    expect(d).toMatchObject({ kind: 'pending' })
  })

  it('calls propLegGrader callback when game is final and spec is present', () => {
    const mockGrader = vi.fn().mockReturnValue('won' as const)
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
        grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } }],
      { NBA: [NBA_GAME] },
      mockGrader,
    )
    expect(mockGrader).toHaveBeenCalledWith(
      expect.objectContaining({ live_game_id: 'nba99', is_prop: true }),
      NBA_GAME,
    )
    expect(d).toMatchObject({ kind: 'settle', outcome: 'won' })
  })

  it('needs-agent when propLegGrader returns null (unresolvable)', () => {
    const mockGrader = vi.fn().mockReturnValue(null)
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
        grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } }],
      { NBA: [NBA_GAME] },
      mockGrader,
    )
    expect(d).toMatchObject({ kind: 'needs-agent', reason: 'prop_leg_unresolved' })
  })

  it('propLegGrader returns pending → whole parlay pending', () => {
    const mockGrader = vi.fn().mockReturnValue('pending' as const)
    const d = decideParlay(
      [{ description: 'Player Over 1.5', sport: 'NBA', is_prop: true, live_game_id: 'nba99',
        grading_spec: { prop: { espn_player_id: 'p1', stat_keys: ['points'], line: 1.5, direction: 'over' as const, data_source: 'espn_boxscore' } } }],
      { NBA: [NBA_GAME] },
      mockGrader,
    )
    expect(d).toMatchObject({ kind: 'pending' })
  })
})
