/**
 * bovada-adapter.ts
 *
 * Live login/scrape deferred to the live-activation runbook (post-MVP);
 * this adapter ships DISABLED and is mock-tested only.
 *
 * Credentialed account-line adapter for Bovada — a bespoke React-SPA sportsbook.
 * This is NOT a DgsPphAdapter instance: Bovada runs its own React app (bovada.lv)
 * with its own DOM structure, NOT the DGS /wager/*.aspx ASP.NET portal.
 *
 * Safety model (BOOK-07, D-02..D-07):
 *   - Daemon-only: isEnabled() returns false under process.env.VERCEL
 *   - Credentials: process.env ONLY (BOVADA_USERNAME / BOVADA_PASSWORD); never logged
 *   - DISABLED by default: no creds exist yet → isEnabled() = false → clean skip
 *   - Session: persisted storageState (.auth/bovada-session.json); login is a deferred
 *     manual setup step (the live-activation runbook), never in the automated scrape path
 *   - Read-only: navigation constrained by assertAllowlisted() to BOVADA_ALLOWLIST;
 *     NO bet-slip / place / confirm / order code path exists
 *   - Fail-closed: every failure path logs + returns null (never throws)
 *   - Rate-limited: <= 1 fetch / market / 5 min
 *
 * Phase 12-01  BOOK-07  D-01..D-07
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { americanToDecimal, impliedFromAmerican } from '../../clv.js'
import { getServiceClient } from '../../supabase-admin.js'
import { assertAllowlisted } from './read-only-invariant.js'
import type {
  BookAdapter,
  BookName,
  SourceConfidence,
  CanonicalMarket,
  BookPriceSnapshot,
  RawBookEvent,
} from './types.js'

// --- Constants ----------------------------------------------------------------

/** Rate-limit window in milliseconds (5 minutes). */
const RATE_LIMIT_MS = 5 * 60 * 1000

/** Real browser UA to avoid bot detection on the Bovada React SPA. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Bovada odds-page URL allowlist.
 * Prefix matching covers all market sub-paths.
 * NO bet-slip, cart, betslip, place, confirm, or checkout URLs are permitted.
 * (D-05, assertAllowlisted enforces this at runtime)
 *
 * NOTE (Claude Discretion): Bovada serves odds at /sports/* paths. These selectors
 * are best-effort and will be validated live by the user when the account is funded.
 */
export const BOVADA_ALLOWLIST: string[] = [
  'https://www.bovada.lv/sports/baseball',
  'https://www.bovada.lv/sports/basketball',
  'https://www.bovada.lv/sports/football',
  'https://www.bovada.lv/sports/hockey',
  'https://www.bovada.lv/sports/soccer',
  'https://www.bovada.lv/sports/golf',
  'https://www.bovada.lv/sports/tennis',
  'https://www.bovada.lv/sports/mma',
]

/** Path patterns that indicate a Bovada login redirect (stale session). */
const LOGIN_URL_PATTERNS = ['/login', '/signin', 'bovada.lv/login', 'bovada.lv/signin']

/** Relative path to the persisted storageState session file. */
const SESSION_PATH = '.auth/bovada-session.json'

/** American price sanity range — discard anything outside this window. */
const PRICE_MIN = -10000
const PRICE_MAX = 10000

// --- Helpers -----------------------------------------------------------------

/**
 * Map a sport string to the Bovada odds-page URL segment.
 * Returns the most appropriate allowlisted URL for the given sport.
 * (Claude Discretion: sport-to-URL mapping for Bovada's React SPA)
 */
