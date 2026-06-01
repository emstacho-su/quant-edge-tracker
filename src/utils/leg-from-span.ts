import type { LegDraft } from '@/lib/types'
import { parseSelection } from './parse-selection'
import { detectSport } from './sport-detector'

/**
 * Build a parlay LegDraft from a highlighted span of a bet description.
 * Parses the straight-market selection and re-detects the sport from the span
 * itself (a single mixed-sport parlay has per-leg sports), falling back to the
 * parent bet's sport when the span has no detectable team.
 */
export function legFromSpan(text: string, fallbackSport: string | null): LegDraft {
  const sel = parseSelection(text)
  const detected = detectSport(text)
  const sport = detected !== 'unknown' ? detected : fallbackSport
  return {
    description: text.trim(),
    sport,
    odds_american: null,
    clv_market: sel.market,
    clv_selection: sel.selection,
    clv_line: sel.line,
  }
}
