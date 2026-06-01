const NBA_PROPS: Record<string, string> = {
  points: 'player_points', rebounds: 'player_rebounds', assists: 'player_assists',
  threes: 'player_threes', pra: 'player_points_rebounds_assists',
  steals: 'player_steals', blocks: 'player_blocks',
}

const PROP_MARKETS: Record<string, Record<string, string>> = {
  NBA: NBA_PROPS,
  WNBA: NBA_PROPS,
  MLB: { strikeouts: 'pitcher_strikeouts', hits: 'batter_hits' },
}

/** Odds API per-event prop market key for a sport+statKey, or null (untracked). */
export function propMarketFor(sport: string | null, statKey: string): string | null {
  if (!sport) return null
  return PROP_MARKETS[sport]?.[statKey] ?? null
}
