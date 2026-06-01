/**
 * Parse an offshore-book bet `description` into a structured market for CLV.
 * Full-game **moneyline**, **run line / spread**, **game totals**, and **team
 * totals** are supported. Game markets use the Odds API bulk endpoint
 * (`h2h`/`spreads`/`totals`); team totals use the per-event `team_totals` market.
 * Props, parlays/SGPs and period (F5/alt) markets parse but are unsupported.
 */

export type ClvMarket = 'moneyline' | 'spread' | 'total' | 'team_total' | 'outright'

export interface ParsedMarket {
  market: ClvMarket | null
  selection: string | null // team string for ML/spread; 'over'|'under' for totals
  line: number | null
  period: string // 'full' | '1st5' | '1P' | '1Q' | ...
  supported: boolean
  team?: string | null // the team for a team_total (the rest of the markets leave this undefined)
}

const NONE: ParsedMarket = {
  market: null, selection: null, line: null, period: 'full', supported: false,
}

const EXOTIC = [' & ', ' + ', 'result:', 'to win:', 'handicap', 'method', ' vs ']
const PROP_RE = /\([A-Z]{2,4}\)\s+(over|under)/i

export function parseBet(descriptionRaw: string, isProp: boolean): ParsedMarket {
  if (!descriptionRaw) return { ...NONE }
  let d = descriptionRaw.replace(/½/g, '.5').trim()
  const low = d.toLowerCase()

  if (isProp || PROP_RE.test(d)) return { ...NONE }
  // soccer 3-way Draw: "Draw (TeamA vs TeamB) ML" / "Draw ML" — must precede the
  // EXOTIC guard, which would otherwise reject the parenthesized " vs ".
  if (/^draw\b/i.test(d) && /\bml\b/i.test(d) && !/\bno[\s-]?bet\b/i.test(d)) {
    return { market: 'moneyline', selection: 'Draw', line: null, period: 'full', supported: true }
  }
  if (EXOTIC.some((x) => low.includes(x))) return { ...NONE }
  if ((low.match(/\bml\b/g)?.length ?? 0) > 1) return { ...NONE } // multi-selection

  // period qualifier, e.g. (1st5) (1P) (1Q)
  let period = 'full'
  const pm = d.match(/\((1st\s?5|1st5|f5|1p|2p|3p|1q|2q|3q|4q|1h|2h)\)/i)
  if (pm) {
    const p = pm[1].toLowerCase().replace(/\s/g, '')
    period = p === '1st5' || p === 'f5' ? '1st5' : p.toUpperCase()
    d = d.replace(pm[0], '').trim()
  }

  // drop a trailing matchup hint like "(CIN @ PHI)" / "(A vs B)"
  const dClean = d.replace(/\([^)]*[@vs-][^)]*\)/i, '').trim()

  // golf / futures outright: "To Win Outright <selection>"
  const ou = dClean.match(/^to win outright\s+(.+)$/i)
  if (ou) {
    return { market: 'outright', selection: ou[1].trim(), line: null, period, supported: true }
  }

  // moneyline: "<team> ML"
  let m = dClean.match(/^(.+?)\s+ML$/i)
  if (m) {
    return { market: 'moneyline', selection: m[1].trim(), line: null, period, supported: period === 'full' }
  }

  // team total: "<team> Team Total o/u N" | "<team> team total <stat>: Over/Under N" | "<team> TT o/u N"
  const tt =
    dClean.match(/^(.+?)\s+team total[^a-z0-9]*([ou])\s?(\d+(?:\.\d+)?)/i) ||
    dClean.match(/^(.+?)\s+team total[^:]*:\s*(over|under)\s*\(?(\d+(?:\.\d+)?)/i) ||
    dClean.match(/^(.+?)\s+TT\s+([ou])\s?(\d+(?:\.\d+)?)/i)
  if (tt) {
    const dir = tt[2].toLowerCase().startsWith('o') ? 'over' : 'under'
    return { market: 'team_total', selection: dir, team: tt[1].trim(), line: parseFloat(tt[3]), period, supported: period === 'full' }
  }

  // total: trailing "o8.5" / "u205"
  m = dClean.match(/(?:^|\s)([ou])\s?(\d+(?:\.\d+)?)\s*$/i)
  if (m) {
    const dir = m[1].toLowerCase() === 'o' ? 'over' : 'under'
    return { market: 'total', selection: dir, line: parseFloat(m[2]), period, supported: period === 'full' }
  }

  // spread / run line: "<team> -1.5" / "<team> +1.5" / "<team> -.5"
  m = dClean.match(/^(.+?)\s+([+-]\.?\d+(?:\.\d+)?)\s*$/)
  if (m) {
    const line = parseFloat(m[2])
    // any full-game spread / run line is supported; period (F5/alt) markets → phase 2
    const supported = period === 'full'
    void line
    return { market: 'spread', selection: m[1].trim(), line, period, supported }
  }

  return { ...NONE }
}
