/**
 * betus-adapter.test.ts
 *
 * Vitest suite for BetUSAdapter (Phase 12-02).
 *
 * Live login/scrape deferred to the live-activation runbook (post-MVP);
 * this adapter ships DISABLED and is mock-tested only.
 *
 * Coverage required by plan §must_haves / acceptance_criteria:
 *  1. isEnabled() returns false when process.env.VERCEL is set (even with creds)
 *  2. isEnabled() returns false when BETUS_* creds are absent (disabled by default)
 *  3. fetchMarket() returns null (no throw) when session file is missing
 *  4. fetchMarket() returns null + upserts scrape_health 'session_expired' on login redirect
 *  5. On a mocked odds page, snapshots carry is_account_line=true and RAW impliedProb
 *  6. DOM drift (selector resolves null) → null + scrape_health 'dom_drift'
 *  7. assertNoOrderSurface(new BetUSAdapter()) passes (no forbidden methods)
 *
 * Mocks: node:fs (existsSync), playwright (chromium), api/_lib/supabase-admin.ts
 * (getServiceClient). NO live browser, NO live network, NO live login.
 *
 * BOOK-07, D-02/D-03/D-04/D-05/D-06, T-12-06..T-12-10
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

// ─── Import mocks + module under test (after vi.mock hoisting) ────────────────

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { getServiceClient } from '../../supabase-admin.js'
import { BetUSAdapter } from './betus-adapter.js'

// ─── Helper: lightweight Supabase mock that tracks upsert calls ───────────────

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

// ─── Shared canonical market fixture ──────────────────────────────────────────

const CANONICAL_MARKET = {
  id: 'market-uuid-betus-01',
  sport: 'mlb',
  eventId: 'MLB_20260522_MIL_CHC',
  eventName: 'Brewers @ Cubs',
  eventStart: new Date('2026-05-22T19:05:00Z'),
  oddsApiEventId: null,
  marketType: 'moneyline' as const,
  marketParam: null,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BetUSAdapter', () => {
  let adapter: BetUSAdapter

  beforeEach(() => {
    adapter = new BetUSAdapter()
    vi.clearAllMocks()

    // Re-apply sensible default mock return values after clearAllMocks
    vi.mocked(mockBrowser.newContext).mockResolvedValue(mockContext)
    vi.mocked(mockContext.newPage).mockResolvedValue(mockPage)
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser)
    vi.mocked(mockBrowser.close).mockResolvedValue(undefined)
    vi.mocked(mockContext.close).mockResolvedValue(undefined)
    vi.mocked(mockPage.close).mockResolvedValue(undefined)
    vi.mocked(mockPage.goto).mockResolvedValue(null as never)

    // Default locator: returns empty inner texts (DOM drift) — override per test
    vi.mocked(mockPage.locator).mockReturnValue({
      allInnerTexts: vi.fn().mockResolvedValue([]),
      all: vi.fn().mockResolvedValue([]),
    } as never)
  })

  afterEach(() => {
    delete process.env.VERCEL
    delete process.env.BETUS_USERNAME
    delete process.env.BETUS_PASSWORD
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  // ── (1) isEnabled() — VERCEL guard (D-02, T-12-06) ──────────────────────────

  describe('isEnabled() — VERCEL guard (D-02, T-12-06)', () => {
    it('returns false when process.env.VERCEL is set, even with valid creds', () => {
      process.env.VERCEL = '1'
      process.env.BETUS_USERNAME = 'user'
      process.env.BETUS_PASSWORD = 'pass'

      expect(adapter.isEnabled()).toBe(false)
    })

    it('returns false when process.env.VERCEL is set with no creds', () => {
      process.env.VERCEL = '1'
      delete process.env.BETUS_USERNAME
      delete process.env.BETUS_PASSWORD

      expect(adapter.isEnabled()).toBe(false)
    })
  })

  // ── (2) isEnabled() — creds gate (D-03: disabled by default) ────────────────

  describe('isEnabled() — creds gate, disabled by default (D-03, BOOK-07)', () => {
    it('returns false when BETUS_* creds are absent (disabled by default — no account yet)', () => {
      delete process.env.VERCEL
      delete process.env.BETUS_USERNAME
      delete process.env.BETUS_PASSWORD

      expect(adapter.isEnabled()).toBe(false)
    })

    it('returns false when only BETUS_USERNAME is set (missing password)', () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'myuser'
      delete process.env.BETUS_PASSWORD

      expect(adapter.isEnabled()).toBe(false)
    })

    it('returns false when only BETUS_PASSWORD is set (missing username)', () => {
      delete process.env.VERCEL
      delete process.env.BETUS_USERNAME
      process.env.BETUS_PASSWORD = 'mypass'

      expect(adapter.isEnabled()).toBe(false)
    })

    it('returns true when both creds present and VERCEL is absent (post-activation path)', () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'myuser'
      process.env.BETUS_PASSWORD = 'mypass'

      expect(adapter.isEnabled()).toBe(true)
    })
  })

  // ── (3) fetchMarket() — disabled adapter returns null (no throw) ─────────────

  describe('fetchMarket() — disabled adapter (D-02/D-03)', () => {
    it('returns null (no throw) when isEnabled() is false due to VERCEL', async () => {
      process.env.VERCEL = '1'
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(chromium.launch).not.toHaveBeenCalled()
    })

    it('returns null (no throw) when isEnabled() is false due to missing creds', async () => {
      delete process.env.VERCEL
      delete process.env.BETUS_USERNAME
      delete process.env.BETUS_PASSWORD

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(chromium.launch).not.toHaveBeenCalled()
    })
  })

  // ── (4) fetchMarket() — missing session file returns null (no throw) ─────────

  describe('fetchMarket() — missing session (D-04, BOOK-07)', () => {
    it('returns null (no throw) when session file does not exist', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(false)

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(chromium.launch).not.toHaveBeenCalled()
    })
  })

  // ── (5) fetchMarket() — login redirect → scrape_health 'session_expired' + null

  describe('fetchMarket() — stale session redirect (D-04, T-12-08, Pitfall 1)', () => {
    it('returns null and upserts scrape_health session_expired on /login redirect', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/login')

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(mockSupa.from).toHaveBeenCalledWith('scrape_health')
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          book: 'betus',
          status: 'session_expired',
        }),
        expect.objectContaining({ onConflict: 'book' })
      )
    })

    it('detects /signin path as a login redirect', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/signin')

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'session_expired' }),
        expect.anything()
      )
    })
  })

  // ── (6) fetchMarket() — DOM drift returns null + upserts scrape_health ────────

  describe('fetchMarket() — DOM drift (T-12-08, Pitfall 2)', () => {
    it('returns null and upserts scrape_health dom_drift when odds selector times out', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/sports/baseball')
      // waitForSelector rejects (timeout → catch → null)
      vi.mocked(mockPage.waitForSelector).mockRejectedValue(new Error('Timeout'))

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
      expect(mockSupa.from).toHaveBeenCalledWith('scrape_health')
      expect(mockSupa._upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          book: 'betus',
          status: 'dom_drift',
        }),
        expect.anything()
      )
    })

    it('returns null when selector resolves but locator returns no price texts', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/sports/baseball')
      // waitForSelector succeeds
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)
      // But locator returns no price texts
      vi.mocked(mockPage.locator).mockReturnValue({
        allInnerTexts: vi.fn().mockResolvedValue([]),
        all: vi.fn().mockResolvedValue([]),
      } as never)

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).toBeNull()
    })
  })

  // ── (7) fetchMarket() — successful scrape → is_account_line=true + RAW implied ─

  describe('fetchMarket() — successful scrape (D-06, BOOK-07)', () => {
    it('returns snapshots with is_account_line=true and RAW impliedProb on success', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/sports/baseball')
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)

      // Mock: locator returns two price texts ('-130' home, '+110' away)
      vi.mocked(mockPage.locator).mockReturnValue({
        allInnerTexts: vi.fn().mockResolvedValue(['-130', '+110']),
        all: vi.fn().mockResolvedValue([]),
      } as never)

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      const result = await adapter.fetchMarket(CANONICAL_MARKET)

      expect(result).not.toBeNull()
      expect(result!.length).toBe(2)

      for (const snap of result!) {
        expect(snap.book).toBe('betus')
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
            book: 'betus',
            is_account_line: true,
          }),
        ]),
        expect.objectContaining({
          onConflict: 'market_id,book,side,is_account_line',
        })
      )
    })

    it('snapshots carry RAW impliedProb (sum > 1.0 for a vigged market)', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(mockPage.url).mockReturnValue('https://www.betus.ag/sports/baseball')
      vi.mocked(mockPage.waitForSelector).mockResolvedValue({} as never)

      // Both sides at -110 (standard vig; raw implied > 0.5 each → sum > 1.0)
      vi.mocked(mockPage.locator).mockReturnValue({
        allInnerTexts: vi.fn().mockResolvedValue(['-110', '-110']),
        all: vi.fn().mockResolvedValue([]),
      } as never)

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      // Use a different market ID to avoid the rate-limit from the prior test
      const market2 = { ...CANONICAL_MARKET, id: 'market-uuid-betus-02' }
      const result = await adapter.fetchMarket(market2)

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

  // ── (8) fetchMarket() — network/unexpected error → null (never throw) ─────────

  describe('fetchMarket() — fail-closed on errors (T-12-08, D-06)', () => {
    it('returns null (no throw) on unexpected browser launch error', async () => {
      delete process.env.VERCEL
      process.env.BETUS_USERNAME = 'u'
      process.env.BETUS_PASSWORD = 'p'

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(chromium.launch).mockRejectedValue(new Error('Browser launch failed'))

      const mockSupa = makeMockSupabase()
      vi.mocked(getServiceClient).mockReturnValue(
        mockSupa as ReturnType<typeof getServiceClient>
      )

      let result: unknown
      await expect(
        (async () => {
          result = await adapter.fetchMarket(CANONICAL_MARKET)
        })()
      ).resolves.not.toThrow()

      expect(result).toBeNull()
    })
  })

  // ── (9) fetchEvents() — minimal stub returns [] ──────────────────────────────

  describe('fetchEvents()', () => {
    it('returns an empty array (minimal stub — account-line scope is fetchMarket only)', async () => {
      const result = await adapter.fetchEvents(
        'mlb',
        new Date('2026-05-22T00:00:00Z'),
        new Date('2026-05-23T00:00:00Z')
      )
      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  // ── (10) Read-only invariant — assertNoOrderSurface passes ────────────────────

  describe('read-only enforcement (BOOK-07, D-05, T-12-06)', () => {
    it('assertNoOrderSurface(new BetUSAdapter()) passes — no forbidden methods', () => {
      expect(() => assertNoOrderSurface(new BetUSAdapter())).not.toThrow()
    })

    it('BetUSAdapter prototype has no forbidden method names', () => {
      const forbidden = [
        'placeBet',
        'confirmBet',
        'submitOrder',
        'placeOrder',
        'createOrder',
        'cancelOrder',
        'modifyBet',
      ]
      let proto: object | null = adapter
      const names = new Set<string>()
      while (proto !== null && proto !== Object.prototype) {
        for (const key of Object.getOwnPropertyNames(proto)) names.add(key)
        proto = Object.getPrototypeOf(proto)
      }
      for (const name of forbidden) {
        expect(names, `forbidden method '${name}' must not exist on BetUSAdapter`).not.toContain(name)
      }
    })
  })

  // ── (11) Adapter metadata ─────────────────────────────────────────────────────

  describe('adapter metadata', () => {
    it('has name="betus" and sourceConfidence="scraped"', () => {
      expect(adapter.name).toBe('betus')
      expect(adapter.sourceConfidence).toBe('scraped')
    })

    it('is its own class — NOT an instance of DgsPphAdapter', () => {
      // BetUS is a bespoke platform; constructor name must be BetUSAdapter
      expect(adapter.constructor.name).toBe('BetUSAdapter')
    })
  })
})
