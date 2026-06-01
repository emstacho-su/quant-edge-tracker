/**
 * Pure leg-span selection parser. Turns a single highlighted span (e.g.
 * "COL Avalanche -1½") into a structured market/selection/line. Mirrors the
 * ML/spread/total logic of `api/_lib/parse-bet.ts`; Wave C reconciles the
 * server settle engine to share this module.
 */
export type SelectionMarket = 'moneyline' | 'spread' | 'total' | 'team_total'

export interface ParsedSelection {
  market: SelectionMarket | null
  selection: string | null // team for ml/spread; 'over' | 'under' for totals
  line: number | null
}

const NONE: ParsedSelection = { market: null, selection: null, line: null }

export function parseSelection(raw: string): ParsedSelection {
  if (!raw) return { ...NONE }
  const d = raw.replace(/½/g, '.5').trim()
  // drop a trailing matchup hint like "(CIN @ PHI)" / "(A vs B)"
  const c = d.replace(/\([^)]*[@vs-][^)]*\)/i, '').trim()

  // moneyline: "<team> ML"
  let m = c.match(/^(.+?)\s+ML$/i)
  if (m) return { market: 'moneyline', selection: m[1].trim(), line: null }

  // total: trailing "o9.5" / "u205"
  m = c.match(/(?:^|\s)([ou])\s?(\d+(?:\.\d+)?)\s*$/i)
  if (m) {
    return { market: 'total', selection: m[1].toLowerCase() === 'o' ? 'over' : 'under', line: parseFloat(m[2]) }
  }

  // spread / run line: "<team> -1.5" / "<team> +1.5" / "<team> -.5"
  m = c.match(/^(.+?)\s+([+-]\.?\d+(?:\.\d+)?)\s*$/)
  if (m) return { market: 'spread', selection: m[1].trim(), line: parseFloat(m[2]) }

  return { ...NONE }
}
