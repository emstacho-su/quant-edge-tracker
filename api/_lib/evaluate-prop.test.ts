import { describe, it, expect } from 'vitest'
import { parsePropDescription, extractStat, evaluateProp } from './evaluate-prop.js'

describe('parsePropDescription', () => {
  it('parses a PRA prop', () => {
    expect(parsePropDescription('Jalen Williams (OKC) Over 27.5 Pts + Reb + Ast')).toEqual({
      player: 'Jalen Williams', team: 'OKC', statKey: 'pra', line: 27.5, direction: 'over',
    })
  })
  it('parses a points prop', () => {
    expect(parsePropDescription('Jalen Williams (OKC) Over 18.5 Points')).toMatchObject({ statKey: 'points', line: 18.5 })
  })
  it('parses a threes prop', () => {
    expect(parsePropDescription('Luguentz Dort (OKC) Over 1.5 three point field goals made')).toMatchObject({ statKey: 'threes', line: 1.5 })
  })
  it('guards: unrecognized stat → null', () => {
    expect(parsePropDescription('Player Name (OKC) Over 2.5 double doubles')).toBeNull()
  })
  it('guards: non-prop format → null', () => {
    expect(parsePropDescription('KC Royals ML')).toBeNull()
  })
  it('parses pts + reb combined', () => {
    expect(parsePropDescription('Nikola Jokic (DEN) Over 38.5 pts + reb')).toMatchObject({ statKey: 'pts_reb', line: 38.5 })
  })
  it('parses pts + ast combined', () => {
    expect(parsePropDescription('Luka Doncic (DAL) Over 34.5 pts + ast')).toMatchObject({ statKey: 'pts_ast', line: 34.5 })
  })
  it('parses reb + ast combined', () => {
    expect(parsePropDescription('Nikola Jokic (DEN) Over 20.5 reb + ast')).toMatchObject({ statKey: 'reb_ast', line: 20.5 })
  })
  it('parses NHL goals prop', () => {
    expect(parsePropDescription('Connor McDavid (EDM) Over 0.5 goals')).toMatchObject({ statKey: 'goals' })
  })
  it('parses NHL shots on goal prop', () => {
    expect(parsePropDescription('Auston Matthews (TOR) Over 3.5 shots on goal')).toMatchObject({ statKey: 'shots' })
  })
  it('parses NFL passing yards prop', () => {
    expect(parsePropDescription('Patrick Mahomes (KC) Over 279.5 passing yards')).toMatchObject({ statKey: 'pass_yards' })
  })
  it('parses NFL receptions prop', () => {
    expect(parsePropDescription('Travis Kelce (KC) Over 5.5 receptions')).toMatchObject({ statKey: 'receptions' })
  })
  it('parses MLB rbi prop', () => {
    expect(parsePropDescription('Aaron Judge (NYY) Over 0.5 rbi')).toMatchObject({ statKey: 'rbi' })
  })
  it('parses MLB pitcher strikeouts via alias', () => {
    expect(parsePropDescription('Gerrit Cole (NYY) Over 6.5 pitcher strikeouts')).toMatchObject({ statKey: 'strikeouts_pitcher' })
  })
})

// NBA fixture — existing
const NBA = [{
  statistics: [{
    labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'],
    athletes: [{ athlete: { displayName: 'Julian Champagnie' }, stats: ['36', '8', '2-8', '1-7', '3-4', '5', '2', '0', '1', '0', '0', '5', '3', '+11'] }],
  }],
}]

