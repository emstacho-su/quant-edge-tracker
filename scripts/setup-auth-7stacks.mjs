/**
 * setup-auth-7stacks.mjs
 *
 * Manual one-time auth-setup script for 7stacks.bet (DGS Pay-Per-Head portal).
 * Launches a HEADED browser (headless: false) so you can solve any CAPTCHA,
 * fills your credentials, confirms the post-login /wager/ landing, then saves
 * the session to .auth/7stacks-session.json via Playwright storageState.
 *
 * The daemon (DgsPphAdapter) reuses this session file on every scrape run.
 * Run this script again when the session expires (scrape_health status=session_expired).
 *
 * Usage:
 *   node --env-file=.env scripts/setup-auth-7stacks.mjs
 *
 * Required env vars (set in .env or daemon .env):
 *   SEVENSTACKS_USERNAME   -- your 7stacks.bet account username
 *   SEVENSTACKS_PASSWORD   -- your 7stacks.bet account password
 *
 * Output:
 *   .auth/7stacks-session.json   -- gitignored; loaded by the daemon adapter
 *
 * betvegas23 DROP-IN NOTE:
 *   When a betvegas23.com account exists, create a sibling script
 *   `scripts/setup-auth-betvegas23.mjs` using this exact same pattern:
 *     - Replace 7stacks.bet URL with the betvegas23.com portal login URL
 *     - Replace SEVENSTACKS_* env var names with BETVEGAS23_*
 *     - Replace session path with .auth/betvegas23-session.json
 *   No other changes needed -- same DGS portal software.
 *
 * This script NEVER places a bet. It navigates ONLY the login form and
 * confirms the /wager/ landing page. (BOOK-06, D-05)
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

// --- Config ------------------------------------------------------------------

const USERNAME = process.env.SEVENSTACKS_USERNAME
const PASSWORD = process.env.SEVENSTACKS_PASSWORD

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: SEVENSTACKS_USERNAME and SEVENSTACKS_PASSWORD must be set in env.')
  console.error('  Run with:  node --env-file=.env scripts/setup-auth-7stacks.mjs')
  process.exit(1)
}

const SESSION_PATH = path.join(PROJECT_ROOT, '.auth', '7stacks-session.json')

// 7stacks.bet DGS portal login URL.
// Claude Discretion: DGS PPH portals use /default.aspx as the login entry point.
const LOGIN_URL = 'https://7stacks.bet/default.aspx'

// Confirmation: after login the portal lands on a /wager/ sub-path.
const POST_LOGIN_URL_PATTERN = '**/wager/**'

// Post-login wait timeout (ms). Long enough for manual CAPTCHA solving.
const POST_LOGIN_TIMEOUT_MS = 30000

// Real browser UA to match the daemon adapter.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// --- Main --------------------------------------------------------------------

const browser = await chromium.launch({
  headless: false, // Headed -- user must be present to solve any CAPTCHA
  slowMo: 100,     // Slight slowdown for reliability on form fills
})

try {
  console.log('[setup-auth-7stacks] Launching headed browser...')

  const context = await browser.newContext({ userAgent: USER_AGENT })
  const page = await context.newPage()

  // Navigate to the DGS portal login page
  console.log(`[setup-auth-7stacks] Navigating to ${LOGIN_URL}`)
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

  // Fill credentials from env.
  // Claude Discretion: DGS ASP.NET WebForms login form selectors.
  // Common selector patterns for ASP.NET login fields:
  //   #txtUsername / #txtPassword  or  input[name*="User"] / input[name*="Pass"]
  // Try generic password input as a fallback.
  const usernameSelector = 'input[id*="ser"], input[name*="ser"], #txtUsername, input[type="text"]'
  const passwordSelector = 'input[type="password"]'

  await page.fill(usernameSelector, USERNAME).catch(async () => {
    console.warn('[setup-auth-7stacks] Username selector fallback -- trying input[type="text"]')
    const inputs = await page.locator('input[type="text"]').all()
    if (inputs.length > 0) await inputs[0].fill(USERNAME)
  })

  await page.fill(passwordSelector, PASSWORD)

  console.log('[setup-auth-7stacks] Credentials filled. Submitting login form...')
  console.log('[setup-auth-7stacks] If a CAPTCHA appears, solve it manually in the browser window.')

  // Submit the form (common DGS patterns: button[type=submit] or #btnLogin)
  await page.click('input[type="submit"], button[type="submit"], #btnLogin, #btnSubmit').catch(() => {
    return page.keyboard.press('Enter')
  })

  // Wait for the post-login /wager/ landing (confirms login succeeded).
  // Timeout is generous (30s) to allow time for manual CAPTCHA solving.
  console.log(`[setup-auth-7stacks] Waiting for post-login landing (${POST_LOGIN_TIMEOUT_MS / 1000}s timeout)...`)
  await page.waitForURL(POST_LOGIN_URL_PATTERN, { timeout: POST_LOGIN_TIMEOUT_MS })

  const finalUrl = page.url()
  if (!finalUrl.includes('/wager/')) {
    throw new Error(
      `Login failed or redirect to unexpected URL: ${finalUrl}` +
      ' -- ensure credentials are correct and any CAPTCHA was solved.'
    )
  }

  console.log(`[setup-auth-7stacks] Login confirmed at: ${finalUrl}`)

  // Save the session to .auth/7stacks-session.json
  await mkdir(path.dirname(SESSION_PATH), { recursive: true })
  await context.storageState({ path: SESSION_PATH })

  console.log(`[setup-auth-7stacks] Session saved to: ${SESSION_PATH}`)
  console.log('[setup-auth-7stacks] Done. The daemon DgsPphAdapter will reuse this session.')
  console.log('[setup-auth-7stacks] Re-run this script when scrape_health shows session_expired.')
} finally {
  await browser.close()
}
