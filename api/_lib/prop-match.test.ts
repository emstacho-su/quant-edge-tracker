import { describe, it, expect } from 'vitest'
import { findPropOutcome } from './prop-match.js'

const oc = [
  { name: 'Over', description: 'Dennis Schroder', price: -128, point: 2.5 },
  { name: 'Under', description: 'Dennis Schroder', price: -104, point: 2.5 },
  { name: 'Over', description: 'Jalen Brunson', price: -115, point: 24.5 },
  { name: 'Under', description: 'Jalen Brunson', price: -105, point: 24.5 },
]
describe('findPropOutcome', () => {
  it('matches player + direction + line, returns the pair', () => {
    const r = findPropOutcome(oc, 'Jalen Brunson', 'over', 24.5)
    expect(r?.you.price).toBe(-115)
    expect(r?.others.map((o) => o.price)).toEqual([-105])
  })
  it('matches the under side too', () => {
    const r = findPropOutcome(oc, 'Dennis Schroder', 'under', 2.5)
    expect(r?.you.price).toBe(-104)
    expect(r?.others.map((o) => o.price)).toEqual([-128])
  })
  it('null when line absent', () => {
    expect(findPropOutcome(oc, 'Jalen Brunson', 'over', 99.5)).toBeNull()
  })
  it('null when player absent', () => {
    expect(findPropOutcome(oc, 'Nobody Here', 'over', 24.5)).toBeNull()
  })
})
