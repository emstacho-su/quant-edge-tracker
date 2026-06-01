/**
 * Failing test scaffold for the offshore slate parser (D-04, D-06).
 *
 * Wave 0 purpose: establish red tests so 21-02 turns them green.
 *
 * - One describe block per offshore book (D-11 fixed set).
 * - Books whose fixture still contains __TBD__USER_TO_PASTE__ are .skip-ped
 *   so the suite shows skipped (yellow) not misleadingly green.
 * - A 'return-shape contract' describe block is always-failing until 21-02
 *   ships the production parser.
 *
 * DO NOT implement parseOffshoreSlate here — that belongs in 21-02.
 */

import { describe, it, expect } from 'vitest'
import {
  FIXTURE_BOOKS,
  hasRealSample,
  sevenStacksSample,
  betvegas23Sample,
  bovadaSample,
  betusSample,
} from '../components/line-shop/__fixtures__/offshore-slate-samples'

// Lazy dynamic import so vitest collects the file even when the module is absent.
// Tests that need the function will call loadParser() and fail with a clear error.
// The module does not exist until 21-02 ships — that is the intended RED state.
// Use a runtime-only path so TypeScript does not try to statically resolve the module.
const PARSER_MODULE_PATH = '../utils/offshore-slate-parser'

async function loadParser(): Promise<{ parseOffshoreSlate: (book: string, text: string) => { parsed: unknown[]; unparsed: { line: string; reason: string }[] } }> {
  // This import will throw until 21-02 ships; that is the intended RED state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return import(/* @vite-ignore */ PARSER_MODULE_PATH) as any
}

// ─── Return-shape contract (always-failing until 21-02) ────────────────────────

describe('return-shape contract', () => {
  it('parseOffshoreSlate returns { parsed: ParsedSlatePrice[]; unparsed: { line: string; reason: string }[] }', async () => {
    const parser = await loadParser()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (parser as any).parseOffshoreSlate('bovada', '')
    expect(result).toHaveProperty('parsed')
    expect(result).toHaveProperty('unparsed')
    expect(Array.isArray(result.parsed)).toBe(true)
    expect(Array.isArray(result.unparsed)).toBe(true)
  })

  it('returns empty arrays for blank input (D-04)', async () => {
    const parser = await loadParser()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (parser as any).parseOffshoreSlate('bovada', '')
    expect(result.parsed).toHaveLength(0)
    expect(result.unparsed).toHaveLength(0)
  })
})

// ─── Per-book parser tests (skipped while fixture is __TBD__) ─────────────────

const sampleMap: Record<(typeof FIXTURE_BOOKS)[number], string> = {
  '7stacks': sevenStacksSample,
  betvegas23: betvegas23Sample,
  bovada: bovadaSample,
  betus: betusSample,
}

for (const book of FIXTURE_BOOKS) {
  const sample = sampleMap[book]
  const isReal = hasRealSample(book)

  describe(`parseOffshoreSlate — ${book}`, () => {
    const maybeIt = isReal ? it : it.skip

    maybeIt(`parses at least one row from the ${book} fixture (D-04)`, async () => {
      const parser = await loadParser()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (parser as any).parseOffshoreSlate(book, sample)
      expect(result.parsed.length).toBeGreaterThan(0)
    })

    maybeIt(`returns empty unparsed for clean ${book} fixture (D-06)`, async () => {
      const parser = await loadParser()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (parser as any).parseOffshoreSlate(book, sample)
      // A clean fixture should produce 0 unparsed rows
      expect(result.unparsed).toHaveLength(0)
    })

    maybeIt(`each parsed row has priceAmerican as a number for ${book} (D-04)`, async () => {
      const parser = await loadParser()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (parser as any).parseOffshoreSlate(book, sample)
      for (const row of result.parsed) {
        expect(typeof row.priceAmerican).toBe('number')
      }
    })
  })
}
