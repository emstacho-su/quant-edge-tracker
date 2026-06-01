import { describe, it, expect, afterEach } from 'vitest'
import { enabledAdapters, adapterFor } from './registry.js'
import { OddsApiAdapter } from './odds-api-adapter.js'
import { KalshiAdapter } from './kalshi-adapter.js'
import { DgsPphAdapter } from './dgs-pph-adapter.js'
import { BovadaAdapter } from './bovada-adapter.js'
import { BetUSAdapter } from './betus-adapter.js'
import type { BookAdapter } from './types.js'

describe('enabledAdapters', () => {
  afterEach(() => {
    delete process.env.ODDS_API_KEY
    delete process.env.VERCEL
    delete process.env.SEVENSTACKS_USERNAME
    delete process.env.SEVENSTACKS_PASSWORD
    delete process.env.BOVADA_USERNAME
    delete process.env.BOVADA_PASSWORD
    delete process.env.BETUS_USERNAME
    delete process.env.BETUS_PASSWORD
  })

  it('returns [KalshiAdapter] when ODDS_API_KEY absent and no DGS creds (Phase 10: Kalshi always enabled)', () => {
    delete process.env.ODDS_API_KEY
    // DGS adapters also disabled (no creds)
    // KalshiAdapter.isEnabled() is always true (public API, no key needed — BOOK-04, D-02)
    const enabled = enabledAdapters()
    expect(enabled).toHaveLength(1)
    expect(enabled[0]).toBeInstanceOf(KalshiAdapter)
  })

  it('returns [OddsApiAdapter, KalshiAdapter] when ODDS_API_KEY is set but DGS creds absent (BOOK-03 + BOOK-04)', () => {
    process.env.ODDS_API_KEY = 'test-key'
    const enabled = enabledAdapters()
    expect(enabled).toHaveLength(2)
    expect(enabled[0]).toBeInstanceOf(OddsApiAdapter)
    expect(enabled[1]).toBeInstanceOf(KalshiAdapter)
  })

  it('excludes both DGS instances from enabledAdapters() when process.env.VERCEL is set (T-11-20)', () => {
    process.env.VERCEL = '1'
    process.env.SEVENSTACKS_USERNAME = 'user'
    process.env.SEVENSTACKS_PASSWORD = 'pass'
    // Even with creds present, VERCEL guard must exclude both DGS instances
    const enabled = enabledAdapters()
    const dgsInstances = enabled.filter((a) => a instanceof DgsPphAdapter)
    expect(dgsInstances).toHaveLength(0)
  })

  it('excludes BovadaAdapter from enabledAdapters() when process.env.VERCEL is set (T-12-01)', () => {
    process.env.VERCEL = '1'
    process.env.BOVADA_USERNAME = 'user'
    process.env.BOVADA_PASSWORD = 'pass'
    // Even with creds present, VERCEL guard must exclude BovadaAdapter
    const enabled = enabledAdapters()
    const bovadaInstances = enabled.filter((a) => a instanceof BovadaAdapter)
    expect(bovadaInstances).toHaveLength(0)
  })

  it('excludes BovadaAdapter from enabledAdapters() when BOVADA_* creds absent (disabled by default, D-03)', () => {
    delete process.env.VERCEL
    delete process.env.BOVADA_USERNAME
    delete process.env.BOVADA_PASSWORD
    // No creds → BovadaAdapter.isEnabled() returns false → excluded
    const enabled = enabledAdapters()
    const bovadaInstances = enabled.filter((a) => a instanceof BovadaAdapter)
    expect(bovadaInstances).toHaveLength(0)
  })

  it('excludes BetUSAdapter from enabledAdapters() when process.env.VERCEL is set (T-12-06)', () => {
    process.env.VERCEL = '1'
    process.env.BETUS_USERNAME = 'user'
    process.env.BETUS_PASSWORD = 'pass'
    // Even with creds present, VERCEL guard must exclude BetUSAdapter
    const enabled = enabledAdapters()
    const betusInstances = enabled.filter((a) => a instanceof BetUSAdapter)
    expect(betusInstances).toHaveLength(0)
  })

  it('excludes BetUSAdapter from enabledAdapters() when BETUS_* creds absent (disabled by default, D-03)', () => {
    delete process.env.VERCEL
    delete process.env.BETUS_USERNAME
    delete process.env.BETUS_PASSWORD
    // No creds → BetUSAdapter.isEnabled() returns false → excluded
    const enabled = enabledAdapters()
    const betusInstances = enabled.filter((a) => a instanceof BetUSAdapter)
    expect(betusInstances).toHaveLength(0)
  })
})