// MLB fixture — existing (ESPN label-array shape)
const MLB = [{
  statistics: [
    { labels: ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG'], athletes: [{ athlete: { displayName: 'Matt McLain' }, stats: ['1-5', '5', '0', '2', '0', '0', '0', '1', '20', '.208'] }] },
    { labels: ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC'], athletes: [{ athlete: { displayName: 'Andrew Abbott' }, stats: ['5.1', '3', '2', '1', '3', '7', '1', '96-64', '3.97', '96'] }] },
  ],
}]

// NHL fixture — skater stats (G, A, +/-, PIM, SOG)
const NHL = [{
  statistics: [{
    labels: ['G', 'A', '+/-', 'PIM', 'SOG'],
    athletes: [
      { athlete: { displayName: 'Connor McDavid' }, stats: ['1', '2', '+2', '0', '4'] },
      { athlete: { displayName: 'Auston Matthews' }, stats: ['0', '1', '-1', '2', '5'] },
    ],
  }],
}]

// NFL fixtures — separate groups for passing / rushing / receiving
const NFL = [{
  statistics: [
    {
      labels: ['CMP', 'ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACK', 'QBR', 'RTG'],
      athletes: [{ athlete: { displayName: 'Patrick Mahomes' }, stats: ['28', '42', '312', '7.4', '3', '1', '2', '74.3', '98.4'] }],
    },
    {
      labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'],
      athletes: [{ athlete: { displayName: 'Isiah Pacheco' }, stats: ['15', '72', '4.8', '1', '18'] }],
    },
    {
      labels: ['REC', 'TGT', 'YDS', 'AVG', 'TD', 'LONG'],
      athletes: [{ athlete: { displayName: 'Travis Kelce' }, stats: ['7', '9', '89', '12.7', '1', '24'] }],
    },
  ],
}]

describe('extractStat', () => {
  it('NBA points / rebounds / assists', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'points')).toBe(8)
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'rebounds')).toBe(5)
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'assists')).toBe(2)
  })
  it('NBA PRA sums; threes takes the made part of "1-7"', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'pra')).toBe(15)
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'threes')).toBe(1)
  })
  it('NBA pts_reb combine sums correctly (8+5=13)', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'pts_reb')).toBe(13)
  })
  it('NBA pts_ast combine sums correctly (8+2=10)', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'pts_ast')).toBe(10)
  })
  it('NBA reb_ast combine sums correctly (5+2=7)', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'reb_ast')).toBe(7)
  })
  it('NBA turnovers reads TO label', () => {
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'turnovers')).toBe(0)
  })
  it('MLB pulls K from the pitching group, H from the batting group', () => {
    expect(extractStat(MLB, 'MLB', 'Andrew Abbott', 'strikeouts')).toBe(7)
    expect(extractStat(MLB, 'MLB', 'Matt McLain', 'hits')).toBe(2)
  })
  it('MLB ESPN fallback: strikeouts_pitcher, hits_allowed, rbi, hr, runs', () => {
    expect(extractStat(MLB, 'MLB', 'Andrew Abbott', 'strikeouts_pitcher')).toBe(7)
    expect(extractStat(MLB, 'MLB', 'Andrew Abbott', 'hits_allowed')).toBe(3)
    expect(extractStat(MLB, 'MLB', 'Matt McLain', 'rbi')).toBe(0)
    expect(extractStat(MLB, 'MLB', 'Matt McLain', 'hr')).toBe(0)
    expect(extractStat(MLB, 'MLB', 'Matt McLain', 'runs')).toBe(0)
  })
  it('NHL goals extracts G label', () => {
    expect(extractStat(NHL, 'NHL', 'Connor McDavid', 'goals')).toBe(1)
  })
  it('NHL assists extracts A label', () => {
    expect(extractStat(NHL, 'NHL', 'Connor McDavid', 'assists')).toBe(2)
  })
  it('NHL points combines G+A', () => {
    expect(extractStat(NHL, 'NHL', 'Connor McDavid', 'points')).toBe(3)
  })
  it('NHL goals_assists combines G+A', () => {
    expect(extractStat(NHL, 'NHL', 'Auston Matthews', 'goals_assists')).toBe(1)
  })
  it('NHL shots reads SOG label', () => {
    expect(extractStat(NHL, 'NHL', 'Auston Matthews', 'shots')).toBe(5)
  })
  it('NFL pass_yards reads YDS from passing group (not rushing/receiving)', () => {
    expect(extractStat(NFL, 'NFL', 'Patrick Mahomes', 'pass_yards')).toBe(312)
  })
  it('NFL pass_tds reads TD from passing group', () => {
    expect(extractStat(NFL, 'NFL', 'Patrick Mahomes', 'pass_tds')).toBe(3)
  })
  it('NFL completions reads CMP from passing group', () => {
    expect(extractStat(NFL, 'NFL', 'Patrick Mahomes', 'completions')).toBe(28)
  })
  it('NFL rush_yards reads YDS from rushing group (not passing)', () => {
    expect(extractStat(NFL, 'NFL', 'Isiah Pacheco', 'rush_yards')).toBe(72)
  })
  it('NFL rush_tds reads TD from rushing group', () => {
    expect(extractStat(NFL, 'NFL', 'Isiah Pacheco', 'rush_tds')).toBe(1)
  })
  it('NFL rec_yards reads YDS from receiving group', () => {
    expect(extractStat(NFL, 'NFL', 'Travis Kelce', 'rec_yards')).toBe(89)
  })
  it('NFL receptions reads REC from receiving group', () => {
    expect(extractStat(NFL, 'NFL', 'Travis Kelce', 'receptions')).toBe(7)
  })
  it('NFL rec_tds reads TD from receiving group', () => {
    expect(extractStat(NFL, 'NFL', 'Travis Kelce', 'rec_tds')).toBe(1)
  })
  it('DNP: player absent from box score → null (not 0)', () => {
    expect(extractStat(NBA, 'NBA', 'Not On Roster', 'points')).toBeNull()
  })
  it('guards: unknown player or unknown stat → null', () => {
    expect(extractStat(NBA, 'NBA', 'Nobody Here', 'points')).toBeNull()
    expect(extractStat(NBA, 'NBA', 'Julian Champagnie', 'home_runs')).toBeNull()
  })
  it('guards: WNBA uses NBA taxonomy', () => {
    expect(extractStat(NBA, 'WNBA', 'Julian Champagnie', 'points')).toBe(8)
  })
})

