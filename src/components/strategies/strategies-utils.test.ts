/**
 * Pure-function tests for strategies UI utilities (05-03 W3 descoped from component tests).
 *
 * Rationale: tracker Vitest has no DOM config (no happy-dom / RTL / vitest.config.ts).
 * Component render tests require setup; pure-function extractions are testable as-is.
 * See 05-PLAN-CHECK.md M4.
 */

import { describe, it, expect } from 'vitest'
import { extractLastPhaseHeading } from './PhaseHeadingsPill'
import { scoreColorClass, scoreTierLabel } from './AuditScoreChip'
import { sortFindings } from './AuditPanel'
import { fmtAmericanOdds, buildPicksRows } from './PicksCard'
import type { AuditFinding } from '@/types/strategies'

// ---------------------------------------------------------------------------
// PhaseHeadingsPill - extractLastPhaseHeading
// ---------------------------------------------------------------------------

describe('extractLastPhaseHeading', () => {
  it('returns null for empty string', () => {
    expect(extractLastPhaseHeading('')).toBeNull()
  })

  it('returns null when no Phase headings present', () => {
    expect(extractLastPhaseHeading('## Some section\n\nSome text')).toBeNull()
  })

  it('extracts a single Phase heading', () => {
    const md = '### Phase 1 — Devig every market provided\n\nSome content'
    const result = extractLastPhaseHeading(md)
    expect(result).not.toBeNull()
    expect(result!.phase).toBe('1')
    expect(result!.name).toBe('Devig every market provided')
  })

  it('returns the LAST heading when multiple are present', () => {
    const md = [
      '### Phase 1 — Devig every market provided',
      '',
      '### Phase 2 — Apply Tier 1',
      '',
      '### Phase 3 — Situational',
    ].join('\n')
    const result = extractLastPhaseHeading(md)
    expect(result!.phase).toBe('3')
    expect(result!.name).toBe('Situational')
  })

  it('handles lettered phases (e.g. 5b)', () => {
    const md = '### Phase 5b — Suspicious-edge audit\n\nContent'
    const result = extractLastPhaseHeading(md)
    expect(result!.phase).toBe('5b')
    expect(result!.name).toBe('Suspicious-edge audit')
  })

  it('trims trailing whitespace from heading name', () => {
    const md = '### Phase 7 — Correlation matrix construction   \n'
    const result = extractLastPhaseHeading(md)
    expect(result!.name).toBe('Correlation matrix construction')
  })
})

// ---------------------------------------------------------------------------
// AuditScoreChip - scoreColorClass + scoreTierLabel
// ---------------------------------------------------------------------------

describe('scoreColorClass', () => {
  it('returns green class for score >= 90', () => {
    expect(scoreColorClass(90)).toContain('emerald')
    expect(scoreColorClass(100)).toContain('emerald')
  })

  it('returns amber class for score 70-89', () => {
    expect(scoreColorClass(70)).toContain('amber')
    expect(scoreColorClass(89)).toContain('amber')
  })

  it('returns red class for score < 70', () => {
    expect(scoreColorClass(69)).toContain('red')
    expect(scoreColorClass(0)).toContain('red')
  })

  it('returns zinc class for null score', () => {
    expect(scoreColorClass(null)).toContain('zinc')
  })
})

describe('scoreTierLabel', () => {
  it('returns HIGH for score >= 90', () => {
    expect(scoreTierLabel(92)).toBe('HIGH')
  })

  it('returns MED for score 70-89', () => {
    expect(scoreTierLabel(78)).toBe('MED')
  })

  it('returns LOW for score < 70', () => {
    expect(scoreTierLabel(50)).toBe('LOW')
  })

  it('returns N/A for null score', () => {
    expect(scoreTierLabel(null)).toBe('N/A')
  })
})

// ---------------------------------------------------------------------------
// AuditPanel - sortFindings
// ---------------------------------------------------------------------------

function makeFinding(
  severity: 'high' | 'medium' | 'low',
  pass: boolean,
): AuditFinding {
  return { rule: `${severity}-rule`, severity, pass, evidence: 'test' }
}

describe('sortFindings', () => {
  it('puts failed-high items first', () => {
    const findings = [
      makeFinding('low', false),
      makeFinding('high', false),
      makeFinding('medium', false),
    ]
    const sorted = sortFindings(findings)
    expect(sorted[0].severity).toBe('high')
  })

  it('puts passed items after all failed items', () => {
    const findings = [
      makeFinding('high', true),
      makeFinding('high', false),
    ]
    const sorted = sortFindings(findings)
    expect(sorted[0].pass).toBe(false)
    expect(sorted[1].pass).toBe(true)
  })

  it('sorts failed: high > medium > low', () => {
    const findings = [
      makeFinding('low', false),
      makeFinding('high', false),
      makeFinding('medium', false),
    ]
    const sorted = sortFindings(findings)
    expect(sorted[0].severity).toBe('high')
    expect(sorted[1].severity).toBe('medium')
    expect(sorted[2].severity).toBe('low')
  })

  it('does not mutate the original array', () => {
    const findings = [makeFinding('high', true), makeFinding('low', false)]
    const original = [...findings]
    sortFindings(findings)
    expect(findings).toEqual(original)
  })
})

// ---------------------------------------------------------------------------
// PicksCard - fmtAmericanOdds + buildPicksRows
// ---------------------------------------------------------------------------

describe('fmtAmericanOdds', () => {
  it('prefixes positive odds with +', () => {
    expect(fmtAmericanOdds(115)).toBe('+115')
  })

  it('returns negative odds as-is', () => {
    expect(fmtAmericanOdds(-104)).toBe('-104')
  })

  it('prefixes zero with +', () => {
    expect(fmtAmericanOdds(0)).toBe('+0')
  })
})

describe('buildPicksRows', () => {
  const picks = [
    { n: 1, game: 'LAD@SD', market: 'SD +1.5', line: -126, stake_u: 4, stack: 'T1', edge_pct: 6.2, pick_key: 'LAD@SD-RL-SD' },
  ]

  it('returns one row per pick', () => {
    expect(buildPicksRows(picks, [])).toHaveLength(1)
  })

  it('confidence is null when no matching seminar', () => {
    const rows = buildPicksRows(picks, [])
    expect(rows[0].confidence).toBeNull()
  })

  it('matches seminar by market substring', () => {
    const seminars = [
      { play: 'SD +1.5 pick analysis', confidence: 'HIGH' as const, p_pre: 0.55, p_audited: 0.53, delta: -0.02, key_findings: 'ok' },
    ]
    const rows = buildPicksRows(picks, seminars)
    expect(rows[0].confidence).toBe('HIGH')
  })

  it('matches seminar by game substring', () => {
    const seminars = [
      { play: 'LAD@SD game', confidence: 'MEDIUM' as const, p_pre: 0.55, p_audited: 0.53, delta: -0.02, key_findings: 'ok' },
    ]
    const rows = buildPicksRows(picks, seminars)
    expect(rows[0].confidence).toBe('MEDIUM')
  })
})
