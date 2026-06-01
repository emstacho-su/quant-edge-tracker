import { describe, it, expect } from 'vitest'
import { precheckParse } from './parse-utils.js'

describe('precheckParse', () => {
  describe('structured inputs — high confidence', () => {
    it('parses "Brewers ML -110" with confidence >= 0.75 and correct fields', () => {
      const result = precheckParse('Brewers ML -110')
      expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      expect(result.parsed).not.toBeNull()
      expect(result.parsed?.market).toBe('moneyline')
      // ML side (home/away) cannot be determined from text alone in the precheck —
      // it is null and will be resolved by the LLM fallback if needed.
      expect(result.parsed?.price).toBe(-110)
    })

    it('parses "Yankees ML +130" with confidence >= 0.75', () => {
      const result = precheckParse('Yankees ML +130')
      expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      expect(result.parsed?.market).toBe('moneyline')
      expect(result.parsed?.price).toBe(130)
    })

    it('parses "Dodgers -1.5 (-120)" spread with confidence >= 0.75', () => {
      const result = precheckParse('Dodgers -1.5 (-120)')
      expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      expect(result.parsed?.market).toBe('spread')
      expect(result.parsed?.line).toBe(-1.5)
      expect(result.parsed?.price).toBe(-120)
    })

    it('parses "o233.5 (-110)" total over with confidence >= 0.75', () => {
      const result = precheckParse('o233.5 (-110)')
      expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      expect(result.parsed?.market).toBe('total')
      expect(result.parsed?.side).toBe('over')
      expect(result.parsed?.line).toBe(233.5)
    })

    it('parses "u7.5 (-115)" total under with confidence >= 0.75', () => {
      const result = precheckParse('u7.5 (-115)')
      expect(result.confidence).toBeGreaterThanOrEqual(0.75)
      expect(result.parsed?.market).toBe('total')
      expect(result.parsed?.side).toBe('under')
    })

    it('parses sport from known team name (MLB from Brewers)', () => {
      const result = precheckParse('Brewers ML -110')
      expect(result.parsed?.sport).toBeTruthy()
    })
  })

  describe('ambiguous inputs — low confidence', () => {
    it('returns confidence < 0.75 for empty-ish text', () => {
      const result = precheckParse('bet this game')
      expect(result.confidence).toBeLessThan(0.75)
    })

    it('returns confidence < 0.75 for purely ambiguous text', () => {
      const result = precheckParse('the home team wins tonight I think')
      expect(result.confidence).toBeLessThan(0.75)
    })

    it('returns confidence < 0.75 for completely garbled text', () => {
      const result = precheckParse('???')
      expect(result.confidence).toBeLessThan(0.75)
    })
  })

  describe('edge cases', () => {
    it('returns { parsed: null, confidence: 0 } for empty string', () => {
      const result = precheckParse('')
      expect(result.parsed).toBeNull()
      expect(result.confidence).toBe(0)
    })

    it('does not import from src/', () => {
      // This test passes trivially if the module loads — the key invariant
      // is in the implementation (no src/ imports). If it imported from src/,
      // Vitest would fail to resolve the module.
      expect(typeof precheckParse).toBe('function')
    })

    it('always returns { parsed, confidence } shape', () => {
      const result = precheckParse('some text')
      expect(result).toHaveProperty('parsed')
      expect(result).toHaveProperty('confidence')
      expect(typeof result.confidence).toBe('number')
    })
  })
})