describe('adapterFor', () => {
  it('returns OddsApiAdapter for "odds_api" (Phase 8 registration)', () => {
    const adapter = adapterFor('odds_api')
    expect(adapter).toBeInstanceOf(OddsApiAdapter)
  })

  it('returns KalshiAdapter for "kalshi" (Phase 10 registration, BOOK-04)', () => {
    const adapter = adapterFor('kalshi')
    expect(adapter).toBeInstanceOf(KalshiAdapter)
  })

  it('returns the real DgsPphAdapter (sevenStacksAdapter) for "7stacks" (11-03 correction)', () => {
    const adapter = adapterFor('7stacks')
    expect(adapter).toBeInstanceOf(DgsPphAdapter)
  })

  it('returns the DgsPphAdapter (betVegas23Adapter) for "betvegas23" (BOOK-05, D-06)', () => {
    const adapter = adapterFor('betvegas23')
    expect(adapter).toBeInstanceOf(DgsPphAdapter)
  })

  it('returns BovadaAdapter for "bovada" (Phase 12-01 registration, BOOK-07)', () => {
    const adapter = adapterFor('bovada')
    expect(adapter).toBeInstanceOf(BovadaAdapter)
  })

  it('returns BetUSAdapter for "betus" (Phase 12-02 registration, BOOK-07)', () => {
    const adapter = adapterFor('betus')
    expect(adapter).toBeInstanceOf(BetUSAdapter)
  })

  it('returns undefined for unknown book name', () => {
    expect(adapterFor('unknown-book')).toBeUndefined()
  })
})

describe('BookAdapter interface: read-only enforcement (BOOK-06, D-05)', () => {
  it('sevenStacksAdapter (DgsPphAdapter) has no order-placement surface', () => {
    const adapter: BookAdapter = adapterFor('7stacks')!
    expect(adapter).toBeDefined()
    const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet', 'confirmBet', 'submitOrder']
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(allNames, `forbidden method "${k}" must not exist on sevenStacksAdapter`).not.toContain(k)
    })
  })

  it('betVegas23Adapter (DgsPphAdapter) has no order-placement surface', () => {
    const adapter: BookAdapter = adapterFor('betvegas23')!
    expect(adapter).toBeDefined()
    const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet', 'confirmBet', 'submitOrder']
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(allNames, `forbidden method "${k}" must not exist on betVegas23Adapter`).not.toContain(k)
    })
  })

  it('betVegas23Adapter is disabled when no BETVEGAS23_* creds exist', () => {
    delete process.env.BETVEGAS23_USERNAME
    delete process.env.BETVEGAS23_PASSWORD
    const adapter = adapterFor('betvegas23')!
    expect(adapter.isEnabled()).toBe(false)
  })

  it('KalshiAdapter (Phase 10) has no order-placement surface (BOOK-06)', () => {
    const adapter: BookAdapter = adapterFor('kalshi')!
    expect(adapter).toBeDefined()
    const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet', 'confirmBet', 'submitOrder']
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(allNames, `forbidden method "${k}" must not exist on KalshiAdapter`).not.toContain(k)
    })
  })

  it('KalshiAdapter.isEnabled() always returns true (BOOK-04, D-02)', () => {
    const adapter = adapterFor('kalshi')!
    expect(adapter.isEnabled()).toBe(true)
  })

  it('BovadaAdapter has no order-placement surface (BOOK-07, D-05)', () => {
    const adapter: BookAdapter = adapterFor('bovada')!
    expect(adapter).toBeDefined()
    const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet', 'confirmBet', 'submitOrder']
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(allNames, `forbidden method "${k}" must not exist on BovadaAdapter`).not.toContain(k)
    })
  })

  it('BovadaAdapter.isEnabled() returns false when no BOVADA_* creds exist (disabled by default, D-03)', () => {
    delete process.env.BOVADA_USERNAME
    delete process.env.BOVADA_PASSWORD
    const adapter = adapterFor('bovada')!
    expect(adapter.isEnabled()).toBe(false)
  })

  it('BetUSAdapter has no order-placement surface (BOOK-07, D-05)', () => {
    const adapter: BookAdapter = adapterFor('betus')!
    expect(adapter).toBeDefined()
    const forbidden = ['placeOrder', 'createOrder', 'cancelOrder', 'modifyBet', 'placeBet', 'confirmBet', 'submitOrder']
    let proto: object | null = adapter
    const allNames = new Set<string>()
    while (proto !== null && proto !== Object.prototype) {
      Object.getOwnPropertyNames(proto).forEach((k) => allNames.add(k))
      proto = Object.getPrototypeOf(proto)
    }
    forbidden.forEach((k) => {
      expect(allNames, `forbidden method "${k}" must not exist on BetUSAdapter`).not.toContain(k)
    })
  })

  it('BetUSAdapter.isEnabled() returns false when no BETUS_* creds exist (disabled by default, D-03)', () => {
    delete process.env.BETUS_USERNAME
    delete process.env.BETUS_PASSWORD
    const adapter = adapterFor('betus')!
    expect(adapter.isEnabled()).toBe(false)
  })
})
