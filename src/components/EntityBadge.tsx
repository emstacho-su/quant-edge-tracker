/**
 * EntityBadge — Inline resolution-status pill for BetLog rows (D-17).
 *
 * Renders a colored badge ONLY for non-healthy resolution states:
 *   pending       → amber  "Resolving"       (awaiting agent)
 *   low_confidence → orange "Low confidence"  (fuzzy tier-2 below 90% confidence)
 *   agent_derived → blue   "Agent"            (resolved by daemon agent)
 *   failed        → red    "Failed"           (resolution permanently failed)
 *
 * Returns null for resolved / unresolved / undefined — no badge on healthy rows
 * (D-17: only surface states that need human review).
 *
 * Reuses the existing shadcn Badge primitive from src/components/ui/badge.tsx.
 */

import { Badge } from '@/components/ui/badge'
import type { Bet } from '@/lib/types'
import { cn } from '@/lib/utils'

type EntityResolutionStatus = Bet['entity_resolution_status']

interface EntityBadgeProps {
  status?: EntityResolutionStatus
  className?: string
}

const BADGE_CONFIG: Partial<
  Record<
    NonNullable<EntityResolutionStatus>,
    { label: string; className: string }
  >
> = {
  pending: {
    label: 'Resolving',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  low_confidence: {
    label: 'Low confidence',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  agent_derived: {
    label: 'Agent',
    className: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
}

/**
 * Inline entity-resolution status badge.
 *
 * Returns null for resolved / unresolved / undefined (healthy rows show no badge).
 */
export function EntityBadge({ status, className }: EntityBadgeProps) {
  if (!status) return null

  const config = BADGE_CONFIG[status]
  if (!config) return null  // resolved / unresolved → no badge

  return (
    <Badge
      variant="outline"
      className={cn('shrink-0', config.className, className)}
    >
      {config.label}
    </Badge>
  )
}