describe('evaluateProp', () => {
  it('grades over/under/push', () => {
    expect(evaluateProp(20, 18.5, 'over')).toBe('won')
    expect(evaluateProp(17, 18.5, 'over')).toBe('lost')
    expect(evaluateProp(17, 18.5, 'under')).toBe('won')
    expect(evaluateProp(18, 18, 'over')).toBe('push')
  })
})

describe('parsePropDescription team capture', () => {
  it('captures player, team, stat, line, direction', () => {
    expect(parsePropDescription('Jalen Brunson (NYK) Over 24.5 Points')).toMatchObject(
      { player: 'Jalen Brunson', team: 'NYK', statKey: 'points', line: 24.5, direction: 'over' })
  })
  it('combo stat (PRA) still parses', () => {
    expect(parsePropDescription('Nikola Jokic (DEN) Over 27.5 Pts + Reb + Ast')).toMatchObject(
      { team: 'DEN', statKey: 'pra', direction: 'over' })
  })
  it('unrecognized stat → null', () => {
    expect(parsePropDescription('Some Guy (LAL) Over 1.5 Fouls')).toBeNull()
  })
})

describe('parsePropDescription — loosened shapes', () => {
  it('accepts o/u shorthand with team', () => {
    expect(parsePropDescription('Jason Alexander (KC) o3.5 Strikeouts')).toEqual({
      player: 'Jason Alexander', team: 'KC', statKey: 'strikeouts', line: 3.5, direction: 'over',
    })
    expect(parsePropDescription('Jason Alexander (KC) u3.5 Strikeouts')).toMatchObject({
      direction: 'under', line: 3.5,
    })
  })

  it('parses without (TEAM) when player has 2+ words (team=null for resolver)', () => {
    expect(parsePropDescription('Jason Alexander o3.5 Strikeouts')).toEqual({
      player: 'Jason Alexander', team: null, statKey: 'strikeouts', line: 3.5, direction: 'over',
    })
    expect(parsePropDescription("De'Aaron Fox 4+ Rebounds")).toEqual({
      player: "De'Aaron Fox", team: null, statKey: 'rebounds', line: 3.5, direction: 'over',
    })
  })

  it('treats "N+" as over N-0.5 (so OU line lookup works)', () => {
    expect(parsePropDescription('Jalen Brunson (NYK) 25+ Points')).toMatchObject({
      direction: 'over', line: 24.5, statKey: 'points',
    })
  })

  it('greedy stat-prefix trims trailing bet-type tokens', () => {
    expect(parsePropDescription("De'Aaron Fox 4+ Rebounds Single")).toMatchObject({
      player: "De'Aaron Fox", team: null, statKey: 'rebounds', line: 3.5, direction: 'over',
    })
    expect(parsePropDescription('Jason Alexander (KC) Over 3.5 Strikeouts Parlay')).toMatchObject({
      statKey: 'strikeouts', line: 3.5,
    })
  })

  it('rejects single-word player (team-line guard)', () => {
    expect(parsePropDescription('Yankees Over 5.5 Runs')).toBeNull()
    expect(parsePropDescription('Lakers 4+ Points')).toBeNull()
  })
})
