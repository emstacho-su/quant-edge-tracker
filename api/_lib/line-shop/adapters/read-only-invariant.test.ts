/**
 * read-only-invariant.test.ts
 *
 * Structural tests for the shared read-only enforcement primitives AND the
 * cross-adapter read-only enforcement for both Phase 11 DGS-PPH instances.
 *
 * These tests serve as a CI gate: if assertAllowlisted or assertNoOrderSurface
 * regress, OR if a forbidden method is added to either DGS adapter, the build fails.
 *
 * BOOK-05, BOOK-06, D-05, T-11-05, T-11-17 (11-03 cross-adapter gate)
 */

import { describe, it, expect } from 'vitest'
import {
  FORBIDDEN_ORDER_METHODS,
  assertAllowlisted,
  assertNoOrderSurface,
} from './read-only-invariant.js'
import { sevenStacksAdapter, betVegas23Adapter } from './dgs-pph-adapter.js'

// ─── FORBIDDEN_ORDER_METHODS ──────────────────────────────────────────────────

describe('FORBIDDEN_ORDER_METHODS', () => {
  it('is a non-empty readonly array', () => {
    expect(FORBIDDEN_ORDER_METHODS.length).toBeGreaterThan(0)
  })

  it('includes all expected order-placement surface names (BOOK-06)', () => {
    const expected = [
      'placeBet',
      'confirmBet',
      'submitOrder',
      'placeOrder',
      'createOrder',
      'cancelOrder',
      'modifyBet',
    ]
    for (const name of expected) {
      expect(FORBIDDEN_ORDER_METHODS).toContain(name)
    }
  })
})

// ─── assertAllowlisted ────────────────────────────────────────────────────────

describe('assertAllowlisted', () => {
  const allowlist = [
    'https://7stacks.bet/wager/odds.aspx',
    'https://7stacks.bet/wager/lines.aspx',
  ]

  it('does not throw when url starts with an allowlisted prefix', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/odds.aspx?sport=mlb', allowlist)
    ).not.toThrow()
  })

  it('does not throw for an exact allowlisted prefix match', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/lines.aspx', allowlist)
    ).not.toThrow()
  })

  it('throws READ-ONLY VIOLATION for a URL not on the allowlist', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/betslip.aspx', allowlist)
    ).toThrow('READ-ONLY VIOLATION')
  })

  it('throws when navigating to an entirely different domain', () => {
    expect(() =>
      assertAllowlisted('https://evil.example.com/place-bet', allowlist)
    ).toThrow('READ-ONLY VIOLATION')
  })

  it('throws when navigating to a bet-placement path even on the correct domain', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/placebet.aspx', allowlist)
    ).toThrow('READ-ONLY VIOLATION: navigation to https://7stacks.bet/wager/placebet.aspx is not on the odds allowlist')
  })

  it('throws when the allowlist is empty (no permitted URLs)', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/odds.aspx', [])
    ).toThrow('READ-ONLY VIOLATION')
  })
})

// ─── assertNoOrderSurface ─────────────────────────────────────────────────────

describe('assertNoOrderSurface', () => {
  it('does not throw for a plain object with no forbidden methods', () => {
    const safeAdapter = {
      name: '7stacks',
      isEnabled: () => false,
      fetchMarket: async () => null,
      fetchEvents: async () => [],
    }
    expect(() => assertNoOrderSurface(safeAdapter)).not.toThrow()
  })

  it('does not throw for an empty object', () => {
    expect(() => assertNoOrderSurface({})).not.toThrow()
  })

  it('throws READ-ONLY VIOLATION when the object has a placeBet method', () => {
    const badAdapter = {
      placeBet: () => { throw new Error('should never reach') },
    }
    expect(() => assertNoOrderSurface(badAdapter)).toThrow('READ-ONLY VIOLATION')
    expect(() => assertNoOrderSurface(badAdapter)).toThrow("forbidden method 'placeBet'")
  })

  it('throws for each forbidden method name individually', () => {
    for (const forbidden of FORBIDDEN_ORDER_METHODS) {
      const obj = { [forbidden]: () => null }
      expect(
        () => assertNoOrderSurface(obj),
        `should throw for forbidden method '${forbidden}'`
      ).toThrow('READ-ONLY VIOLATION')
    }
  })

  it('throws when a forbidden method is on the prototype (class-based adapter)', () => {
    class BadAdapter {
      placeOrder() { return null }
    }
    const instance = new BadAdapter()
    expect(() => assertNoOrderSurface(instance)).toThrow('READ-ONLY VIOLATION')
    expect(() => assertNoOrderSurface(instance)).toThrow("forbidden method 'placeOrder'")
  })

  it('does not throw when a class has only allowed methods on the prototype', () => {
    class GoodAdapter {
      isEnabled() { return false }
      async fetchMarket() { return null }
      async fetchEvents() { return [] }
    }
    const instance = new GoodAdapter()
    expect(() => assertNoOrderSurface(instance)).not.toThrow()
  })
})

