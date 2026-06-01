import { describe, it, expect } from 'vitest'
import { clampEndDate, visibleRangeFor, type PanBounds } from './use-chart-pan'

const DAY = 24 * 60 * 60 * 1000

function bounds(
  earliest: number,
  latest: number,
  windowDays: PanBounds['windowDays'],
): PanBounds {
  return { earliest, latest, windowDays }
}

describe('clampEndDate', () => {
  it('returns latest when window is null (All)', () => {
    const b = bounds(0, 1000, null)
    expect(clampEndDate(500, b)).toBe(1000)
  })

  it('clamps to right bound (latest) when candidate is past it', () => {
    const earliest = 0
    const latest = 100 * DAY
    const b = bounds(earliest, latest, 30)
    expect(clampEndDate(latest + 10 * DAY, b)).toBe(latest)
  })

  it('clamps to left bound (earliest + windowDays) when candidate is too far left', () => {
    const earliest = 0
    const latest = 100 * DAY
    const b = bounds(earliest, latest, 30)
    expect(clampEndDate(0, b)).toBe(earliest + 30 * DAY)
  })

  it('allows mid-range pan when in bounds', () => {
    const earliest = 0
    const latest = 100 * DAY
    const b = bounds(earliest, latest, 30)
    expect(clampEndDate(50 * DAY, b)).toBe(50 * DAY)
  })

  it('returns right bound when window is wider than data span', () => {
    const earliest = 0
    const latest = 5 * DAY
    const b = bounds(earliest, latest, 30)
    expect(clampEndDate(2 * DAY, b)).toBe(latest)
  })
})

describe('visibleRangeFor', () => {
  it('returns the full data range when window is null (All)', () => {
    const b = bounds(100, 500, null)
    expect(visibleRangeFor(999, b)).toEqual({ start: 100, end: 500 })
  })

  it('returns a windowDays-wide range ending at endDateMs', () => {
    const b = bounds(0, 100 * DAY, 7)
    const r = visibleRangeFor(50 * DAY, b)
    expect(r.end).toBe(50 * DAY)
    expect(r.start).toBe(50 * DAY - 7 * DAY)
  })
})

describe('end-to-end clamp + range scenarios', () => {
  it('Fixture A: bets span 10 days, window 7 → only 3 days of leftward pan available', () => {
    const earliest = 0
    const latest = 10 * DAY
    const b = bounds(earliest, latest, 7)
    // Initial = latest
    expect(visibleRangeFor(clampEndDate(latest, b), b)).toEqual({
      start: latest - 7 * DAY,
      end: latest,
    })
    // Drag fully left
    expect(clampEndDate(earliest, b)).toBe(earliest + 7 * DAY)
    // The visible range at the leftmost pan
    expect(visibleRangeFor(clampEndDate(earliest, b), b)).toEqual({
      start: earliest,
      end: earliest + 7 * DAY,
    })
  })

  it('Fixture B: bets span 100 days, window 30 → max leftward pan ends at earliest+30 days', () => {
    const earliest = 0
    const latest = 100 * DAY
    const b = bounds(earliest, latest, 30)
    expect(clampEndDate(-999 * DAY, b)).toBe(30 * DAY)
  })

  it('Fixture C: empty data → disabled-equivalent (window wider than 0-day span)', () => {
    // Empty `allDates` case would yield earliest === latest, so the
    // "window wider than data" branch returns rightBound.
    const b = bounds(0, 0, 7)
    expect(clampEndDate(99, b)).toBe(0)
  })
})
