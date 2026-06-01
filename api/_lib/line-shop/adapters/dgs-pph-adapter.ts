/**
 * dgs-pph-adapter.ts
 *
 * Parameterized read-only credentialed adapter for DGS Pay-Per-Head (PPH)
 * sportsbook portals. ONE class -- DgsPphAdapter -- handles all DGS PPH books
 * because they run identical portal software (/wager/*.aspx, ASP.NET WebForms).
 *
 * Exported instances:
 *   - sevenStacksAdapter  (7stacks.bet -- ENABLED when SEVENSTACKS_* creds present)
 *   - betVegas23Adapter   (betvegas23.com -- DISABLED until BETVEGAS23_* creds exist)
 *
 * Safety model (BOOK-05, BOOK-06, D-02..D-07):
 *   - Daemon-only: isEnabled() returns false under process.env.VERCEL
 *   - Credentials: process.env ONLY; never logged, never written to Supabase
 *   - Session: persisted storageState file; login ONLY in manual setup script
 *   - Read-only: navigation constrained by assertAllowlisted(); no order methods
 *   - Fail-closed: every failure path logs + returns null (never throws)
 *   - Rate-limited: <= 1 fetch / market / 5 min
 *
 * Phase 11-02  BOOK-05 / BOOK-06  D-01..D-07
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

/** Real browser UA to avoid bot challenges on ASP.NET portals. */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** URL patterns that indicate a DGS login redirect (stale session). */
const LOGIN_URL_PATTERNS = ['/default.aspx', '/login', '/Login', '/Default.aspx']

/** American price sanity range -- discard anything outside this window. */
const PRICE_MIN = -10000
const PRICE_MAX = 10000

// --- Per-book configuration --------------------------------------------------

export interface DgsPphAdapterConfig {
  book: BookName
  /** process.env key for the username credential. */
  userEnv: string
  /** process.env key for the password credential. */
  passEnv: string
  /** Relative path to the persisted storageState session file. */
  sessionPath: string
  /**
   * URL prefix allowlist -- ONLY /wager/ odds-page prefixes.
   * No bet-slip, place, confirm, or order URLs.
   */
  allowlist: string[]
}

// --- Helpers -----------------------------------------------------------------

/**
 * Parse American-format price strings from DOM text content.
 * DGS portals use ASP.NET WebForms table markup (not a React SPA).
 * Returns an array of { side, priceAmerican } for the first two valid prices found.
 * Claude Discretion: heuristics for ASP.NET table layout.
 */
function parseOddsRows(
  rowTexts: string[][]
): Array<{ side: string; priceAmerican: number }> {
  const results: Array<{ side: string; priceAmerican: number }> = []
  for (const cells of rowTexts) {
    if (cells.length < 2) continue
    for (const cell of cells) {
      const match = cell.trim().match(/^([+-]?\d{2,5})$/)
      if (!match) continue
      const price = Number(match[1])
      if (price === 0) continue
      const side = results.length === 0 ? 'home' : 'away'
      results.push({ side, priceAmerican: price })
      if (results.length === 2) break
    }
    if (results.length === 2) break
  }
  return results
}

// --- DgsPphAdapter -----------------------------------------------------------

/**
 * Parameterized credentialed account-line adapter for DGS Pay-Per-Head portals.
 *
 * READ-ONLY INVARIANT: No method named placeBet, confirmBet, submitOrder,
 * placeOrder, createOrder, cancelOrder, or modifyBet may exist here.
 * assertNoOrderSurface() in tests enforces this. (D-05, BOOK-06, T-11-06)
 */
export class DgsPphAdapter implements BookAdapter {
  readonly name: BookName
  readonly sourceConfidence: SourceConfidence = 'scraped'

  private readonly cfg: DgsPphAdapterConfig
  private readonly lastFetchAt: Map<string, number> = new Map()

  constructor(cfg: DgsPphAdapterConfig) {
    this.cfg = cfg
    this.name = cfg.book
  }

  /** Returns true only in daemon context with both creds set. (D-02, T-11-06) */
  isEnabled(): boolean {
    if (process.env.VERCEL) return false
    return Boolean(process.env[this.cfg.userEnv] && process.env[this.cfg.passEnv])
  }

