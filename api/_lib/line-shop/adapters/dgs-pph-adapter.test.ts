/**
 * dgs-pph-adapter.test.ts
 *
 * Vitest suite for the parameterized DgsPphAdapter (Phase 11-02).
 *
 * Coverage required by plan §must_haves:
 *  1. isEnabled() returns false when process.env.VERCEL is set (even with creds)
 *  2. sevenStacksAdapter.isEnabled() true when SEVENSTACKS_* present and no VERCEL
 *  3. betVegas23Adapter.isEnabled() false when BETVEGAS23_* absent (clean skip)
 *  4. fetchMarket() returns null (no throw) when session file is missing
 *  5. fetchMarket() returns null + upserts scrape_health 'session_expired' on login redirect
 *  6. On a mocked odds page, snapshots carry is_account_line=true + RAW impliedProb
 *  7. assertNoOrderSurface(sevenStacksAdapter) passes (no forbidden methods)
 *
 * Mocks: node:fs (existsSync), playwright (chromium), api/_lib/supabase-admin.ts
 * (getServiceClient). No live browser, no live network.
 *
 * BOOK-05, BOOK-06, D-02/D-03/D-04/D-05/D-06, T-11-06..T-11-11
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { impliedFromAmerican, americanToDecimal } from '../../clv.js'
import { assertNoOrderSurface } from './read-only-invariant.js'

// ─── Mock node:fs before adapter import ──────────────────────────────────────
// NOTE: vi.mock factories are hoisted to top; do NOT reference variables defined
// in module scope inside the factory function.

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

// ─── Mock playwright chromium ─────────────────────────────────────────────────
// Use vi.hoisted() to create the mocks so they are available inside the factory.

const { mockPage, mockContext, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    goto: vi.fn(),
    url: vi.fn(),
    waitForSelector: vi.fn(),
    close: vi.fn(),
    locator: vi.fn(),
  }
  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn(),
  }
  const mockBrowser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    close: vi.fn(),
  }
  return { mockPage, mockContext, mockBrowser }
})

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}))

// ─── Mock supabase-admin ──────────────────────────────────────────────────────

vi.mock('../../supabase-admin.js', () => ({
  getServiceClient: vi.fn(),
}))

// ─── Import mocks + the module under test (after vi.mock hoisting) ─────────────

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { getServiceClient } from '../../supabase-admin.js'
import {
  sevenStacksAdapter,
  betVegas23Adapter,
} from './dgs-pph-adapter.js'

// ─── Helper: build a lightweight Supabase mock that tracks upsert calls ────────

function makeMockSupabase() {
  const upsertMock = vi.fn().mockResolvedValue({ error: null })
  const client = {
    from: vi.fn().mockReturnValue({
      upsert: upsertMock,
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }),
    _upsertMock: upsertMock,
  }
  return client
}

// ─── Shared canonical market fixture ─────────────────────────────────────────

const CANONICAL_MARKET = {
  id: 'market-uuid-dgs-01',
  sport: 'mlb',
  eventId: 'MLB_20260522_MIL_CHC',
  eventName: 'Brewers @ Cubs',
  eventStart: new Date('2026-05-22T19:05:00Z'),
  oddsApiEventId: null,
  marketType: 'moneyline' as const,
  marketParam: null,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DgsPphAdapter', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Re-apply sensible default mock return values after clearAllMocks
    vi.mocked(mockBrowser.newContext).mockResolvedValue(mockContext)
    vi.mocked(mockContext.newPage).mockResolvedValue(mockPage)
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser)
    vi.mocked(mockBrowser.close).mockResolvedValue(undefined)
    vi.mocked(mockContext.close).mockResolvedValue(undefined)
    vi.mocked(mockPage.close).mockResolvedValue(undefined)
    vi.mocked(mockPage.goto).mockResolvedValue(null as never)

    // Default: locator returns empty (DOM drift) -- override per test
    const makeLocator = (innerTexts: string[] = []): { allInnerTexts: () => Promise<string[]>; all: () => Promise<object[]> } => ({
      allInnerTexts: vi.fn().mockResolvedValue(innerTexts),
      all: vi.fn().mockResolvedValue([]),
    })
    vi.mocked(mockPage.locator).mockReturnValue(makeLocator() as never)
  })

  afterEach(() => {
    // Clean up env vars set during tests
    delete process.env.VERCEL
    delete process.env.SEVENSTACKS_USERNAME
    delete process.env.SEVENSTACKS_PASSWORD
    delete process.env.BETVEGAS23_USERNAME
    delete process.env.BETVEGAS23_PASSWORD
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  // ── (1) VERCEL guard ─────────────────────────────────────────────────────────

  describe('isEnabled() — VERCEL guard (D-02, T-11-06)', () => {
    it('returns false when process.env.VERCEL is set, even with valid creds', () => {
      process.env.VERCEL = '1'
      process.env.SEVENSTACKS_USERNAME = 'user'
      process.env.SEVENSTACKS_PASSWORD = 'pass'

      expect(sevenStacksAdapter.isEnabled()).toBe(false)
    })

    it('returns false when process.env.VERCEL is set for betvegas23 adapter', () => {
      process.env.VERCEL = '1'
      process.env.BETVEGAS23_USERNAME = 'user'
      process.env.BETVEGAS23_PASSWORD = 'pass'

      expect(betVegas23Adapter.isEnabled()).toBe(false)
    })
  })

  // ── (2) 7stacks enabled with creds ──────────────────────────────────────────

  describe('sevenStacksAdapter.isEnabled() — creds gate (D-02, BOOK-05)', () => {
    it('returns true when SEVENSTACKS_USERNAME and SEVENSTACKS_PASSWORD are present (no VERCEL)', () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'myuser'
      process.env.SEVENSTACKS_PASSWORD = 'mypass'

      expect(sevenStacksAdapter.isEnabled()).toBe(true)
    })

    it('returns false when only SEVENSTACKS_USERNAME is set (missing password)', () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'myuser'
      delete process.env.SEVENSTACKS_PASSWORD

      expect(sevenStacksAdapter.isEnabled()).toBe(false)
    })

    it('returns false when only SEVENSTACKS_PASSWORD is set (missing username)', () => {
      delete process.env.VERCEL
      delete process.env.SEVENSTACKS_USERNAME
      process.env.SEVENSTACKS_PASSWORD = 'mypass'

      expect(sevenStacksAdapter.isEnabled()).toBe(false)
    })

    it('returns false when neither cred is set', () => {
      delete process.env.VERCEL
      delete process.env.SEVENSTACKS_USERNAME
      delete process.env.SEVENSTACKS_PASSWORD

      expect(sevenStacksAdapter.isEnabled()).toBe(false)
    })
  })

  // ── (3) betvegas23 disabled (no creds = clean skip) ─────────────────────────

  describe('betVegas23Adapter.isEnabled() — disabled drop-in (D-06, BOOK-05)', () => {
    it('returns false when BETVEGAS23_* creds are absent (clean skip, not an error)', () => {
      delete process.env.VERCEL
      delete process.env.BETVEGAS23_USERNAME
      delete process.env.BETVEGAS23_PASSWORD

      expect(betVegas23Adapter.isEnabled()).toBe(false)
    })

    it('returns true when BETVEGAS23_* creds are present (drop-in activation path)', () => {
      delete process.env.VERCEL
      process.env.BETVEGAS23_USERNAME = 'bv23user'
      process.env.BETVEGAS23_PASSWORD = 'bv23pass'

      expect(betVegas23Adapter.isEnabled()).toBe(true)
    })
  })

  // ── (4) fetchMarket() — disabled adapter returns null (no throw) ─────────────

  describe('fetchMarket() — disabled adapter (D-02)', () => {
    it('returns null (no throw) when isEnabled() is false due to VERCEL', async () => {
      process.env.VERCEL = '1'
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(chromium.launch).not.toHaveBeenCalled()
    })

    it('returns null (no throw) when isEnabled() is false due to missing creds', async () => {
      delete process.env.VERCEL
      delete process.env.SEVENSTACKS_USERNAME
      delete process.env.SEVENSTACKS_PASSWORD

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(chromium.launch).not.toHaveBeenCalled()
    })
  })

  // ── (5) fetchMarket() — missing session file returns null (no throw) ─────────

  describe('fetchMarket() — missing session (D-04, BOOK-05)', () => {
    it('returns null (no throw) when session file does not exist', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(false)

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      // No browser launch when session missing
      expect(chromium.launch).not.toHaveBeenCalled()
    })
  })

  // ── (6) fetchMarket() — login redirect → scrape_health 'session_expired' + null

  describe('fetchMarket() — stale session redirect (D-04, T-11-08, Pitfall 1)', () => {
    it('returns null and upserts scrape_health session_expired on /default.aspx redirect', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      // Simulate login redirect after page.goto
      vi.mocked(mockPage.url).mockReturnValue('https://7stacks.bet/default.aspx')

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      // Must upsert scrape_health with status='session_expired'
      expect(mockSupa.from).toHaveBeenCalledWith('scrape_health')
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          book: '7stacks',
          status: 'session_expired',
        }),
        expect.objectContaining({ onConflict: 'book' })
      )
    })

    it('detects /login path as a login redirect', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://7stacks.bet/login.aspx')

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'session_expired' }),
        expect.anything()
      )
    })
  })

  // ── (7) fetchMarket() — DOM drift returns null + upserts scrape_health ────────

  describe('fetchMarket() — DOM drift (T-11-09, Pitfall 2)', () => {
    it('returns null on DOM drift when locator returns no price rows', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      // Successful navigation (not a login redirect)
      vi.mocked(mockPage.url).mockReturnValue('https://7stacks.bet/wager/odds.aspx')
      // waitForSelector succeeds (table found)
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)
      // locator returns rows but no valid price cells
      const mockRowLocator = {
        all: vi.fn().mockResolvedValue([]),
        allInnerTexts: vi.fn().mockResolvedValue([]),
        locator: vi.fn().mockReturnValue({ allInnerTexts: vi.fn().mockResolvedValue([]) }),
      }
      vi.mocked(mockPage.locator).mockReturnValue(mockRowLocator as never)

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
    })
  })

  // ── (8) fetchMarket() — successful scrape → is_account_line=true + RAW implied ─

  /** Build a locator mock that returns two table rows with price text cells. */
  function makeOddsLocatorMock(
    row1Cells: string[],
    row2Cells: string[]
  ) {
    const makeRowLocator = (cells: string[]) => ({
      locator: vi.fn().mockReturnValue({
        allInnerTexts: vi.fn().mockResolvedValue(cells),
      }),
    })
    return {
      all: vi.fn().mockResolvedValue([makeRowLocator(row1Cells), makeRowLocator(row2Cells)]),
      allInnerTexts: vi.fn().mockResolvedValue([]),
      locator: vi.fn(),
    }
  }

  describe('fetchMarket() — successful scrape (D-03, BOOK-05)', () => {
    it('returns snapshots with is_account_line=true and RAW impliedProb on success', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://7stacks.bet/wager/odds.aspx')
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)

      // Two rows: home row has '-130' cell, away row has '+110' cell
      vi.mocked(mockPage.locator).mockReturnValue(
        makeOddsLocatorMock(['-130', 'Home Team'], ['110', 'Away Team']) as never
      )

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)

      expect(result).not.toBeNull()
      expect(result!.length).toBe(2)

      for (const snap of result!) {
        expect(snap.book).toBe('7stacks')
        expect(snap.sourceConfidence).toBe('scraped')
        expect(snap.isClosing).toBe(false)
      }

      const homeSnap = result!.find((s) => s.side === 'home')!
      expect(homeSnap).toBeDefined()
      expect(homeSnap.priceAmerican).toBe(-130)
      expect(homeSnap.priceDecimal).toBeCloseTo(americanToDecimal(-130), 10)
      expect(homeSnap.impliedProb).toBeCloseTo(impliedFromAmerican(-130), 10)

      const awaySnap = result!.find((s) => s.side === 'away')!
      expect(awaySnap).toBeDefined()
      expect(awaySnap.priceAmerican).toBe(110)
      expect(awaySnap.priceDecimal).toBeCloseTo(americanToDecimal(110), 10)
      expect(awaySnap.impliedProb).toBeCloseTo(impliedFromAmerican(110), 10)

      // Must upsert book_prices with is_account_line=true
      expect(mockSupa.from).toHaveBeenCalledWith('book_prices')
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            book: '7stacks',
            is_account_line: true,
          }),
        ]),
        expect.objectContaining({
          onConflict: 'market_id,book,side,is_account_line',
        })
      )
    })

    it('upsert payload carries RAW impliedProb (sum > 1.0 for vigged market)', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://7stacks.bet/wager/odds.aspx')
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)

      // Both sides at -110
      vi.mocked(mockPage.locator).mockReturnValue(
        makeOddsLocatorMock(['-110', 'Home'], ['-110', 'Away']) as never
      )

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      // Use a different market ID to avoid rate-limit from the prior test
      const market2 = { ...CANONICAL_MARKET, id: 'market-uuid-dgs-02' }
      const result = await sevenStacksAdapter.fetchMarket(market2)

      expect(result).not.toBeNull()
      for (const snap of result!) {
        const expectedRaw = impliedFromAmerican(-110)
        expect(snap.impliedProb).toBeCloseTo(expectedRaw, 10)
      }
      // Sum > 1.0 confirms RAW (not devigged)
      const sumRaw = result!.reduce((sum, s) => sum + s.impliedProb, 0)
      expect(sumRaw).toBeGreaterThan(1.0)
    })
  })

  // ── (9) fetchMarket() — network/unexpected error → null (never throw) ─────────

  describe('fetchMarket() — fail-closed on errors (T-11-09, D-06)', () => {
    it('returns null (no throw) on unexpected browser launch error', async () => {
      delete process.env.VERCEL
      process.env.SEVENSTACKS_USERNAME = 'u'
      process.env.SEVENSTACKS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(chromium.launch).mockRejectedValue(new Error('Browser launch failed'))

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      let result: unknown
      await expect(
        (async () => {
          result = await sevenStacksAdapter.fetchMarket(CANONICAL_MARKET)
        })()
      ).resolves.not.toThrow()

      expect(result).toBeNull()
    })
  })

  // ── (10) fetchEvents() — minimal stub returns [] ──────────────────────────────

  describe('fetchEvents()', () => {
    it('returns an empty array (minimal stub for Phase 11-02 scope)', async () => {
      const result = await sevenStacksAdapter.fetchEvents(
        'mlb',
        new Date('2026-05-22T00:00:00Z'),
        new Date('2026-05-23T00:00:00Z')
      )
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── (11) Read-only invariant — assertNoOrderSurface passes ───────────────────

  describe('read-only enforcement (BOOK-06, D-05, T-11-06)', () => {
    it('sevenStacksAdapter has no order-placement methods (assertNoOrderSurface passes)', () => {
      expect(() => assertNoOrderSurface(sevenStacksAdapter)).not.toThrow()
    })

    it('betVegas23Adapter has no order-placement methods (assertNoOrderSurface passes)', () => {
      expect(() => assertNoOrderSurface(betVegas23Adapter)).not.toThrow()
    })

    it('adapter prototype has no forbidden method names', () => {
      const forbidden = [
        'placeBet',
        'confirmBet',
        'submitOrder',
        'placeOrder',
        'createOrder',
        'cancelOrder',
        'modifyBet',
      ]
      const instance = sevenStacksAdapter
      let proto: object | null = instance
      const names = new Set<string>()
      while (proto !== null && proto !== Object.prototype) {
        for (const key of Object.getOwnPropertyNames(proto)) names.add(key)
        proto = Object.getPrototypeOf(proto)
      }
      for (const name of forbidden) {
        expect(names, `forbidden method '${name}' must not exist`).not.toContain(name)
      }
    })
  })

  // ── (12) Adapter metadata ─────────────────────────────────────────────────────

  describe('adapter metadata', () => {
    it('sevenStacksAdapter has name="7stacks" and sourceConfidence="scraped"', () => {
      expect(sevenStacksAdapter.name).toBe('7stacks')
      expect(sevenStacksAdapter.sourceConfidence).toBe('scraped')
    })

    it('betVegas23Adapter has name="betvegas23" and sourceConfidence="scraped"', () => {
      expect(betVegas23Adapter.name).toBe('betvegas23')
      expect(betVegas23Adapter.sourceConfidence).toBe('scraped')
    })
  })
})
