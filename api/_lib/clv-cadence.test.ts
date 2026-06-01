import { describe, it, expect } from 'vitest'
import { tierFor, cadenceMs, isDue } from './clv-cadence.js'

const MIN = 60_000, HOUR = 3_600_000
describe('tierFor', () => {
  it('props → prop, golf → futures, else standard', () => {
    expect(tierFor('NBA', true)).toBe('prop')
    expect(tierFor('Golf', false)).toBe('futures')
    expect(tierFor('NBA', false)).toBe('standard')
  })
})
describe('cadenceMs', () => {
  it('standard: closed >24h, 10m in 3–24h, 5m ≤3h', () => {
    expect(cadenceMs('standard', 25 * HOUR)).toBeNull()
    expect(cadenceMs('standard', 12 * HOUR)).toBe(10 * MIN)
    expect(cadenceMs('standard', 5 * HOUR)).toBe(10 * MIN)
    expect(cadenceMs('standard', 2 * HOUR)).toBe(5 * MIN)
  })
  it('prop: off >8h, 10m in 3–8h, 5m ≤3h', () => {
    expect(cadenceMs('prop', 10 * HOUR)).toBeNull()
    expect(cadenceMs('prop', 5 * HOUR)).toBe(10 * MIN)
    expect(cadenceMs('prop', 2 * HOUR)).toBe(5 * MIN)
  })
  it('futures: 12h when >24h, 1.5h when ≤24h', () => {
    expect(cadenceMs('futures', 48 * HOUR)).toBe(12 * HOUR)
    expect(cadenceMs('futures', 10 * HOUR)).toBe(90 * MIN)
  })
  it('started → null', () => expect(cadenceMs('standard', -1)).toBeNull())
})
describe('isDue', () => {
  it('never-fetched + in-window → due; within interval → not due', () => {
    expect(isDue('standard', 2 * HOUR, null, 1_000_000)).toBe(true)
    expect(isDue('standard', 2 * HOUR, 1_000_000 - 2 * MIN, 1_000_000)).toBe(false)
    expect(isDue('standard', 2 * HOUR, 1_000_000 - 6 * MIN, 1_000_000)).toBe(true)
  })
})
