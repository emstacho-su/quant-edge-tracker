import { useState, useEffect, useCallback, useRef } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
//
// Golf scoreboard is structurally different from team-vs-team — a tournament
// has many competitors with positions, score-to-par, holes played. We expose
// flat `GolfPlayer` records keyed by tournament so the live page can match a
// player from the bet description without traversing event boundaries.
// ---------------------------------------------------------------------------

export interface GolfPlayer {
  athleteId: string
  name: string
  shortName: string
  position: number | null   // 1, 2, 3... null if cut/withdrawn
  positionLabel: string     // "T-5", "1", "Cut", "MDF", "WD"
  scoreToPar: string        // "-8", "+2", "E"
  thru: string              // "F", "14", "11" — holes played in current round
  round: number | null      // 1-4
  status: 'pre' | 'in' | 'post'
  isCut: boolean
}

export interface GolfTournament {
  id: string
  name: string
  shortName: string
  startDate: string
  status: 'pre' | 'in' | 'post'
  statusDetail: string
  players: readonly GolfPlayer[]
}

interface UseLiveGolfResult {
  tournaments: readonly GolfTournament[]
  loading: boolean
  lastUpdated: Date | null
  refresh: () => void
}

// ---------------------------------------------------------------------------
// Endpoints — the major tours we cover. PGA covers most of the user's bets;
// LIV/EPGA/Korn Ferry hit when relevant.
// ---------------------------------------------------------------------------

const TOUR_PATHS: readonly string[] = [
  'golf/pga',
  'golf/lpga',
  'golf/eur',           // DP World Tour (European)
  'golf/champions-tour',
  'golf/korn-ferry',
  'golf/liv',
]

const POLL_INTERVAL_MS = 60_000

// ---------------------------------------------------------------------------
// ESPN response parsing
// ---------------------------------------------------------------------------

function mapStatus(statusName: string): 'pre' | 'in' | 'post' {
  if (statusName === 'STATUS_IN_PROGRESS') return 'in'
  if (statusName === 'STATUS_FINAL') return 'post'
  return 'pre'
}

interface EspnAthlete {
  id?: string
  displayName?: string
  shortName?: string
}

interface EspnGolfStatus {
  position?: { id?: string; displayName?: string }
  thru?: number | string
  period?: number  // current round
  type?: { name?: string }
}

interface EspnGolfCompetitor {
  athlete?: EspnAthlete
  score?: string
  status?: EspnGolfStatus
}

interface EspnGolfEvent {
  id: string
  name?: string
  shortName?: string
  date?: string
  competitions?: Array<{
    competitors?: EspnGolfCompetitor[]
    status?: { type?: { name?: string; shortDetail?: string } }
  }>
}

function parsePosition(positionLabel: string | undefined): {
  position: number | null
  isCut: boolean
} {
  if (!positionLabel) return { position: null, isCut: false }
  const upper = positionLabel.toUpperCase()
  if (upper === 'CUT' || upper === 'MDF' || upper === 'WD' || upper === 'DQ' || upper === 'DNS') {
    return { position: null, isCut: true }
  }
  // T-5, T5, 1, 12 — strip leading T- / T
  const stripped = positionLabel.replace(/^T-?/i, '')
  const n = parseInt(stripped, 10)
  return { position: Number.isFinite(n) ? n : null, isCut: false }
}

function parseTournament(event: EspnGolfEvent): GolfTournament | null {
  const comp = event.competitions?.[0]
  if (!comp) return null

  const tournamentStatus = mapStatus(comp.status?.type?.name ?? 'STATUS_SCHEDULED')

  const players: GolfPlayer[] = (comp.competitors ?? []).map((c) => {
    const positionLabel = c.status?.position?.displayName ?? ''
    const { position, isCut } = parsePosition(positionLabel)
    const thruValue = c.status?.thru
    const thruStr = thruValue == null ? '' : String(thruValue)

    return {
      athleteId: c.athlete?.id ?? '',
      name: c.athlete?.displayName ?? '',
      shortName: c.athlete?.shortName ?? '',
      position,
      positionLabel,
      scoreToPar: c.score ?? 'E',
      thru: thruStr,
      round: c.status?.period ?? null,
      status: mapStatus(c.status?.type?.name ?? 'STATUS_SCHEDULED'),
      isCut,
    }
  })

  return {
    id: event.id,
    name: event.name ?? '',
    shortName: event.shortName ?? event.name ?? '',
    startDate: event.date ?? '',
    status: tournamentStatus,
    statusDetail: comp.status?.type?.shortDetail ?? '',
    players,
  }
}

async function fetchTour(path: string): Promise<GolfTournament[]> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = (await res.json()) as { events?: EspnGolfEvent[] }
    const events = data.events ?? []
    return events
      .map(parseTournament)
      .filter((t): t is GolfTournament => t !== null && t.players.length > 0)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLiveGolf(enabled: boolean): UseLiveGolfResult {
  const [tournaments, setTournaments] = useState<readonly GolfTournament[]>([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async () => {
    if (!enabled) {
      setTournaments([])
      setLoading(false)
      return
    }

    setLoading(true)
    const results = await Promise.all(TOUR_PATHS.map(fetchTour))
    const flat = results.flat()

    // Deduplicate by tournament id (rare but possible if multiple tour paths
    // point at the same event).
    const seen = new Set<string>()
    const deduped: GolfTournament[] = []
    for (const t of flat) {
      if (!seen.has(t.id)) {
        seen.add(t.id)
        deduped.push(t)
      }
    }

    setTournaments(deduped)
    setLastUpdated(new Date())
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    fetchAll()
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
  }, [fetchAll])

  return { tournaments, loading, lastUpdated, refresh: fetchAll }
}