function sportToUrl(sport: string): string {
  const sportMap: Record<string, string> = {
    mlb: 'https://www.bovada.lv/sports/baseball',
    nba: 'https://www.bovada.lv/sports/basketball',
    nfl: 'https://www.bovada.lv/sports/football',
    nhl: 'https://www.bovada.lv/sports/hockey',
    ncaaf: 'https://www.bovada.lv/sports/football',
    ncaab: 'https://www.bovada.lv/sports/basketball',
    soccer: 'https://www.bovada.lv/sports/soccer',
    golf: 'https://www.bovada.lv/sports/golf',
    tennis: 'https://www.bovada.lv/sports/tennis',
    mma: 'https://www.bovada.lv/sports/mma',
    ufc: 'https://www.bovada.lv/sports/mma',
  }
  return sportMap[sport.toLowerCase()] ?? 'https://www.bovada.lv/sports/baseball'
}

/**
 * Parse American-format price strings from Bovada's React SPA DOM text content.
 * Bovada renders odds as text nodes inside coupon rows (e.g. span[data-test-id="price"]).
 * Returns up to 2 { side, priceAmerican } results.
 * (Claude Discretion: Bovada-specific SPA selectors — validated live at activation)
 */
function parseOddsTexts(
  texts: string[]
): Array<{ side: string; priceAmerican: number }> {
  const results: Array<{ side: string; priceAmerican: number }> = []
  for (const text of texts) {
    const match = text.trim().match(/^([+-]?\d{2,5})$/)
    if (!match) continue
    const price = Number(match[1])
    if (price === 0) continue
    const side = results.length === 0 ? 'home' : 'away'
    results.push({ side, priceAmerican: price })
    if (results.length === 2) break
  }
  return results
}

// --- BovadaAdapter -----------------------------------------------------------

/**
 * Credentialed account-line adapter for Bovada (bespoke React SPA).
 *
 * READ-ONLY INVARIANT: No method named placeBet, confirmBet, submitOrder,
 * placeOrder, createOrder, cancelOrder, or modifyBet may exist here.
 * assertNoOrderSurface() in tests enforces this. (D-05, BOOK-07, T-12-01)
 *
 * DISABLED BY DEFAULT: isEnabled() returns false until BOVADA_* creds are set
 * AND process.env.VERCEL is absent. No Bovada account is funded yet.
 */
export class BovadaAdapter implements BookAdapter {
  readonly name: BookName = 'bovada'
  readonly sourceConfidence: SourceConfidence = 'scraped'

  private readonly lastFetchAt: Map<string, number> = new Map()

  /**
   * Returns true only in daemon context with both BOVADA_USERNAME and
   * BOVADA_PASSWORD set. (D-02, D-03: DISABLED by default — no creds yet)
   */
  isEnabled(): boolean {
    if (process.env.VERCEL) return false
    return Boolean(process.env.BOVADA_USERNAME && process.env.BOVADA_PASSWORD)
  }

  /**
   * Scrape the current posted line for market from the user's Bovada account.
   * Returns null (never throws) on: disabled, missing session, login redirect,
   * DOM drift, or any unexpected error. (D-03, D-06)
   *
   * NOTE: Bovada DOM selectors are best-effort (Claude Discretion) and will be
   * validated live by the user when the account is funded (post-MVP).
   */
  async fetchMarket(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    if (!this.isEnabled()) return null

    const sessionAbsPath = path.resolve(SESSION_PATH)
    if (!existsSync(sessionAbsPath)) {
      console.warn(
        `[bovada] Session file not found: ${SESSION_PATH}` +
          ' -- run the Bovada auth-setup script (live-activation runbook) to create it.'
      )
      return null
    }

    const lastFetch = this.lastFetchAt.get(market.id)
    if (lastFetch !== undefined && Date.now() - lastFetch < RATE_LIMIT_MS) {
      return null
    }

    const targetUrl = sportToUrl(market.sport)
    assertAllowlisted(targetUrl, BOVADA_ALLOWLIST)

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
    try {
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({
        storageState: sessionAbsPath,
        userAgent: USER_AGENT,
      })
      const page = await context.newPage()
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })

      const currentUrl = page.url()
      if (this.isLoginRedirect(currentUrl)) {
        console.warn(
          `[bovada] Session expired (redirect to ${currentUrl}).`
        )
        await this.upsertScrapeHealth('session_expired')
        return null
      }

