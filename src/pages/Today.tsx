import { useMemo, useCallback, useState, useEffect } from 'react'
import { useBets } from '@/hooks/use-bets'
import { useLiveScores } from '@/hooks/use-live-scores'
import { useLiveGolf } from '@/hooks/use-live-golf'
import {
  matchBetToGame,
  matchParlayLegs,
  parseBetLine,
  getLiveStatus,
  predictBetOutcome,
  getSegmentScore,
  type LiveStatus,
  type PredictedSettlement,
  type BetPeriod,
} from '@/utils/team-matcher'
import { matchGolfBet, type GolfMatchResult } from '@/utils/golf-matcher'
import { useBoxscores } from '@/hooks/use-boxscores'
import { usePlayerResolver } from '@/hooks/use-player-resolver'
import {
  matchPropBet,
  findGameForTeam,
  labelForStat,
  type PropMatchResult,
} from '@/utils/prop-matcher'
import { parseProp } from '@/utils/prop-parser'
import type { Bet } from '@/lib/types'
import type { LiveGame } from '@/hooks/use-live-scores'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RefreshCw, Calendar, Circle, Flag, User, Pencil } from 'lucide-react'
import { USD } from '@/lib/demo-mode'
import { AuthActions } from '@/components/auth/AuthGate'
import { MobileBetSheet } from '@/components/MobileBetSheet'

type BetFilter = 'all' | 'cash' | 'fp'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// LiveStatus → presentational config. The 4 CoverStatus values keep their
// existing styling; the 9 new LiveStatus entries (D-04/D-05/D-11) reuse
// covering/behind/push palettes as placeholders — Phase 16 / 19-04 own the
// final tint mapping for the new pace + clinch + final bands.
const COVER_CONFIG: Record<LiveStatus, { label: string; dot: string; bg: string; glow: string }> = {
  covering:      { label: 'Covering',    dot: 'bg-green-400',  bg: 'border-l-4 border-green-500',  glow: 'rgba(74,222,128,1)' },
  behind:        { label: 'Behind',      dot: 'bg-red-400',    bg: 'border-l-4 border-red-500',    glow: 'rgba(248,113,113,1)' },
  push:          { label: 'Push',        dot: 'bg-yellow-400', bg: 'border-l-4 border-yellow-500', glow: 'rgba(250,204,21,1)' },
  pregame:       { label: 'Pregame',     dot: 'bg-zinc-500',   bg: '',                             glow: '' },
  too_early:     { label: 'Live',        dot: 'bg-zinc-400',   bg: '',                             glow: '' },
  on_pace:       { label: 'On Pace',     dot: 'bg-green-400',  bg: 'border-l-4 border-green-500',  glow: 'rgba(74,222,128,1)' },
  borderline:    { label: 'Borderline',  dot: 'bg-yellow-400', bg: 'border-l-4 border-yellow-500', glow: 'rgba(250,204,21,1)' },
  off_pace:      { label: 'Off Pace',    dot: 'bg-red-400',    bg: 'border-l-4 border-red-500',    glow: 'rgba(248,113,113,1)' },
  clinched_won:  { label: 'Clinched W',  dot: 'bg-green-400',  bg: 'border-l-4 border-green-500',  glow: 'rgba(74,222,128,1)' },
  clinched_lost: { label: 'Clinched L',  dot: 'bg-red-400',    bg: 'border-l-4 border-red-500',    glow: 'rgba(248,113,113,1)' },
  final_won:     { label: 'Won',         dot: 'bg-green-400',  bg: 'border-l-4 border-green-500',  glow: 'rgba(74,222,128,1)' },
  final_lost:    { label: 'Lost',        dot: 'bg-red-400',    bg: 'border-l-4 border-red-500',    glow: 'rgba(248,113,113,1)' },
  final_push:    { label: 'Push',        dot: 'bg-yellow-400', bg: 'border-l-4 border-yellow-500', glow: 'rgba(250,204,21,1)' },
}

