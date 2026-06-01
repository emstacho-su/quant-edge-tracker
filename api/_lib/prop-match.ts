import { matchScore } from './match.js'

export interface PropOutcome { name: string; price: number; point?: number; description?: string }

/** From a per-event prop market's outcomes, find the bettor's side (player +
 *  Over/Under + line) plus its sibling (same player+line, other side), for no-vig. */
export function findPropOutcome<T extends PropOutcome>(
  outcomes: T[],
  player: string,
  direction: 'over' | 'under',
  line: number,
): { you: T; others: T[] } | null {
  const want = direction === 'over' ? 'over' : 'under'
  const playerOutcomes = outcomes.filter(
    (o) => o.point === line && matchScore(o.description ?? '', player) >= 1,
  )
  const you = playerOutcomes.find((o) => o.name.toLowerCase() === want)
  if (!you) return null
  const others = playerOutcomes.filter((o) => o !== you)
  if (others.length === 0) return null
  return { you, others }
}