// ─── Cross-adapter read-only enforcement: Phase 11 DGS-PPH instances ─────────
// (T-11-17, BOOK-05/BOOK-06, D-05 — 11-03 gate)

describe('Cross-adapter read-only enforcement: sevenStacksAdapter (DgsPphAdapter)', () => {
  it('assertNoOrderSurface passes — no forbidden order method on sevenStacksAdapter prototype', () => {
    expect(() => assertNoOrderSurface(sevenStacksAdapter)).not.toThrow()
  })

  it('sevenStacksAdapter exposes none of FORBIDDEN_ORDER_METHODS on own or inherited properties', () => {
    const names = new Set<string>()
    let proto: object | null = sevenStacksAdapter
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => names.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    for (const forbidden of FORBIDDEN_ORDER_METHODS) {
      expect(
        names.has(forbidden),
        `sevenStacksAdapter must NOT expose forbidden method '${forbidden}'`
      ).toBe(false)
    }
  })

  it('sevenStacksAdapter allowlist rejects an off-allowlist bet-slip URL (D-05)', () => {
    // The 7stacks allowlist only permits /wager/odds.aspx and /wager/lines.aspx
    expect(() =>
      assertAllowlisted('https://7stacks.bet/wager/betslip.aspx', [
        'https://7stacks.bet/wager/odds.aspx',
        'https://7stacks.bet/wager/lines.aspx',
      ])
    ).toThrow('READ-ONLY VIOLATION')
  })

  it('sevenStacksAdapter allowlist rejects an account/order path on the correct domain', () => {
    expect(() =>
      assertAllowlisted('https://7stacks.bet/account/deposit', [
        'https://7stacks.bet/wager/odds.aspx',
        'https://7stacks.bet/wager/lines.aspx',
      ])
    ).toThrow('READ-ONLY VIOLATION')
  })
})

describe('Cross-adapter read-only enforcement: betVegas23Adapter (DgsPphAdapter)', () => {
  it('assertNoOrderSurface passes — no forbidden order method on betVegas23Adapter prototype', () => {
    expect(() => assertNoOrderSurface(betVegas23Adapter)).not.toThrow()
  })

  it('betVegas23Adapter exposes none of FORBIDDEN_ORDER_METHODS on own or inherited properties', () => {
    const names = new Set<string>()
    let proto: object | null = betVegas23Adapter
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => names.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    for (const forbidden of FORBIDDEN_ORDER_METHODS) {
      expect(
        names.has(forbidden),
        `betVegas23Adapter must NOT expose forbidden method '${forbidden}'`
      ).toBe(false)
    }
  })

  it('betVegas23Adapter allowlist rejects an off-allowlist bet-placement URL (D-05)', () => {
    expect(() =>
      assertAllowlisted('https://betvegas23.com/wager/placebet.aspx', [
        'https://betvegas23.com/wager/odds.aspx',
        'https://betvegas23.com/wager/lines.aspx',
      ])
    ).toThrow('READ-ONLY VIOLATION')
  })

  it('betVegas23Adapter allowlist rejects an account management path (D-05)', () => {
    expect(() =>
      assertAllowlisted('https://betvegas23.com/account/withdraw', [
        'https://betvegas23.com/wager/odds.aspx',
        'https://betvegas23.com/wager/lines.aspx',
      ])
    ).toThrow('READ-ONLY VIOLATION')
  })
})