      // Wait for the Bovada React SPA odds coupon to load.
      // Bovada renders coupon rows with a data-reactive attribute or nested spans.
      // (Claude Discretion: selector — validated live at activation)
      const oddsHandle = await page
        .waitForSelector('[data-test-id="price"], .bet-price, .market-line__price', { timeout: 12000 })
        .catch(() => null)

      if (!oddsHandle) {
        console.warn('[bovada] DOM drift: odds price selector timed out.')
        await this.upsertScrapeHealth('dom_drift')
        return null
      }

      // Extract all price text nodes visible on the page.
      // Bovada uses React-rendered spans; allInnerTexts covers the rendered text.
      // (Claude Discretion: Bovada SPA selector — validated live at activation)
      const priceTexts: string[] = await (async () => {
        try {
          return await page
            .locator('[data-test-id="price"], .bet-price, .market-line__price')
            .allInnerTexts()
        } catch {
          return []
        }
      })()

      const rawRows = parseOddsTexts(priceTexts)

      if (rawRows.length === 0) {
        console.warn('[bovada] DOM drift: no price texts extracted.')
        await this.upsertScrapeHealth('dom_drift')
        return null
      }

      const fetchedAt = new Date()
      const snapshots: BookPriceSnapshot[] = []

      for (const row of rawRows) {
        const price = row.priceAmerican
        if (price < PRICE_MIN || price > PRICE_MAX) {
          console.warn(`[bovada] Price ${price} out of range -- skipping.`)
          continue
        }
        snapshots.push({
          book: 'bovada',
          side: row.side as BookPriceSnapshot['side'],
          priceAmerican: price,
          priceDecimal: americanToDecimal(price),
          impliedProb: impliedFromAmerican(price), // RAW — D-03 invariant
          point: market.marketParam !== null ? Number(market.marketParam) : null,
          fetchedAt,
          sourceConfidence: 'scraped',
          isClosing: false,
        })
      }

      if (snapshots.length === 0) {
        await this.upsertScrapeHealth('dom_drift')
        return null
      }

      const db = getServiceClient()
      const dbRows = snapshots.map((snap) => ({
        market_id: market.id,
        book: snap.book,
        side: snap.side,
        price_american: snap.priceAmerican,
        price_decimal: snap.priceDecimal,
        implied_prob: snap.impliedProb,
        point: snap.point,
        fetched_at: snap.fetchedAt.toISOString(),
        source_confidence: snap.sourceConfidence,
        is_closing: snap.isClosing,
        is_account_line: true, // D-06: the user's actual Bovada account line
      }))

      const { error } = await db
        .from('book_prices')
        .upsert(dbRows, { onConflict: 'market_id,book,side,is_account_line' })
      if (error) {
        console.error('[bovada] book_prices upsert error:', error.message)
      }

      this.lastFetchAt.set(market.id, Date.now())
      return snapshots
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[bovada] Unexpected error in fetchMarket:', msg)
      await this.upsertScrapeHealth('unreachable').catch(() => {})
      return null
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  }

  /**
   * Minimal stub — Bovada account-line scrape scope is fetchMarket only (Phase 12-01).
   * Live event discovery is out of scope until the account is activated.
   */
  async fetchEvents(_sport: string, _from: Date, _to: Date): Promise<RawBookEvent[]> {
    return []
  }

  private isLoginRedirect(url: string): boolean {
    return LOGIN_URL_PATTERNS.some((pattern) => url.includes(pattern))
  }

  private async upsertScrapeHealth(
    status: 'session_expired' | 'dom_drift' | 'unreachable'
  ): Promise<void> {
    try {
      const db = getServiceClient()
      await db.from('scrape_health').upsert(
        { book: 'bovada', status, checked_at: new Date().toISOString() },
        { onConflict: 'book' }
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[bovada] scrape_health upsert failed:', msg)
    }
  }
}