const SPORT_COLORS: Record<string, string> = {
  MLB: 'text-blue-400 bg-blue-400/10',
  NBA: 'text-orange-400 bg-orange-400/10',
  WNBA: 'text-orange-300 bg-orange-300/10',
  NHL: 'text-cyan-400 bg-cyan-400/10',
  NCAAB: 'text-purple-400 bg-purple-400/10',
  NCAAF: 'text-purple-300 bg-purple-300/10',
  NFL: 'text-emerald-400 bg-emerald-400/10',
  Soccer: 'text-lime-400 bg-lime-400/10',
  Golf: 'text-yellow-400 bg-yellow-400/10',
  Tennis: 'text-pink-400 bg-pink-400/10',
  MMA: 'text-red-400 bg-red-400/10',
  Lacrosse: 'text-amber-400 bg-amber-400/10',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Period label helper
// ---------------------------------------------------------------------------

const PERIOD_LABELS: Record<BetPeriod, string> = {
  fullgame: '',
  '1h': '1H', '2h': '2H',
  '1q': '1Q', '2q': '2Q', '3q': '3Q', '4q': '4Q',
  '1p': '1P', '2p': '2P', '3p': '3P',
  f5: 'F5', f3: 'F3',
}

// ---------------------------------------------------------------------------
// Game score mini-display (reused for single bets and parlay legs)
//
// Shows the game's full score, plus a separate row with the segment score
// when the bet is for a specific period (e.g. "1P: 2-1") so the user can
// see at a glance how the bet is doing within its scope.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bases diamond graphic for MLB live situation display (D-06)
// ---------------------------------------------------------------------------

interface BasesDiamondProps {
  onFirst: boolean
  onSecond: boolean
  onThird: boolean
}

function BasesDiamond({ onFirst, onSecond, onThird }: BasesDiamondProps) {
  const base = (occupied: boolean) =>
    `size-3 rotate-45 border ${
      occupied ? 'bg-amber-400 border-amber-400' : 'bg-transparent border-zinc-500'
    }`

  const occupied = [
    onFirst && '1st',
    onSecond && '2nd',
    onThird && '3rd',
  ].filter(Boolean) as string[]
  const ariaLabel =
    occupied.length === 0
      ? 'Bases empty'
      : `Runners on ${occupied.join(' and ')}`

  return (
    <div className="relative size-8 flex items-center justify-center" aria-label={ariaLabel}>
      {/* 2B — top */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 ${base(onSecond)}`} />
      {/* 1B — right */}
      <div className={`absolute right-0 top-1/2 -translate-y-1/2 ${base(onFirst)}`} />
      {/* 3B — left */}
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 ${base(onThird)}`} />
    </div>
  )
}

interface GameScoreProps {
  game: LiveGame
  label?: string
  betPeriod?: BetPeriod
}

function GameScore({ game, label, betPeriod }: GameScoreProps) {
  const isLive = game.status === 'in'
  const isFinal = game.status === 'post'

  const period = betPeriod ?? 'fullgame'
  const showSegment = period !== 'fullgame'
  const seg = showSegment ? getSegmentScore(period, game) : null

  return (
    <div className="space-y-1">
      {label && <p className="text-[10px] font-semibold text-foreground/80 mb-0.5">{label}</p>}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{game.awayName}</span>
        <span className="tabular-nums font-bold text-base">{game.awayScore}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{game.homeName}</span>
        <span className="tabular-nums font-bold text-base">{game.homeScore}</span>
      </div>

      {seg && seg.hasData && (
        <div className="flex items-center justify-between border-t border-border/40 pt-1 text-[11px]">
          <span className="text-muted-foreground">
            {PERIOD_LABELS[period]}{seg.complete ? ' (final)' : ''}
          </span>
          <span className="tabular-nums font-medium">
            {seg.away}-{seg.home}
          </span>
        </div>
      )}

      {game.sport === 'MLB' && game.status === 'in' && game.situation && (
        <div className="border-t border-border/40 pt-1 text-[11px]">
          <span className="text-muted-foreground">{game.situation.inningDetail}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {isLive && (
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Circle className="size-1.5 fill-amber-400 text-amber-400 animate-pulse-live" />
            {game.statusDetail}
          </span>
        )}
        {isFinal && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Final</span>
        )}
        {game.status === 'pre' && (
          <span className="text-[10px] text-muted-foreground">{game.statusDetail}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scoreboard card — handles both single bets and parlays
// ---------------------------------------------------------------------------

interface ScoreboardProps {
  bet: Bet
  game: LiveGame | null
  parlayGames?: (LiveGame | null)[]
  /** Card-level status. For parlays, this is intentionally neutral
   *  ('pregame') — there is no aggregated parlay-level pace/tint roll-up
   *  (D-07). Per-leg states render next to each leg via `legStatuses`. */
  coverStatus: LiveStatus
  /** Per-leg LiveStatus for parlays only. Length matches `parlayGames`.
   *  Undefined for single-bet cards. (D-07) */
  legStatuses?: LiveStatus[]
  betPeriod: BetPeriod
  prediction: PredictedSettlement | null
  onSettle: (id: string, s: 'won' | 'lost' | 'push') => void
  settling: boolean
}

function ScoreboardCard({
  bet,
  game,
  parlayGames,
  coverStatus,
  legStatuses,
  betPeriod,
  prediction,
  onSettle,
  settling,
}: ScoreboardProps) {
  const cfg = COVER_CONFIG[coverStatus]
  const isParlay = bet.bet_type === 'parlay'

  // Show settle buttons whenever the bet's relevant scope is final. For
  // singles, that's the bet's prediction (period or full game). For parlays,
  // we still require all games to be final since we don't yet predict per-leg.
  const showSettleButtons = isParlay
    ? (parlayGames ?? []).every((g) => g?.status === 'post')
    : prediction !== null || game?.status === 'post'

  const legDescriptions = isParlay ? bet.description.split(' / ') : []

  // Auto-fill ring colors per predicted outcome.
  const autoClass = (target: 'won' | 'lost' | 'push'): string => {
    if (!prediction || prediction.outcome !== target) return ''
    return 'ring-2 ring-offset-1 ring-offset-background ring-amber-400'
  }

  const periodLabel = PERIOD_LABELS[betPeriod]

  // Build glow box-shadow that composes with the glass-card !important shadow.
  // Pace / clinch / final states reuse the green/red/yellow placeholder
  // palette from COVER_CONFIG (19-03) — Phase 16 will tune the final colors.
  const glowStyle: { boxShadow?: string } | undefined = cfg.glow
    ? {
        boxShadow:
          coverStatus === 'covering' ||
          coverStatus === 'on_pace' ||
          coverStatus === 'clinched_won' ||
          coverStatus === 'final_won'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(74,222,128,0.25)'
            : coverStatus === 'behind' ||
              coverStatus === 'off_pace' ||
              coverStatus === 'clinched_lost' ||
              coverStatus === 'final_lost'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(248,113,113,0.25)'
            : coverStatus === 'push' ||
              coverStatus === 'borderline' ||
              coverStatus === 'final_push'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(250,204,21,0.25)'
            : undefined,
      }
    : undefined

  return (
    <div className={`relative glass-card p-3 ${cfg.bg}`} data-glow={cfg.glow} style={glowStyle}>
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={`text-[10px] font-semibold uppercase tracking-wide ${SPORT_COLORS[bet.sport] ?? 'text-zinc-400 bg-zinc-400/10'}`}>
            {bet.sport}
          </Badge>
          {periodLabel && (
            <Badge variant="secondary" className="bg-sky-500/10 text-[10px] text-sky-300">
              {periodLabel}
            </Badge>
          )}
          {isParlay && (
            <Badge variant="secondary" className="bg-amber-500/10 text-[10px] text-amber-400">
              Parlay
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${cfg.dot}`} />
          <span className="text-[11px] font-medium">{cfg.label}</span>
        </div>
      </div>

      {/* Scores — single game or multiple parlay legs */}
      {isParlay && parlayGames ? (
        <div className="mb-2 space-y-3">
          {parlayGames.map((lg, i) => {
            // Build a compact pick label for each parlay leg (2-d)
            const rawDesc = legDescriptions[i] ?? `Leg ${i + 1}`
            const parsedLeg = parseBetLine(rawDesc)
            let legLabel: string
            if (parsedLeg.team) {
              if (parsedLeg.lineType === 'spread' && parsedLeg.lineValue !== null) {
                const sign = parsedLeg.lineValue > 0 ? '+' : ''
                legLabel = `${parsedLeg.team} ${sign}${parsedLeg.lineValue}`
              } else if (parsedLeg.lineType === 'moneyline') {
                legLabel = `${parsedLeg.team} ML`
              } else if ((parsedLeg.lineType === 'over' || parsedLeg.lineType === 'under') && parsedLeg.lineValue !== null) {
                legLabel = `${parsedLeg.lineType === 'over' ? 'O' : 'U'} ${parsedLeg.lineValue}`
              } else {
                legLabel = parsedLeg.team
              }
            } else {
              legLabel = rawDesc.slice(0, 40)
            }
            // Per-leg LiveStatus (D-07): no aggregated parlay-level
            // pace/tint roll-up; each leg shows its own dot + label.
            const legStatus: LiveStatus = legStatuses?.[i] ?? 'pregame'
            const legCfg = COVER_CONFIG[legStatus]
            return lg ? (
              <div key={i}>
                <div className="mb-0.5 flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-foreground/80">{legLabel}</p>
                  <div className="flex items-center gap-1">
                    <span className={`size-1.5 rounded-full ${legCfg.dot}`} />
                    <span className="text-[10px] font-medium">{legCfg.label}</span>
                  </div>
                </div>
                <GameScore game={lg} />
              </div>
            ) : (
              <p key={i} className="text-xs text-muted-foreground">
                {legLabel} — no live data
              </p>
            )
          })}
        </div>
      ) : game ? (
        <div className="mb-2">
          <GameScore game={game} betPeriod={betPeriod} />
        </div>
      ) : null}

      {/* Baseball situation — absolute bottom-right (2-b, 2-c) */}
      {game?.sport === 'MLB' && game.status === 'in' && game.situation && (
        <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
          <BasesDiamond
            onFirst={game.situation.onFirst}
            onSecond={game.situation.onSecond}
            onThird={game.situation.onThird}
          />
          <div className="flex items-center gap-1">
            <div aria-label={`${game.situation.outs} out`} className="flex items-center gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`inline-block size-1.5 rounded-full ${
                    i < game.situation!.outs
                      ? 'bg-amber-400'
                      : 'border border-zinc-500 bg-transparent'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {game.situation.balls}-{game.situation.strikes}
            </span>
          </div>
        </div>
      )}

      {/* Bet info */}
      <div className="border-t border-border/50 pt-2">
        <div className="min-w-0">
          {!isParlay && <p className="truncate text-xs font-medium">{bet.description}</p>}
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{USD.format(bet.stake)} risk</span>
            <span className="text-foreground/40">|</span>
            <span>{USD.format(bet.to_win)} win</span>
            {bet.is_freeplay && (
              <>
                <span className="text-foreground/40">|</span>
                <span className="text-violet-400">FP</span>
              </>
            )}
            {bet.odds_american != null && (
              <span className="text-[10px] text-muted-foreground">
                <span className="mx-1 text-foreground/40">|</span>
                @ {bet.odds_american > 0 ? '+' : ''}{bet.odds_american}
              </span>
            )}
          </div>
        </div>

        {/* Auto-settle hint */}
        {prediction && (
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-amber-400">
            Auto: {prediction.outcome.toUpperCase()} · {prediction.reason} · tap to confirm
          </p>
        )}

        {showSettleButtons && (
          <AuthActions>
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                size="sm"
                className={`min-h-11 sm:min-h-0 h-7 flex-1 bg-green-600 text-xs text-white hover:bg-green-700 ${autoClass('won')}`}
                onClick={() => onSettle(bet.id, 'won')}
                disabled={settling}
              >
                Won
              </Button>
              <Button
                size="sm"
                className={`min-h-11 sm:min-h-0 h-7 flex-1 bg-red-600 text-xs text-white hover:bg-red-700 ${autoClass('lost')}`}
                onClick={() => onSettle(bet.id, 'lost')}
                disabled={settling}
              >
                Lost
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={`min-h-11 sm:min-h-0 h-7 text-xs ${autoClass('push')}`}
                onClick={() => onSettle(bet.id, 'push')}
                disabled={settling}
              >
                Push
              </Button>
            </div>
          </AuthActions>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Golf scoreboard card
// ---------------------------------------------------------------------------

interface GolfCardProps {
  bet: Bet
  match: GolfMatchResult
  onSettle: (id: string, s: 'won' | 'lost' | 'push') => void
  settling: boolean
}

function GolfCard({ bet, match, onSettle, settling }: GolfCardProps) {
  const cfg = COVER_CONFIG[match.cover]
  const tournament = match.tournament
  const players = match.allPlayers.map((m) => m.player)
  const allFinal = tournament?.status === 'post'

  const glowStyle: { boxShadow?: string } | undefined = cfg.glow
    ? {
        boxShadow:
          match.cover === 'covering'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(74,222,128,0.25)'
            : match.cover === 'behind'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(248,113,113,0.25)'
            : match.cover === 'push'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(250,204,21,0.25)'
            : undefined,
      }
    : undefined

  return (
    <div className={`glass-card p-3 ${cfg.bg}`} data-glow={cfg.glow} style={glowStyle}>
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={`text-[10px] font-semibold uppercase tracking-wide ${SPORT_COLORS.Golf}`}>
            <Flag className="mr-1 inline size-2.5" />
            Golf
          </Badge>
          {match.parsed.kind === 'topN' && match.parsed.topN !== null && (
            <Badge variant="secondary" className="bg-yellow-500/10 text-[10px] text-yellow-400">
              Top {match.parsed.topN}
            </Badge>
          )}
          {match.parsed.kind === 'outright' && (
            <Badge variant="secondary" className="bg-yellow-500/10 text-[10px] text-yellow-400">
              Outright
            </Badge>
          )}
          {bet.is_freeplay && (
            <Badge variant="secondary" className="bg-violet-500/10 text-[10px] text-violet-400">
              FP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${cfg.dot}`} />
          <span className="text-[11px] font-medium">{cfg.label}</span>
        </div>
      </div>

      {/* Tournament name + status */}
      {tournament && (
        <p className="mb-2 truncate text-[11px] text-muted-foreground">
          {tournament.shortName} · {tournament.statusDetail}
        </p>
      )}

      {/* Player rows */}
      <div className="space-y-1.5">
        {players.map((p) => {
          const isLive = p.status === 'in'
          const isFinal = p.status === 'post'
          return (
            <div key={p.athleteId || p.name} className="flex items-center justify-between text-sm">
              <span className="font-medium">{p.name}</span>
              <div className="flex items-center gap-2 tabular-nums">
                <span className="text-[11px] text-muted-foreground">
                  {p.isCut ? p.positionLabel : p.positionLabel ? `T${p.positionLabel.replace(/^T-?/, '')}`.replace(/^TT/, 'T') : '—'}
                </span>
                <span className="font-bold">{p.scoreToPar || 'E'}</span>
                {isLive && p.thru && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                    <Circle className="size-1.5 fill-amber-400 text-amber-400 animate-pulse-live" />
                    Thru {p.thru}
                  </span>
                )}
                {isFinal && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    F
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bet info */}
      <div className="mt-2 border-t border-border/50 pt-2">
        <p className="truncate text-xs font-medium">{bet.description}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{USD.format(bet.stake)} risk</span>
          <span className="text-foreground/40">|</span>
          <span>{USD.format(bet.to_win)} win</span>
          {bet.odds_american != null && (
            <span className="text-[10px] text-muted-foreground">
              <span className="mx-1 text-foreground/40">|</span>
              @ {bet.odds_american > 0 ? '+' : ''}{bet.odds_american}
            </span>
          )}
        </div>

        {/* Settle buttons — always available for golf since rounds span days */}
        <AuthActions>
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              size="sm"
              className={`min-h-11 sm:min-h-0 h-7 flex-1 text-xs text-white ${allFinal && match.cover === 'covering' ? 'bg-green-600 ring-2 ring-green-400 hover:bg-green-700' : 'bg-green-600 hover:bg-green-700'}`}
              onClick={() => onSettle(bet.id, 'won')}
              disabled={settling}
            >
              Won
            </Button>
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0 h-7 flex-1 bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => onSettle(bet.id, 'lost')}
              disabled={settling}
            >
              Lost
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 sm:min-h-0 h-7 text-xs"
              onClick={() => onSettle(bet.id, 'push')}
              disabled={settling}
            >
              Push
            </Button>
          </div>
        </AuthActions>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Player prop card
// ---------------------------------------------------------------------------

interface PropCardProps {
  bet: Bet
  match: PropMatchResult
  onSettle: (id: string, s: 'won' | 'lost' | 'push') => void
  settling: boolean
}

function PropCard({ bet, match, onSettle, settling }: PropCardProps) {
  const cfg = COVER_CONFIG[match.cover]
  const { parsed, game, player, currentValue, prediction } = match

  const isLive = game.status === 'in'
  const isFinal = game.status === 'post'
  const showSettleButtons = prediction !== null || isFinal

  const autoClass = (target: 'won' | 'lost' | 'push'): string => {
    if (!prediction || prediction.outcome !== target) return ''
    return 'ring-2 ring-offset-1 ring-offset-background ring-amber-400'
  }

  const sportColor =
    SPORT_COLORS[game.sport] ?? 'text-zinc-400 bg-zinc-400/10'

  const comparatorLabel =
    parsed.comparator === 'plus'
      ? `${parsed.value}+`
      : `${parsed.comparator === 'over' ? 'O' : 'U'} ${parsed.value}`

  const glowStyle: { boxShadow?: string } | undefined = cfg.glow
    ? {
        boxShadow:
          match.cover === 'covering'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(74,222,128,0.25)'
            : match.cover === 'behind'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(248,113,113,0.25)'
            : match.cover === 'push'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(250,204,21,0.25)'
            : undefined,
      }
    : undefined

  return (
    <div className={`glass-card p-3 ${cfg.bg}`} data-glow={cfg.glow} style={glowStyle}>
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={`text-[10px] font-semibold uppercase tracking-wide ${sportColor}`}>
            <User className="mr-1 inline size-2.5" />
            {game.sport} Prop
          </Badge>
          {bet.is_freeplay && (
            <Badge variant="secondary" className="bg-violet-500/10 text-[10px] text-violet-400">
              FP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${cfg.dot}`} />
          <span className="text-[11px] font-medium">{cfg.label}</span>
        </div>
      </div>

      {/* Player name only — team/game line removed per 2-e */}
      <p className="truncate text-sm font-semibold">{parsed.playerName}</p>

      {/* Stat progress */}
      <div className="mt-2 flex items-baseline justify-between rounded-md border border-border/60 bg-secondary/50 px-2 py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {labelForStat(parsed.stat)}
        </span>
        <span className="tabular-nums text-base font-bold">
          {currentValue == null ? '—' : currentValue}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            / {comparatorLabel}
          </span>
        </span>
      </div>
      {player?.didNotPlay && (
        <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          DNP
        </p>
      )}
      {!player && game.status !== 'pre' && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Waiting for boxscore…
        </p>
      )}

      {/* Live / Final indicator */}
      <div className="mt-2 flex items-center gap-1.5">
        {isLive && (
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Circle className="size-1.5 fill-amber-400 text-amber-400 animate-pulse-live" />
            Live
          </span>
        )}
        {isFinal && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Final
          </span>
        )}
      </div>

      {/* Bet info */}
      <div className="mt-2 border-t border-border/50 pt-2">
        <p className="text-[10px] text-muted-foreground">{parsed.playerName} {comparatorLabel}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{USD.format(bet.stake)} risk</span>
          <span className="text-foreground/40">|</span>
          <span>{USD.format(bet.to_win)} win</span>
          {bet.odds_american != null && (
            <span className="text-[10px] text-muted-foreground">
              <span className="mx-1 text-foreground/40">|</span>
              @ {bet.odds_american > 0 ? '+' : ''}{bet.odds_american}
            </span>
          )}
        </div>

        {prediction && (
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-amber-400">
            Auto: {prediction.outcome.toUpperCase()} · {prediction.reason} · tap to confirm
          </p>
        )}

        {showSettleButtons && (
          <AuthActions>
            <div className="mt-2 flex items-center gap-1.5">
              <Button
                size="sm"
                className={`min-h-11 sm:min-h-0 h-7 flex-1 bg-green-600 text-xs text-white hover:bg-green-700 ${autoClass('won')}`}
                onClick={() => onSettle(bet.id, 'won')}
                disabled={settling}
              >
                Won
              </Button>
              <Button
                size="sm"
                className={`min-h-11 sm:min-h-0 h-7 flex-1 bg-red-600 text-xs text-white hover:bg-red-700 ${autoClass('lost')}`}
                onClick={() => onSettle(bet.id, 'lost')}
                disabled={settling}
              >
                Lost
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className={`min-h-11 sm:min-h-0 h-7 text-xs ${autoClass('push')}`}
                onClick={() => onSettle(bet.id, 'push')}
                disabled={settling}
              >
                Push
              </Button>
            </div>
          </AuthActions>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tennis scoreboard (D-08, D-09)
//
// Renders per-set game scores in columns from game.periodScores, plus the
// live current-set games line with the amber live-pulse indicator and a
// server dot next to the player whose tennisLive.serverName matches their
// homeTeam/awayTeam (the shortName fallback in competitorIdentity).
//
// Graceful degradation: missing periodScores / tennisLive / serverId all
// degrade — the card still renders, just without the missing element. NO
// 15/30/40/AD points are rendered (D-08 — point data is not in the ESPN
// scoreboard feed).
// ---------------------------------------------------------------------------

interface TennisScoreProps {
  game: LiveGame
}

function TennisScore({ game }: TennisScoreProps) {
  const isLive = game.status === 'in'
  const isFinal = game.status === 'post'
  const periodScores = game.periodScores ?? []
  // currentSetIdx = the set currently in progress (only while live). When the
  // match is final or pre, no live-set line is rendered.
  const currentSetIdx = isLive ? periodScores.length - 1 : -1
  // Count sets won per player (linescore.value > opponent.value).
  // Defensive: if periodScores is empty (no data yet), both totals are 0.
  let homeSetsWon = 0
  let awaySetsWon = 0
  for (let i = 0; i < periodScores.length; i++) {
    const ps = periodScores[i]
    if (ps.home > ps.away) homeSetsWon++
    else if (ps.away > ps.home) awaySetsWon++
  }

  // Server orientation: serverName is shortName (e.g. "L. Sonego"); for
  // individual sports homeTeam/awayTeam are populated from that same
  // shortName by competitorIdentity. Match directly. Empty serverName or
  // serverId → no server dot (graceful degradation, D-08).
  const serverName = game.tennisLive?.serverName ?? ''
  const serverId = game.tennisLive?.serverId ?? ''
  const homeIsServing =
    isLive && serverId !== '' && serverName !== '' && serverName === game.homeTeam
  const awayIsServing =
    isLive && serverId !== '' && serverName !== '' && serverName === game.awayTeam

  const ServerDot = () => (
    <span
      className="size-1.5 rounded-full bg-amber-400 animate-pulse-live"
      aria-label="serving"
    />
  )

  // Build a compact per-player row. Sets are shown as columns; the current
  // (live) set cell is amber-tinted.
  const PlayerRow = ({
    name,
    setsWon,
    games,
    serving,
  }: {
    name: string
    setsWon: number
    games: readonly number[]
    serving: boolean
  }) => (
    <div className="flex items-center justify-between text-sm">
      <div className="flex min-w-0 items-center gap-1.5">
        {serving ? <ServerDot /> : <span className="size-1.5" />}
        <span className="truncate font-medium">{name}</span>
      </div>
      <div className="flex items-center gap-2 tabular-nums">
        {games.map((g, i) => (
          <span
            key={i}
            className={`min-w-[1ch] text-center text-[12px] ${
              i === currentSetIdx
                ? 'text-amber-400 font-semibold'
                : 'text-foreground'
            }`}
          >
            {g}
          </span>
        ))}
        <span className="ml-1 border-l border-border/40 pl-2 text-[11px] font-bold">
          {setsWon}
        </span>
      </div>
    </div>
  )

  const homeGames = periodScores.map((ps) => ps.home)
  const awayGames = periodScores.map((ps) => ps.away)

  return (
    <div className="space-y-1">
      <PlayerRow
        name={game.awayName || game.awayTeam}
        setsWon={awaySetsWon}
        games={awayGames}
        serving={awayIsServing}
      />
      <PlayerRow
        name={game.homeName || game.homeTeam}
        setsWon={homeSetsWon}
        games={homeGames}
        serving={homeIsServing}
      />

      {/* Live current-set indicator with statusDetail (e.g. "5th") */}
      {isLive && (
        <div className="flex items-center gap-1.5 pt-1">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <Circle className="size-1.5 fill-amber-400 text-amber-400 animate-pulse-live" />
            {game.statusDetail || `Set ${currentSetIdx + 1}`}
          </span>
        </div>
      )}
      {isFinal && (
        <div className="pt-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Final
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tennis card (D-08, D-09)
//
// Renders for ANY tennis bet regardless of market (D-09) — total-games O/U
// gets the on-pace band via liveStatus, set/game spread gets covering/behind,
// ML/set-betting just shows the scoreboard. The scoreboard always shows.
// ---------------------------------------------------------------------------

interface TennisCardProps {
  bet: Bet
  game: LiveGame
  liveStatus: LiveStatus
  onSettle: (id: string, s: 'won' | 'lost' | 'push') => void
  settling: boolean
}

function TennisCard({ bet, game, liveStatus, onSettle, settling }: TennisCardProps) {
  const cfg = COVER_CONFIG[liveStatus]

  const glowStyle: { boxShadow?: string } | undefined = cfg.glow
    ? {
        boxShadow:
          liveStatus === 'covering' ||
          liveStatus === 'on_pace' ||
          liveStatus === 'clinched_won' ||
          liveStatus === 'final_won'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(74,222,128,0.25)'
            : liveStatus === 'behind' ||
              liveStatus === 'off_pace' ||
              liveStatus === 'clinched_lost' ||
              liveStatus === 'final_lost'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(248,113,113,0.25)'
            : liveStatus === 'push' ||
              liveStatus === 'borderline' ||
              liveStatus === 'final_push'
            ? 'inset 0 1px 0 var(--glass-highlight), var(--glass-shadow), 0 0 16px rgba(250,204,21,0.25)'
            : undefined,
      }
    : undefined

  return (
    <div className={`glass-card p-3 ${cfg.bg}`} data-glow={cfg.glow} style={glowStyle}>
      {/* Header — Tennis badge + LiveStatus dot/label */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className={`text-[10px] font-semibold uppercase tracking-wide ${SPORT_COLORS.Tennis}`}
          >
            Tennis
          </Badge>
          {bet.is_freeplay && (
            <Badge variant="secondary" className="bg-violet-500/10 text-[10px] text-violet-400">
              FP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${cfg.dot}`} />
          <span className="text-[11px] font-medium">{cfg.label}</span>
        </div>
      </div>

      {/* Tennis scoreboard (per-set games + server dot) */}
      <TennisScore game={game} />

      {/* Bet info + settle buttons */}
      <div className="mt-2 border-t border-border/50 pt-2">
        <p className="truncate text-xs font-medium">{bet.description}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{USD.format(bet.stake)} risk</span>
          <span className="text-foreground/40">|</span>
          <span>{USD.format(bet.to_win)} win</span>
          {bet.odds_american != null && (
            <span className="text-[10px] text-muted-foreground">
              <span className="mx-1 text-foreground/40">|</span>
              @ {bet.odds_american > 0 ? '+' : ''}{bet.odds_american}
            </span>
          )}
        </div>

        <AuthActions>
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0 h-7 flex-1 bg-green-600 text-xs text-white hover:bg-green-700"
              onClick={() => onSettle(bet.id, 'won')}
              disabled={settling}
            >
              Won
            </Button>
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0 h-7 flex-1 bg-red-600 text-xs text-white hover:bg-red-700"
              onClick={() => onSettle(bet.id, 'lost')}
              disabled={settling}
            >
              Lost
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="min-h-11 sm:min-h-0 h-7 text-xs"
              onClick={() => onSettle(bet.id, 'push')}
              disabled={settling}
            >
              Push
            </Button>
          </div>
        </AuthActions>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pending bet row (no live data)
// ---------------------------------------------------------------------------

interface PendingCardProps {
  bet: Bet
  onSettle: (id: string, s: 'won' | 'lost' | 'push') => void
  settling: boolean
}

function PendingCard({ bet, onSettle, settling }: PendingCardProps) {
  return (
    <div className="glass-card p-3" data-glow="">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={`text-[10px] font-semibold uppercase tracking-wide ${SPORT_COLORS[bet.sport] ?? 'text-zinc-400 bg-zinc-400/10'}`}>
            {bet.sport}
          </Badge>
          {bet.bet_type === 'parlay' && (
            <Badge variant="secondary" className="bg-amber-500/10 text-[10px] text-amber-400">
              Parlay
            </Badge>
          )}
          {bet.is_freeplay && (
            <Badge variant="secondary" className="bg-violet-500/10 text-[10px] text-violet-400">
              FP
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">No game data</span>
      </div>

      {/* Bet info */}
      <p className="truncate text-xs font-medium">{bet.description}</p>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{USD.format(bet.stake)} risk</span>
        <span className="text-foreground/40">|</span>
        <span>{USD.format(bet.to_win)} win</span>
        {bet.odds_american != null && (
          <span className="text-[10px] text-muted-foreground">
            <span className="mx-1 text-foreground/40">|</span>
            @ {bet.odds_american > 0 ? '+' : ''}{bet.odds_american}
          </span>
        )}
      </div>

      {/* Settle buttons */}
      <AuthActions>
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 flex-1 bg-green-600 text-xs text-white hover:bg-green-700"
            onClick={() => onSettle(bet.id, 'won')}
            disabled={settling}
          >
            Won
          </Button>
          <Button
            size="sm"
            className="h-7 flex-1 bg-red-600 text-xs text-white hover:bg-red-700"
            onClick={() => onSettle(bet.id, 'lost')}
            disabled={settling}
          >
            Lost
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => onSettle(bet.id, 'push')}
            disabled={settling}
          >
            Push
          </Button>
        </div>
      </AuthActions>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Click-to-edit affordance
// ---------------------------------------------------------------------------

/**
 * Wraps any bet card on /today with a tap-to-reveal Edit affordance. Tapping
 * the card body (anywhere except buttons or other interactive elements)
 * toggles a small "Edit bet" button that pops out below the card's lower-left
 * corner — gated behind <AuthActions> since editing is a write op. Tapping
 * the button calls `onEdit` which opens the shared `MobileBetSheet`.
 */
interface BetCardWithEditProps {
  bet: Bet
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  children: React.ReactNode
}

function BetCardWithEdit({
  expanded,
  onToggle,
  onEdit,
  children,
}: BetCardWithEditProps) {
  return (
    <div className="relative">
      <div
        onClick={(e) => {
          // Ignore taps that land on buttons, links, or form inputs — keeps
          // settle (Won/Lost/Push) and any future interactive child from
          // double-firing the toggle.
          if (
            (e.target as HTMLElement).closest(
              'button, a, input, textarea, select',
            )
          )
            return
          onToggle()
        }}
        className="cursor-pointer"
      >
        {children}
      </div>
      {expanded && (
        <AuthActions>
          <div className="mt-1 flex justify-start">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={onEdit}
            >
              <Pencil className="size-3" />
              Edit bet
            </Button>
          </div>
        </AuthActions>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function Today() {
  const { bets, loading: betsLoading, settleBet, linkBetToGame, editBet } = useBets()
  const [settling, setSettling] = useState<string | null>(null)
  const [filter, setFilter] = useState<BetFilter>('all')
  // Independent per-card edit affordances — set of bet IDs whose Edit button
  // is currently shown. Tap a card again to collapse; multiple cards may be
  // expanded at once.
  const [expandedBetIds, setExpandedBetIds] = useState<Set<string>>(new Set())
  // Bet currently open in the shared MobileBetSheet (null = sheet closed).
  const [editingBet, setEditingBet] = useState<Bet | null>(null)

  const toggleExpanded = useCallback((id: string) => {
    setExpandedBetIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleEditBet = useCallback((bet: Bet) => {
    setEditingBet(bet)
    // Collapse the card's edit affordance once the sheet is taking over.
    setExpandedBetIds((prev) => {
      const next = new Set(prev)
      next.delete(bet.id)
      return next
    })
  }, [])

  const todayPending = useMemo(
    () => bets.filter((b) => b.status === 'pending'),
    [bets]
  )

  const filteredPending = useMemo(() => {
    if (filter === 'cash') return todayPending.filter((b) => !b.is_freeplay)
    if (filter === 'fp') return todayPending.filter((b) => b.is_freeplay)
    return todayPending
  }, [todayPending, filter])

  const sports = useMemo(
    () => Array.from(new Set(todayPending.map((b) => b.sport))),
    [todayPending]
  )

  const betDates = useMemo(
    () => todayPending.map((b) => b.placed_at),
    [todayPending]
  )

  const { games, loading: scoresLoading, lastUpdated, refresh } =
    useLiveScores(sports, betDates)

  const hasGolf = useMemo(() => sports.includes('Golf'), [sports])
  const {
    tournaments: golfTournaments,
    loading: golfLoading,
    refresh: refreshGolf,
  } = useLiveGolf(hasGolf)

  // Loaded once on mount — used to resolve a prop's player → team when the
  // bet description omits "(TEAM)". Null until the fetch resolves.
  const playerResolver = usePlayerResolver()

  // Identify prop bets so we know which games' boxscores to fetch.
  const propBets = useMemo(
    () => filteredPending.filter((b) => parseProp(b.description) != null),
    [filteredPending],
  )

  // Resolve each prop's game id (without needing boxscores yet).
  const boxscoreRequests = useMemo(() => {
    const seen = new Set<string>()
    const reqs: { gameId: string; sport: string }[] = []
    for (const bet of propBets) {
      const parsed = parseProp(bet.description)
      if (!parsed) continue
      // Fall back to the players-table resolver when the description omits
      // (TEAM). On first paint the resolver may still be null — that's ok;
      // the boxscore request just gets queued on the next render.
      let teamAbbrev = parsed.teamAbbrev
      let resolvedSport: string | null = null
      if (!teamAbbrev && playerResolver) {
        const hit = playerResolver.resolve(parsed.playerName, { sport: bet.sport })
        if (hit?.teamAbbrev) {
          teamAbbrev = hit.teamAbbrev
          resolvedSport = hit.sport
        }
      }
      if (!teamAbbrev) continue
      const game = findGameForTeam(teamAbbrev, bet.placed_at, games, {
        sport: resolvedSport ?? bet.sport,
      })
      if (!game) continue
      const key = `${game.sport}:${game.id}`
      if (seen.has(key)) continue
      seen.add(key)
      reqs.push({ gameId: game.id, sport: game.sport })
    }
    return reqs
  }, [propBets, games, playerResolver])

  const { boxscores, loading: boxscoresLoading, refresh: refreshBoxscores } =
    useBoxscores(boxscoreRequests)

  // Split bets into matched (have live game) and unmatched.
  //
  // Lock policy: once we've found a confident match AND the game has started
  // or finished, we persist the ESPN game id on the bet (live_game_id). On
  // subsequent renders we look up that exact id rather than re-matching, so
  // a settled game can't roll forward to the next entry in a series (e.g.
  // tonight's Yankees -> tomorrow's Yankees). Pregame matches stay fluid so
  // the fuzzy matcher can self-correct if it picked the wrong game.
  const { matched, golfMatched, tennisMatched, propMatched, unmatched, toLock } = useMemo(() => {
    const m: {
      bet: Bet
      game: LiveGame | null
      parlayGames?: (LiveGame | null)[]
      /** Card-level status. Parlays use 'pregame' (D-07 — no aggregated
       *  pace/tint roll-up); per-leg state is carried in `legStatuses`. */
      cover: LiveStatus
      legStatuses?: LiveStatus[]
      betPeriod: BetPeriod
      prediction: PredictedSettlement | null
    }[] = []
    const g: { bet: Bet; match: GolfMatchResult }[] = []
    const t: { bet: Bet; game: LiveGame; liveStatus: LiveStatus }[] = []
    const p: { bet: Bet; match: PropMatchResult }[] = []
    const u: Bet[] = []
    const lockReqs: { betId: string; gameId: string; sport: string }[] = []

    for (const bet of filteredPending) {
      // Player prop bets route to the prop matcher (boxscore-driven).
      // Check this BEFORE sport routing — a "(ANA) Over 0.5 Points" bet
      // tagged sport=NBA still goes through the prop path correctly.
      if (parseProp(bet.description) != null) {
        const match = matchPropBet(bet, games, boxscores, playerResolver)
        if (match) {
          p.push({ bet, match })
        } else {
          u.push(bet)
        }
        continue
      }

      // Golf bets take a separate path (leaderboard, not team-vs-team).
      if (bet.sport === 'Golf') {
        const match = matchGolfBet(bet, golfTournaments)
        if (match) {
          g.push({ bet, match })
        } else {
          u.push(bet)
        }
        continue
      }

      // Tennis bets render TennisCard regardless of market (D-09). The
      // scoreboard always shows; getLiveStatus internally gives total-games
      // O/U a pace band, set/game spread covering/behind, and unhandled
      // markets fall through to covering/behind/pregame.
      if (bet.sport === 'Tennis') {
        const tGame = matchBetToGame(bet, games)
        if (tGame) {
          const parsed = parseBetLine(bet.description)
          const liveStatus = getLiveStatus(parsed, tGame, bet.description)
          t.push({ bet, game: tGame, liveStatus })
        } else {
          u.push(bet)
        }
        continue
      }

      if (bet.bet_type === 'parlay') {
        const legGames = matchParlayLegs(bet, games)
        const hasAnyGame = legGames.some((g) => g !== null)
        if (hasAnyGame) {
          // D-07: NO aggregated parlay-level pace/tint roll-up. Each leg
          // computes its own LiveStatus via getLiveStatus and renders next
          // to that leg. The card header stays neutral ('pregame').
          const legDescs = bet.description.split(' / ')
          const legStatuses: LiveStatus[] = legGames.map((lg, i) => {
            if (!lg) return 'pregame'
            const legDesc = legDescs[i] ?? ''
            const parsed = parseBetLine(legDesc)
            return getLiveStatus(parsed, lg, legDesc)
          })
          // Parlay auto-settle is a separate flow (per-leg state), so leave
          // prediction null for now and keep the original allFinal gating.
          m.push({
            bet,
            game: null,
            parlayGames: legGames,
            cover: 'pregame',
            legStatuses,
            betPeriod: 'fullgame',
            prediction: null,
          })
        } else {
          u.push(bet)
        }
      } else {
        // Singles: prefer locked game, else fuzzy-match.
        let game: LiveGame | null = null
        if (bet.live_game_id) {
          game = games.find((g) => g.id === bet.live_game_id) ?? null
        }
        if (!game && !bet.live_game_id) {
          game = matchBetToGame(bet, games)
        }

        if (game) {
          const parsed = parseBetLine(bet.description)
          // getLiveStatus internally delegates spread/ML to getCoverStatus
          // (D-11) and routes totals through getOnPaceStatus (D-04), so a
          // single call covers all markets — totals/props get the pace band,
          // spread/ML keep covering/behind.
          const cover = getLiveStatus(parsed, game, bet.description)
          const prediction = predictBetOutcome(parsed, game, bet.description)
          m.push({
            bet,
            game,
            cover,
            betPeriod: parsed.period,
            prediction,
          })

          // Lock the moment the matched game has started or finished.
          if (!bet.live_game_id && game.status !== 'pre') {
            lockReqs.push({ betId: bet.id, gameId: game.id, sport: bet.sport })
          }
        } else if (bet.live_game_id) {
          // Locked but the scoreboard fetch didn't include it (rare — ESPN
          // sometimes drops yesterday's finals). Show as unmatched so the
          // user can still settle manually.
          u.push(bet)
        } else {
          u.push(bet)
        }
      }
    }

    // Sort: live first, then pregame, then final
    const statusOrder = { in: 0, pre: 1, post: 2 }
    m.sort((a, b) => {
      const aStatus = a.game?.status ?? a.parlayGames?.find((g) => g)?.status ?? 'pre'
      const bStatus = b.game?.status ?? b.parlayGames?.find((g) => g)?.status ?? 'pre'
      return statusOrder[aStatus] - statusOrder[bStatus]
    })

    return { matched: m, golfMatched: g, tennisMatched: t, propMatched: p, unmatched: u, toLock: lockReqs }
  }, [filteredPending, games, golfTournaments, boxscores, playerResolver])

  // Persist new locks. linkBetToGame is a no-op for already-locked bets, but
  // we filter here too to avoid unnecessary roundtrips.
  useEffect(() => {
    if (toLock.length === 0) return
    for (const req of toLock) {
      void linkBetToGame(req.betId, req.gameId, req.sport)
    }
  }, [toLock, linkBetToGame])

  const handleSettle = useCallback(
    async (betId: string, status: 'won' | 'lost' | 'push') => {
      setSettling(betId)
      try { await settleBet(betId, status) } catch { /* logged */ } finally { setSettling(null) }
    },
    [settleBet]
  )

  const totalRisk = filteredPending.reduce((s, b) => s + (b.is_freeplay ? 0 : b.stake), 0)
  const totalToWin = filteredPending.reduce((s, b) => s + b.to_win, 0)
  const loading = betsLoading || scoresLoading || golfLoading || boxscoresLoading

  const handleRefresh = useCallback(() => {
    refresh()
    if (hasGolf) refreshGolf()
    if (boxscoreRequests.length > 0) refreshBoxscores()
  }, [refresh, refreshGolf, hasGolf, refreshBoxscores, boxscoreRequests.length])

  const cashCount = todayPending.filter((b) => !b.is_freeplay).length
  const fpCount = todayPending.filter((b) => b.is_freeplay).length

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Today's Action</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            {filteredPending.length > 0 && (
              <>
                <span>{filteredPending.length} bets</span>
                <span className="text-foreground/20">|</span>
                <span>{USD.format(totalRisk)} at risk</span>
                <span className="text-foreground/20">|</span>
                <span>{USD.format(totalToWin)} to win</span>
              </>
            )}
            {lastUpdated && (
              <>
                <span className="text-foreground/20">|</span>
                <span>Updated {formatTime(lastUpdated)}</span>
              </>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={handleRefresh}
          disabled={loading}
        >
          <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filter tabs */}
      {todayPending.length > 0 && (
        <Tabs value={filter} onValueChange={(val) => setFilter(val as BetFilter)}>
          <TabsList>
            <TabsTrigger value="all">All ({todayPending.length})</TabsTrigger>
            <TabsTrigger value="cash">Cash ({cashCount})</TabsTrigger>
            <TabsTrigger value="fp">Freeplay ({fpCount})</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Loading */}
      {betsLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Loading...
        </div>
      )}

      {/* Empty */}
      {!betsLoading && filteredPending.length === 0 && todayPending.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16">
          <Calendar className="size-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No action today</p>
        </div>
      )}

      {/* Live scoreboards — split singles and parlays (2-g) */}
      {matched.length > 0 && (() => {
        const matchedSingles = matched.filter((m) => m.bet.bet_type !== 'parlay')
        const matchedParlays = matched.filter((m) => m.bet.bet_type === 'parlay')
        return (
          <>
            {matchedSingles.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {matchedSingles.map(({ bet, game, parlayGames, cover, legStatuses, betPeriod, prediction }) => (
                  <BetCardWithEdit
                    key={bet.id}
                    bet={bet}
                    expanded={expandedBetIds.has(bet.id)}
                    onToggle={() => toggleExpanded(bet.id)}
                    onEdit={() => handleEditBet(bet)}
                  >
                    <ScoreboardCard
                      bet={bet}
                      game={game}
                      parlayGames={parlayGames}
                      coverStatus={cover}
                      legStatuses={legStatuses}
                      betPeriod={betPeriod}
                      prediction={prediction}
                      onSettle={handleSettle}
                      settling={settling === bet.id}
                    />
                  </BetCardWithEdit>
                ))}
              </div>
            )}
            {matchedSingles.length > 0 && matchedParlays.length > 0 && (
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Parlays</h2>
            )}
            {matchedParlays.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                {matchedParlays.map(({ bet, game, parlayGames, cover, legStatuses, betPeriod, prediction }) => (
                  <BetCardWithEdit
                    key={bet.id}
                    bet={bet}
                    expanded={expandedBetIds.has(bet.id)}
                    onToggle={() => toggleExpanded(bet.id)}
                    onEdit={() => handleEditBet(bet)}
                  >
                    <ScoreboardCard
                      bet={bet}
                      game={game}
                      parlayGames={parlayGames}
                      coverStatus={cover}
                      legStatuses={legStatuses}
                      betPeriod={betPeriod}
                      prediction={prediction}
                      onSettle={handleSettle}
                      settling={settling === bet.id}
                    />
                  </BetCardWithEdit>
                ))}
              </div>
            )}
          </>
        )
      })()}

      {/* Golf leaderboard cards */}
      {golfMatched.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {golfMatched.map(({ bet, match }) => (
            <BetCardWithEdit
              key={bet.id}
              bet={bet}
              expanded={expandedBetIds.has(bet.id)}
              onToggle={() => toggleExpanded(bet.id)}
              onEdit={() => handleEditBet(bet)}
            >
              <GolfCard
                bet={bet}
                match={match}
                onSettle={handleSettle}
                settling={settling === bet.id}
              />
            </BetCardWithEdit>
          ))}
        </div>
      )}

      {/* Tennis match cards (D-08 first render of tennis on /today) */}
      {tennisMatched.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tennisMatched.map(({ bet, game, liveStatus }) => (
            <BetCardWithEdit
              key={bet.id}
              bet={bet}
              expanded={expandedBetIds.has(bet.id)}
              onToggle={() => toggleExpanded(bet.id)}
              onEdit={() => handleEditBet(bet)}
            >
              <TennisCard
                bet={bet}
                game={game}
                liveStatus={liveStatus}
                onSettle={handleSettle}
                settling={settling === bet.id}
              />
            </BetCardWithEdit>
          ))}
        </div>
      )}

      {/* Player prop cards */}
      {propMatched.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {propMatched.map(({ bet, match }) => (
            <BetCardWithEdit
              key={bet.id}
              bet={bet}
              expanded={expandedBetIds.has(bet.id)}
              onToggle={() => toggleExpanded(bet.id)}
              onEdit={() => handleEditBet(bet)}
            >
              <PropCard
                bet={bet}
                match={match}
                onSettle={handleSettle}
                settling={settling === bet.id}
              />
            </BetCardWithEdit>
          ))}
        </div>
      )}

      {/* No bets for this filter */}
      {!betsLoading && filteredPending.length === 0 && todayPending.length > 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12">
          <p className="text-sm text-muted-foreground">
            No {filter === 'cash' ? 'cash' : 'freeplay'} bets today
          </p>
        </div>
      )}

      {/* Unmatched bets — cards with settle buttons */}
      {unmatched.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            No Game Data
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {unmatched.map((bet) => (
              <BetCardWithEdit
                key={bet.id}
                bet={bet}
                expanded={expandedBetIds.has(bet.id)}
                onToggle={() => toggleExpanded(bet.id)}
                onEdit={() => handleEditBet(bet)}
              >
                <PendingCard
                  bet={bet}
                  onSettle={handleSettle}
                  settling={settling === bet.id}
                />
              </BetCardWithEdit>
            ))}
          </div>
        </div>
      )}

      {/* Shared edit sheet — driven by per-card Edit buttons above. */}
      <MobileBetSheet
        bet={editingBet}
        open={editingBet !== null}
        onOpenChange={(open) => {
          if (!open) setEditingBet(null)
        }}
        onSave={async (patch) => {
          if (!editingBet) return
          await editBet(editingBet.id, patch)
        }}
      />
    </div>
  )
}

export default Today
