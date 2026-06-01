/**
 * Book adapter registry — single point of truth for which adapters are active.
 *
 * Phase 8: OddsApiAdapter — enabled when ODDS_API_KEY is present.
 * Phase 10: KalshiAdapter — always enabled (Kalshi public REST, no auth, BOOK-04).
 * Phase 11: sevenStacksAdapter (DgsPphAdapter, enabled in daemon when SEVENSTACKS_* creds set),
 *           betVegas23Adapter (DgsPphAdapter, disabled until BETVEGAS23_* creds exist).
 * Phase 12-01: BovadaAdapter — disabled until BOVADA_* creds exist (no account funded yet, BOOK-07).
 * Phase 12-02: BetUSAdapter — disabled until BETUS_* creds exist (no account funded yet, BOOK-07).
 *
 * ScraperAdapter (Phase 7 stub, name='7stacks') has been removed from ALL_ADAPTERS.
 * adapterFor('7stacks') now resolves to the real sevenStacksAdapter (DgsPphAdapter).
 *
 * enabledAdapters() on Vercel: returns only adapters whose isEnabled() is true in
 * serverless context — DGS instances, BovadaAdapter, and BetUSAdapter are all excluded
 * (process.env.VERCEL guard). Serverless behavior is unchanged.
 */

import { OddsApiAdapter } from './odds-api-adapter.js'
import { KalshiAdapter } from './kalshi-adapter.js'
import { sevenStacksAdapter, betVegas23Adapter } from './dgs-pph-adapter.js'
import { BovadaAdapter } from './bovada-adapter.js'
import { BetUSAdapter } from './betus-adapter.js'
import type { BookAdapter } from './types.js'

const ALL_ADAPTERS: BookAdapter[] = [
  new OddsApiAdapter(),
  new KalshiAdapter(),  // Phase 10: Kalshi public REST — always enabled (no key required, BOOK-04)
  sevenStacksAdapter,   // Phase 11: 7stacks.bet DGS-PPH (enabled in daemon when SEVENSTACKS_* set)
  betVegas23Adapter,    // Phase 11: betvegas23.com DGS-PPH (disabled until BETVEGAS23_* set)
  new BovadaAdapter(),  // Phase 12-01: Bovada bespoke React SPA (disabled until BOVADA_* creds set, BOOK-07)
  new BetUSAdapter(),   // Phase 12-02: BetUS bespoke platform (disabled until BETUS_* creds set, BOOK-07)
]

/** Returns only adapters whose isEnabled() returns true. */
export function enabledAdapters(): BookAdapter[] {
  return ALL_ADAPTERS.filter((a) => a.isEnabled())
}

/** Returns the adapter registered under the given name, or undefined. */
export function adapterFor(name: string): BookAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.name === name)
}
