import { describe, it, expect } from 'vitest'
import { detectSport } from './sport-detector'

describe('detectSport — WNBA', () => {
  // Teams detected via team regex (Pass 2) or WNBA keyword (Pass 1)
  // Note: 'Las Vegas Aces' uses WNBA keyword — bare 'Aces' is a Tennis keyword,
  // so keyword-only descriptions for Aces must include 'WNBA' to be unambiguous.
  it('detects Las Vegas Aces as WNBA via WNBA keyword', () => {
    // bare 'Aces' is also a Tennis keyword — realistic WNBA bet has 'WNBA' prefix
    expect(detectSport('WNBA Las Vegas Aces ML')).toBe('WNBA')
  })
  it('detects Liberty as WNBA', () => {
    expect(detectSport('NY Liberty +4.5')).toBe('WNBA')
  })
  it('detects Fever as WNBA', () => {
    expect(detectSport('Indiana Fever ML')).toBe('WNBA')
  })
  it('detects Storm as WNBA', () => {
    expect(detectSport('Seattle Storm -2.5')).toBe('WNBA')
  })
  it('detects Lynx as WNBA', () => {
    expect(detectSport('Minnesota Lynx o152.5')).toBe('WNBA')
  })
  it('detects Mercury as WNBA', () => {
    expect(detectSport('Phoenix Mercury ML')).toBe('WNBA')
  })
  it('detects Sun as WNBA via WNBA keyword (3-char name)', () => {
    // 'Sun' is 3 chars — omitted from WNBA_TEAMS; must use WNBA keyword fixture
    expect(detectSport('WNBA Connecticut Sun -3.5')).toBe('WNBA')
  })
  it('detects Dream as WNBA', () => {
    expect(detectSport('Atlanta Dream +6')).toBe('WNBA')
  })
  it('detects Mystics as WNBA', () => {
    expect(detectSport('Washington Mystics ML')).toBe('WNBA')
  })
  it('detects Sparks as WNBA', () => {
    expect(detectSport('Los Angeles Sparks -1.5')).toBe('WNBA')
  })
  it('detects Valkyries as WNBA', () => {
    expect(detectSport('Golden State Valkyries ML')).toBe('WNBA')
  })
  it('detects Sky as WNBA via WNBA keyword (3-char name)', () => {
    // 'Sky' is 3 chars — omitted from WNBA_TEAMS; must use WNBA keyword fixture
    expect(detectSport('WNBA Chicago Sky ML')).toBe('WNBA')
  })
  it('detects Dallas Wings as WNBA', () => {
    expect(detectSport('Dallas Wings +4.5')).toBe('WNBA')
  })
  it('detects WNBA keyword alone', () => {
    expect(detectSport('WNBA tip-off special')).toBe('WNBA')
  })
  it('does not mis-tag NHL Red Wings as WNBA', () => {
    // 'Dallas Wings' is in WNBA_TEAMS, not bare 'Wings'; Red Wings must stay NHL
    expect(detectSport('NY Rangers - DET Red Wings o5.5')).toBe('NHL')
  })
})

describe('detectSport — prop-shape short-circuit', () => {
  it('classifies (ANA) Points as NHL even though "Points" is an NBA keyword', () => {
    expect(detectSport('Jackson LaCombe (ANA) Over 0.5 Points')).toBe('NHL')
  })

  it('classifies (CAR) Points as NHL via stat-hint disambiguation', () => {
    // CAR is in both NHL (Hurricanes) and NFL (Panthers); NFL doesn't have
    // "Points" props, so NHL wins.
    expect(detectSport('Logan Stankoven (CAR) Over 0.5 Points')).toBe('NHL')
  })

  it('classifies (NY) Points as NBA — NY only matches Knicks abbrev', () => {
    expect(detectSport('Jordan Clarkson (NY) 6+ Points')).toBe('NBA')
  })

  it('classifies (MIN) Shots on goal as NHL via SOG keyword', () => {
    // MIN matches NBA (Timberwolves), NHL (Wild), MLB (Twins), NFL (Vikings)
    expect(detectSport('Matt Boldy (MIN) Over 3.5 Shots on goal')).toBe('NHL')
  })

  it('classifies (PHX) Rebounds as NBA', () => {
    expect(detectSport('Devin Booker (PHX) Over 4.5 Rebounds')).toBe('NBA')
  })

  it('classifies (KC) Passing Yards as NFL', () => {
    expect(detectSport('Patrick Mahomes (KC) Over 275.5 Passing Yards')).toBe('NFL')
  })

  it('falls back to keyword for non-prop descriptions', () => {
    expect(detectSport('PHX Suns -13')).toBe('NBA')
    expect(detectSport('NY Rangers - TB Lightning o1.5 (1P)')).toBe('NHL')
  })
})
