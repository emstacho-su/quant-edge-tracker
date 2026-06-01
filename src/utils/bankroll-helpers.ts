import type { BankrollEvent, BankrollType } from '@/lib/types'

const ROUND = (n: number) => Number(n.toFixed(2))

export interface ChainDrift {
  id: string
  expected: number
  actual: number
}

/**
 * Recompute `balance_after` for every event of one bankroll_type by walking
 * the chain in chronological order. Returns events whose stored balance_after
 * drifted and the corrected value. Pure — no side effects.
 *
 * Mirrors `scripts/rebuild_bankroll_chain.mjs` for client-side reuse.
 */
export function recomputeChain(
  events: readonly BankrollEvent[],
  bankrollType: BankrollType,
): ChainDrift[] {
  const ordered = events
    .filter((e) => e.bankroll_type === bankrollType)
    .slice()
    .sort((a, b) => {
      const t = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
      if (t !== 0) return t
      return a.id.localeCompare(b.id)
    })

  let running = 0
  const drift: ChainDrift[] = []
  for (const e of ordered) {
    running = ROUND(running + Number(e.amount))
    if (Math.abs(Number(e.balance_after) - running) > 0.01) {
      drift.push({ id: e.id, expected: running, actual: Number(e.balance_after) })
    }
  }
  return drift
}

/**
 * Compute the projected current balance for a bankroll_type given the
 * full event list plus zero or one new pending event (insert/update/delete).
 * Used for safeguard checks before mutating.
 *
 * - `pendingInsert`: an event being added (id not yet known)
 * - `pendingUpdate`: an event being modified (matched by id, replaces existing)
 * - `pendingDeleteId`: an event being removed
 */
export interface ProjectionInput {
  events: readonly BankrollEvent[]
  bankrollType: BankrollType
  pendingInsert?: { amount: number; occurred_at: string }
  pendingUpdate?: { id: string; amount: number; occurred_at: string }
  pendingDeleteId?: string
}

export function projectFinalBalance(input: ProjectionInput): number {
  const { events, bankrollType, pendingInsert, pendingUpdate, pendingDeleteId } = input

  type ProjEvent = { id: string; amount: number; occurred_at: string }
  const projection: ProjEvent[] = events
    .filter((e) => e.bankroll_type === bankrollType)
    .filter((e) => e.id !== pendingDeleteId)
    .map((e) =>
      pendingUpdate && pendingUpdate.id === e.id
        ? { id: e.id, amount: pendingUpdate.amount, occurred_at: pendingUpdate.occurred_at }
        : { id: e.id, amount: Number(e.amount), occurred_at: e.occurred_at },
    )

  if (pendingInsert) {
    projection.push({
      id: '__pending__',
      amount: pendingInsert.amount,
      occurred_at: pendingInsert.occurred_at,
    })
  }

  projection.sort((a, b) => {
    const t = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    if (t !== 0) return t
    return a.id.localeCompare(b.id)
  })

  let running = 0
  for (const e of projection) running = ROUND(running + e.amount)
  return running
}

/**
 * Return the projected `balance_after` series so callers can detect any
 * intermediate dip below zero (not just the final balance).
 */
export function projectBalanceSeries(input: ProjectionInput): number[] {
  const { events, bankrollType, pendingInsert, pendingUpdate, pendingDeleteId } = input

  type ProjEvent = { id: string; amount: number; occurred_at: string }
  const projection: ProjEvent[] = events
    .filter((e) => e.bankroll_type === bankrollType)
    .filter((e) => e.id !== pendingDeleteId)
    .map((e) =>
      pendingUpdate && pendingUpdate.id === e.id
        ? { id: e.id, amount: pendingUpdate.amount, occurred_at: pendingUpdate.occurred_at }
        : { id: e.id, amount: Number(e.amount), occurred_at: e.occurred_at },
    )

  if (pendingInsert) {
    projection.push({
      id: '__pending__',
      amount: pendingInsert.amount,
      occurred_at: pendingInsert.occurred_at,
    })
  }

  projection.sort((a, b) => {
    const t = new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    if (t !== 0) return t
    return a.id.localeCompare(b.id)
  })

  const series: number[] = []
  let running = 0
  for (const e of projection) {
    running = ROUND(running + e.amount)
    series.push(running)
  }
  return series
}