  /**
   * Scrape the current posted line for market from this DGS PPH portal.
   * Returns null (never throws) on: disabled, missing session, login redirect,
   * DOM drift, or any unexpected error. (D-03, D-06)
   */
  async fetchMarket(market: CanonicalMarket): Promise<BookPriceSnapshot[] | null> {
    if (!this.isEnabled()) return null

    const sessionAbsPath = path.resolve(this.cfg.sessionPath)
    if (!existsSync(sessionAbsPath)) {
      console.warn(
        `[dgs-pph:${this.cfg.book}] Session file not found: ${this.cfg.sessionPath}` +
          ' -- run setup-auth script to create it.'
      )
      return null
    }

    const lastFetch = this.lastFetchAt.get(market.id)
    if (lastFetch !== undefined && Date.now() - lastFetch < RATE_LIMIT_MS) {
      return null
    }

    const baseUrl = this.cfg.allowlist[0]
    const targetUrl = `${baseUrl}?sport=${encodeURIComponent(market.sport)}`
    assertAllowlisted(targetUrl, this.cfg.allowlist)

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
          `[dgs-pph:${this.cfg.book}] Session expired (redirect to ${currentUrl}).`
        )
        await this.upsertScrapeHealth('session_expired')
        return null
      }

      // Wait for the odds table; timeout = DOM drift
      const tableHandle = await page
        .waitForSelector('table', { timeout: 10000 })
        .catch(() => null)

      if (!tableHandle) {
        console.warn(`[dgs-pph:${this.cfg.book}] DOM drift: odds table selector timed out.`)
        await this.upsertScrapeHealth('dom_drift')
        return null
      }

      // Extract row cell texts using the modern Playwright locator API.
      // page.locator('tr').all() + locator.locator('td').allInnerTexts()
      // avoids the page.evaluate / DOM-serialization approach and is the
      // idiomatic Playwright way to read table data. (Claude Discretion: ASP.NET table layout)
      const rowTexts: string[][] = await (async () => {
        try {
          const rows = await page.locator('tr').all()
          const result: string[][] = []
          for (const row of rows) {
            const cells = await row.locator('td').allInnerTexts()
            result.push(cells)
          }
          return result
        } catch {
          return []
        }
      })()

      const rawRows = parseOddsRows(rowTexts)

      if (rawRows.length === 0) {
        console.warn(`[dgs-pph:${this.cfg.book}] DOM drift: no price rows extracted.`)
        await this.upsertScrapeHealth('dom_drift')
        return null
      }

      const fetchedAt = new Date()
      const snapshots: BookPriceSnapshot[] = []

      for (const row of rawRows) {
        const price = row.priceAmerican
        if (price < PRICE_MIN || price > PRICE_MAX) {
          console.warn(`[dgs-pph:${this.cfg.book}] Price ${price} out of range -- skipping.`)
          continue
        }
        snapshots.push({
          book: this.cfg.book,
          side: row.side as BookPriceSnapshot['side'],
          priceAmerican: price,
          priceDecimal: americanToDecimal(price),
          impliedProb: impliedFromAmerican(price), // RAW -- D-03 invariant
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
        is_account_line: true, // D-03: the user's actual account line
      }))

      const { error } = await db
        .from('book_prices')
        .upsert(dbRows, { onConflict: 'market_id,book,side,is_account_line' })
      if (error) {
        console.error(`[dgs-pph:${this.cfg.book}] book_prices upsert error:`, error.message)
      }

      this.lastFetchAt.set(market.id, Date.now())
      return snapshots
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[dgs-pph:${this.cfg.book}] Unexpected error in fetchMarket:`, msg)
      await this.upsertScrapeHealth('unreachable').catch(() => {})
      return null
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  }

  /**
   * Minimal stub -- DGS PPH books have no public event feed.
   * Account-line price read via fetchMarket is the Phase 11-02 scope.
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
        { book: this.cfg.book, status, checked_at: new Date().toISOString() },
        { onConflict: 'book' }
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[dgs-pph:${this.cfg.book}] scrape_health upsert failed:`, msg)
    }
  }
}

// --- Exported instances ------------------------------------------------------

/**
 * 7stacks.bet -- DGS PPH credentialed account-line adapter.
 * ENABLED when SEVENSTACKS_USERNAME + SEVENSTACKS_PASSWORD set + no VERCEL.
 * Setup: run `node scripts/setup-auth-7stacks.mjs` (headed, manual) once to
 * create .auth/7stacks-session.json; re-run when the session expires.
 */
export const sevenStacksAdapter = new DgsPphAdapter({
  book: '7stacks',
  userEnv: 'SEVENSTACKS_USERNAME',
  passEnv: 'SEVENSTACKS_PASSWORD',
  sessionPath: '.auth/7stacks-session.json',
  allowlist: [
    'https://7stacks.bet/wager/odds.aspx',
    'https://7stacks.bet/wager/lines.aspx',
  ],
})

/**
 * betvegas23.com -- DGS PPH credentialed account-line adapter.
 * DISABLED until BETVEGAS23_USERNAME + BETVEGAS23_PASSWORD are set.
 * DROP-IN: same class as sevenStacksAdapter (same DGS portal software).
 * No betvegas23 auth-setup script is created now (no account yet).
 * Activation: set creds + run `node scripts/setup-auth-betvegas23.mjs`.
 */
export const betVegas23Adapter = new DgsPphAdapter({
  book: 'betvegas23',
  userEnv: 'BETVEGAS23_USERNAME',
  passEnv: 'BETVEGAS23_PASSWORD',
  sessionPath: '.auth/betvegas23-session.json',
  allowlist: [
    'https://betvegas23.com/wager/odds.aspx',
    'https://betvegas23.com/wager/lines.aspx',
  ],
})
