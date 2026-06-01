export interface Bet {
  id: string
  sport: string
  bet_type: 'single' | 'parlay'
  stake: number
  to_win: number
  odds_american: number | null
  description: string
  status: 'pending' | 'won' | 'lost' | 'push' | 'void'
  is_freeplay: boolean
  placed_at: string
  settled_at: string | null
  profit_loss: number | null
  notes: string | null
  live_game_id: string | null
  live_game_sport: string | null
  live_game_locked_at: string | null
  auto_settle_state?: 'settled' | 'skipped' | 'manual' | null
  settle_skip_reason?: string | null
  parlay_legs?: ParlayLeg[]
  // CLV / line-movement (populated by api/cron/line-movement)
  clv_market?: string | null
  clv_selection?: string | null
  clv_line?: number | null
  clv_period?: string | null
  odds_event_id?: string | null
  event_commence_time?: string | null
  entry_fair_prob?: number | null
  closing_odds_american?: number | null
  closing_fair_prob?: number | null
  clv_pct?: number | null
  clv_prob_points?: number | null
  beat_close?: boolean | null
  clv_status?: 'unparsed' | 'unsupported' | 'pending' | 'tracking' | 'locked' | 'no_market' | null
  clv_updated_at?: string | null
  // line-shop (populated when bet added via /line-shop; null for legacy bets)
  market_id?: string | null
  line_shop_used?: boolean | null
  entry_book?: string | null
  no_vig_at_entry?: number | null
  // Positive Line Movement (populated by api/cron/line-movement alongside CLV)
  plm_best_american?: number | null
  plm_best_book?: string | null
  plm_pct?: number | null
  plm_prob_points?: number | null
  plm_positive?: boolean | null
  // Entity resolution (D-12 / D-16 / D-17) — mirrors migration columns
  entity_resolution_status?: 'unresolved' | 'resolved' | 'pending' | 'low_confidence' | 'agent_derived' | 'failed' | null
  entity_espn_id?: string | null
  entity_type?: 'team' | 'player' | null
  entity_confidence?: number | null
  // Grading pipeline state (18-01 schema). null = deterministic settle (silent).
  // 'needs-agent' = queued for daemon grading. 'agent-derived' = daemon settled.
  grading_state?: 'needs-agent' | 'agent-derived' | null
  grading_spec?: Record<string, unknown> | null
}

export interface ParlayLeg {
  id: string
  bet_id: string
  description: string
  odds_american: number | null
  sport: string | null
  leg_status: 'pending' | 'won' | 'lost' | 'push' | 'void'
  clv_market?: string | null
  clv_selection?: string | null
  clv_line?: number | null
}

/** A leg authored in the straight→parlay conversion UI (pre-insert shape). */
export interface LegDraft {
  description: string
  sport: string | null
  odds_american: number | null
  clv_market: string | null
  clv_selection: string | null
  clv_line: number | null
}

export type BankrollEventType =
  | 'starting_balance'
  | 'bet_settled'
  | 'manual_adjustment'
  | 'deposit'
  | 'withdrawal'
  | 'promo'

export type BankrollType = 'cash' | 'freeplay'

export interface BankrollEvent {
  id: string
  event_type: BankrollEventType
  bankroll_type: BankrollType
  amount: number
  balance_after: number
  bet_id: string | null
  occurred_at: string
  note: string | null
  /**
   * For `withdrawal` events: 'vault' = stored in checking/Venmo (reload-ready —
   * counted in the Account Info Vault stat); free text = other destination
   * (paying out a friend, fees, etc.). NULL for non-withdrawal events. Optional
   * on the type so existing test fixtures (which predate this column) compile;
   * at runtime Supabase always returns null for events without a destination.
   */
  withdraw_destination?: string | null
}

export interface Setting {
  key: string
  value: string
}

export interface ParsedBet {
  stake: number
  to_win: number
  bet_type: 'single' | 'parlay'
  description: string
  odds_american: number | null
  sport: string
  legs: ParsedLeg[]
  is_freeplay: boolean
  // line-shop fields (populated when bet added via /line-shop; undefined for paste-import)
  market_id?: string | null
  line_shop_used?: boolean | null
  entry_book?: string | null
  no_vig_at_entry?: number | null
}

export interface ParsedLeg {
  description: string
  odds_american: number | null
  sport: string
}
