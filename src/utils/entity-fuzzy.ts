/**
 * entity-fuzzy.ts — Fuse.js tier-2 wrapper for the three-tier entity resolver.
 *
 * IMPORTANT — Score direction:
 *   Fuse.js score: 0 = perfect match, 1 = no match (INVERTED vs intuition)
 *   Always check:  score <= FUZZY_AUTO_ACCEPT_THRESHOLD (e.g. <= 0.10)
 *   Never check:   score >= 0.90  (that would pass almost nothing)
 *
 * Sport-scoping is the CALLER'S responsibility:
 *   Pass a pre-filtered teams array to buildFuseIndex so the index only contains
 *   teams for the relevant sport. This resolves all D-03a cross-sport collisions
 *   (Cardinals MLB/NFL, Panthers NFL/NHL, Kings NBA/NHL) without needing to raise
 *   the auto-accept threshold.
 */

import Fuse, { type IFuseOptions } from 'fuse.js'
import type { TeamRow } from '../../api/_lib/espn-teams.js'

// ---------------------------------------------------------------------------
// Auto-accept threshold
// ---------------------------------------------------------------------------

// Fuse.js score: 0 = perfect match, 1 = no match (INVERTED vs intuition)
// Auto-accept when score <= FUZZY_AUTO_ACCEPT_THRESHOLD
// Never check: score >= 0.90 (that would pass almost nothing)
//
// Calibration evidence from RESEARCH.md:
//   "Cardinals" vs "St. Louis Cardinals" → score ~0.05 (accept, MLB-scoped)
//   "Cardinals" vs "Arizona Cardinals"   → score ~0.08 (accept, NFL-scoped)
//   "Panthers" vs "Florida Panthers"     → score ~0.08 (accept, NHL-scoped)
//   "Kings" vs "Sacramento Kings"        → score ~0.06 (accept, NBA-scoped)
// Threshold 0.10 allows all of the above while rejecting low-quality matches.
export const FUZZY_AUTO_ACCEPT_THRESHOLD = 0.10

// ---------------------------------------------------------------------------
// Fuse.js options (verbatim from 17-RESEARCH.md "Fuzzy Matching" section)
// ---------------------------------------------------------------------------

const FUSE_OPTIONS: IFuseOptions<TeamRow> = {
  keys: [
    { name: 'full_name', weight: 1.0 },
    { name: 'nickname', weight: 0.9 },
    { name: 'location', weight: 0.7 },
    { name: 'abbreviation', weight: 0.8 },
  ],
  threshold: 0.30,        // search ceiling — don't show results worse than 0.30
  includeScore: true,
  ignoreLocation: true,   // team names can appear anywhere in a description
  distance: 100,
  minMatchCharLength: 3,
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Build a Fuse.js search index for a team list.
 *
 * Always pass a sport-scoped (pre-filtered) array to prevent cross-sport
 * collisions — e.g. `teams.filter(t => t.sport === sport)`.
 */
export function buildFuseIndex(teams: TeamRow[]): Fuse<TeamRow> {
  return new Fuse(teams, FUSE_OPTIONS)
}

/**
 * Run a single fuzzy query against a pre-built Fuse index.
 *
 * Returns the top result with its raw Fuse score, or null when the index
 * has no results within the search ceiling (threshold 0.30).
 *
 * The caller decides whether to auto-accept:
 *   if (result && result.score <= FUZZY_AUTO_ACCEPT_THRESHOLD) { /* tier-2 accept *\/ }
 */
export function fuzzyResolve(
  query: string,
  fuse: Fuse<TeamRow>,
): { entity: TeamRow; score: number } | null {
  const results = fuse.search(query, { limit: 1 })
  if (results.length === 0 || results[0].score == null) return null
  return { entity: results[0].item, score: results[0].score }
}
