/**
 * read-only-invariant.ts
 *
 * Shared read-only enforcement primitives for Phase 11 DGS-PPH credentialed
 * adapters and all future Playwright-based scrapers.
 *
 * READ-ONLY INVARIANT (BOOK-05, BOOK-06, D-05):
 * Every credentialed adapter MUST:
 *   - Navigate ONLY to URLs on its per-book odds-page allowlist (assertAllowlisted).
 *   - Expose NO order-placement method on its prototype (assertNoOrderSurface).
 *
 * This file itself contains ZERO navigation or order-placement code.
 * It is a pure utility module imported by the DGS-PPH adapter (11-02) and
 * by the cross-adapter read-only enforcement test (11-03).
 */

// ─── Forbidden order-placement method names ───────────────────────────────────

/**
 * Exhaustive list of method names that MUST NOT exist on any BookAdapter
 * implementation. If an adapter exposes any of these methods, it violates the
 * read-only invariant and could be used (accidentally or maliciously) to place
 * a wager. (D-05, BOOK-06, T-11-05)
 */
export const FORBIDDEN_ORDER_METHODS: readonly string[] = [
  'placeBet',
  'confirmBet',
  'submitOrder',
  'placeOrder',
  'createOrder',
  'cancelOrder',
  'modifyBet',
] as const

// ─── URL allowlist enforcement ────────────────────────────────────────────────

/**
 * Asserts that `url` starts with at least one of the provided `allowlist`
 * prefixes. Throws a "READ-ONLY VIOLATION" error if the URL matches none.
 *
 * The DGS-PPH adapter calls this before every Playwright navigation to
 * guarantee it only ever reaches odds pages — never a bet-slip or
 * order-confirmation URL. (D-05, Pattern 4)
 *
 * @param url      The absolute URL the adapter is about to navigate to.
 * @param allowlist Array of URL prefixes that are permitted (e.g. the
 *                  odds-page base URLs for the book). Prefix matching is used
 *                  so that a single entry covers all market sub-paths.
 * @throws {Error} "READ-ONLY VIOLATION: navigation to <url> is not on the odds allowlist"
 *                 when `url` does not start with any allowlist prefix.
 */
export function assertAllowlisted(url: string, allowlist: string[]): void {
  const permitted = allowlist.some((prefix) => url.startsWith(prefix))
  if (!permitted) {
    throw new Error(
      `READ-ONLY VIOLATION: navigation to ${url} is not on the odds allowlist`
    )
  }
}

// ─── Adapter surface enforcement ──────────────────────────────────────────────

/**
 * Asserts that `instance` (a BookAdapter or any object) exposes no method
 * whose name appears in FORBIDDEN_ORDER_METHODS. Checks both own properties
 * and the prototype chain.
 *
 * Use this in structural tests (e.g. the 11-03 cross-adapter read-only test)
 * to enforce the invariant at the type level in CI. (D-05, BOOK-06)
 *
 * @param instance Any object (typically a BookAdapter instance).
 * @throws {Error} "READ-ONLY VIOLATION: adapter exposes forbidden method '<name>'"
 *                 for the first forbidden method name found.
 */
export function assertNoOrderSurface(instance: object): void {
  // Collect all method names across own properties + prototype chain.
  const names = new Set<string>()

  let proto: object | null = instance
  while (proto !== null && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      names.add(key)
    }
    proto = Object.getPrototypeOf(proto)
  }

  for (const forbidden of FORBIDDEN_ORDER_METHODS) {
    if (names.has(forbidden)) {
      throw new Error(
        `READ-ONLY VIOLATION: adapter exposes forbidden method '${forbidden}'`
      )
    }
  }
}
