import type { BankrollEvent } from '@/lib/types'

const DAY_MS = 24 * 60 * 60 * 1000

export function startOfWeek(d: Date): Date {
  const result = new Date(d)
  result.setHours(0, 0, 0, 0)
  const dow = result.getDay()
  const shift = dow === 0 ? 6 : dow - 1
  result.setTime(result.getTime() - shift * DAY_MS)
  return result
}

export function getCashBankrollAtWeekStart(
  events: readonly BankrollEvent[],
  asOf: Date = new Date(),
): number {
  const boundary = startOfWeek(asOf).getTime()
  let snapshot = 0
  for (const e of events) {
    if (e.bankroll_type !== 'cash') continue
    if (new Date(e.occurred_at).getTime() >= boundary) break
    snapshot = e.balance_after
  }
  return snapshot
}

export function computeWeeklyUnit(bankrollAtWeekStart: number): number {
  if (!Number.isFinite(bankrollAtWeekStart) || bankrollAtWeekStart <= 0) return 10
  const rounded = Math.ceil((bankrollAtWeekStart * 0.01) / 5) * 5
  return Math.max(10, rounded)
}
