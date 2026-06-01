import { useState, useMemo, useCallback } from 'react'
import { useBets } from '@/hooks/use-bets'
import { useBankroll } from '@/hooks/use-bankroll'
import { useAutoUnitSize } from '@/hooks/use-auto-unit-size'
import { useViewport } from '@/hooks/useViewport'
import type { Bet } from '@/lib/types'
import { ExportBar } from '@/components/ExportBar'
import { EditBetForm } from '@/components/EditBetForm'
import { BetCard } from '@/components/BetCard'
import { MobileBetSheet } from '@/components/MobileBetSheet'
import { EntityBadge } from '@/components/EntityBadge'
import { exportBetLog, exportComprehensive } from '@/utils/excel-export'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NumberedPagination } from '@/components/ui/numbered-pagination'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { USD } from '@/lib/demo-mode'
import { AuthActions } from '@/components/auth/AuthGate'

type SortField =
  | 'placed_at'
  | 'sport'
  | 'stake'
  | 'to_win'
  | 'odds_american'
  | 'status'

type SortDir = 'asc' | 'desc'

const STATUS_COLORS: Record<string, string> = {
  won: 'bg-green-500/15 text-green-500',
  lost: 'bg-red-500/15 text-red-500',
  push: 'bg-yellow-500/15 text-yellow-500',
  void: 'bg-zinc-500/15 text-zinc-400',
  pending: 'bg-blue-500/15 text-blue-400',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const y = d.getFullYear()
  return `${m}/${day}/${y}`
}

function BetLog() {
  const { bets, loading, settleBet, editBet } = useBets()
  const { events: bankrollEvents, refetch: refetchBankroll } = useBankroll()
  const { unitSize } = useAutoUnitSize()
  const { isMobile } = useViewport()
  const [editingBetId, setEditingBetId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const [tab, setTab] = useState('all')
  const [sortField, setSortField] = useState<SortField>('placed_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortField(field)
        setSortDir('desc')
      }
    },
    [sortField]
  )

  // D-17: Resolution-review filter — bets whose entity resolution needs attention
  const REVIEW_STATUSES = new Set(['pending', 'low_confidence', 'agent_derived', 'failed'])

  const filteredBets = useMemo(() => {
    let filtered = [...bets]

    if (tab === 'cash') {
      filtered = filtered.filter((b) => !b.is_freeplay)
    } else if (tab === 'freeplay') {
      filtered = filtered.filter((b) => b.is_freeplay)
    } else if (tab === 'needs_review') {
      // D-17: Collect bets with non-healthy entity resolution so failures are never silent
      filtered = filtered.filter(
        (b) => b.entity_resolution_status != null && REVIEW_STATUSES.has(b.entity_resolution_status),
      )
    }

    filtered.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      const aVal = a[sortField]
      const bVal = b[sortField]

      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * dir
      }

      return ((aVal as number) - (bVal as number)) * dir
    })

    return filtered
  }, [bets, tab, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredBets.length / PAGE_SIZE))
  const pagedBets = filteredBets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset page when filters change
  const handleTabChange = useCallback((val: string) => {
    setTab(val)
    setPage(0)
  }, [])

  const handleSettle = useCallback(
    async (betId: string, status: 'won' | 'lost' | 'push' | 'void') => {
      await settleBet(betId, status)
    },
    [settleBet]
  )

  const handleStartEdit = useCallback((betId: string) => {
    setEditError(null)
    setEditingBetId(betId)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingBetId(null)
  }, [])

  const handleEditSave = useCallback(
    async (
      betId: string,
      patch: {
        stake?: number
        odds_american?: number | null
        status?: 'pending' | 'won' | 'lost' | 'push' | 'void'
      },
    ) => {
      setEditError(null)
      try {
        await editBet(betId, patch)
        await refetchBankroll()
        setEditingBetId(null)
      } catch (err: unknown) {
        setEditError(
          err instanceof Error ? err.message : 'Failed to edit bet.',
        )
        throw err
      }
    },
    [editBet, refetchBankroll],
  )

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return null
    return sortDir === 'asc' ? ' \u2191' : ' \u2193'
  }

  const editingBet = useMemo(
    () => (editingBetId ? bets.find((b) => b.id === editingBetId) ?? null : null),
    [bets, editingBetId],
  )

  // Interim attention indicator — supersedes the retired amber banner; retire when the Phase 17
  // resolution-review surface (D-17) goes live and becomes the canonical home for these bets.
  const attentionBets = useMemo(
    () => bets.filter((b) => b.grading_state === 'needs-agent' || b.grading_state === 'agent-derived'),
    [bets],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading bets...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Bet Log</h1>

      {editError && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {editError}
        </p>
      )}

      {attentionBets.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="text-xs">
            {attentionBets.length} to review
          </Badge>
          <span className="text-xs">
            Bets awaiting or completed by agent grading — visible until the Phase 17 review surface ships.
          </span>
        </div>
      )}

      <Card className="glass-card" data-glow="rgba(125,211,252,1)">
        <CardHeader>
          <CardTitle>All Bets</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="cash">Cash</TabsTrigger>
              <TabsTrigger value="freeplay">Freeplay</TabsTrigger>
              {/* D-17: Resolution-review surface — pending/low_confidence/agent_derived/failed */}
              <TabsTrigger value="needs_review">Needs Review</TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-4">
              {filteredBets.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">
                  No bets found.
                </p>
              ) : isMobile ? (
                <div className="flex flex-col gap-3">
                  {pagedBets.map((bet) => (
                    <BetCard
                      key={bet.id}
                      bet={bet}
                      onEdit={() => handleStartEdit(bet.id)}
                      onSettle={(b, status) => handleSettle(b.id, status)}
                    />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => handleSort('placed_at')}
                      >
                        Date{sortIndicator('placed_at')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => handleSort('sport')}
                      >
                        Sport{sortIndicator('sport')}
                      </TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => handleSort('stake')}
                      >
                        Stake{sortIndicator('stake')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => handleSort('to_win')}
                      >
                        To Win{sortIndicator('to_win')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => handleSort('odds_american')}
                      >
                        Odds{sortIndicator('odds_american')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => handleSort('status')}
                      >
                        Status{sortIndicator('status')}
                      </TableHead>
                      <TableHead className="text-right">P/L</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedBets.map((bet) => (
                      <BetRow
                        key={bet.id}
                        bet={bet}
                        expanded={expandedIds.has(bet.id)}
                        editing={editingBetId === bet.id}
                        onToggle={() => toggleExpand(bet.id)}
                        onSettle={handleSettle}
                        onStartEdit={() => handleStartEdit(bet.id)}
                        onCancelEdit={handleCancelEdit}
                        onEditSave={(patch) => handleEditSave(bet.id, patch)}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>

          {/* Pagination */}
          {filteredBets.length > PAGE_SIZE && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredBets.length)} of {filteredBets.length}
              </p>
              <NumberedPagination
                currentPage={page + 1}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p - 1)}
                className="w-auto"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <ExportBar
        pageLabel="History"
        onExportPage={() => exportBetLog(filteredBets)}
        onExportComprehensive={() =>
          exportComprehensive(bets, bankrollEvents, unitSize)
        }
      />

      {isMobile && (
        <MobileBetSheet
          bet={editingBet}
          open={editingBetId !== null}
          onOpenChange={(open) => {
            if (!open) handleCancelEdit()
          }}
          onSave={async (patch) => {
            if (editingBetId) await handleEditSave(editingBetId, patch)
          }}
        />
      )}
    </div>
  )
}

interface BetRowProps {
  bet: Bet
  expanded: boolean
  editing: boolean
  onToggle: () => void
  onSettle: (
    betId: string,
    status: 'won' | 'lost' | 'push' | 'void'
  ) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onEditSave: (patch: {
    stake?: number
    odds_american?: number | null
    status?: 'pending' | 'won' | 'lost' | 'push' | 'void'
  }) => Promise<void>
}

function BetRow({
  bet,
  expanded,
  editing,
  onToggle,
  onSettle,
  onStartEdit,
  onCancelEdit,
  onEditSave,
}: BetRowProps) {
  const isParlay = bet.bet_type === 'parlay' && (bet.parlay_legs?.length ?? 0) > 0
  const isPending = bet.status === 'pending'

  return (
    <>
      <TableRow>
        <TableCell className="w-8 p-1">
          {isParlay && (
            <button
              onClick={onToggle}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          )}
        </TableCell>
        <TableCell>{formatDate(bet.placed_at)}</TableCell>
        <TableCell>{bet.sport}</TableCell>
        <TableCell className="capitalize">{bet.bet_type}</TableCell>
        <TableCell className="max-w-[240px]">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="truncate">{bet.description}</span>
            {/* D-17: entity resolution badge — only visible for pending/low_confidence/agent_derived/failed */}
            <EntityBadge status={bet.entity_resolution_status} />
          </div>
        </TableCell>
        <TableCell className="text-right">{USD.format(bet.stake)}</TableCell>
        <TableCell className="text-right">{USD.format(bet.to_win)}</TableCell>
        <TableCell className="text-right">
          {bet.odds_american != null
            ? (bet.odds_american > 0 ? '+' : '') + bet.odds_american
            : '-'}
        </TableCell>
        <TableCell>
          <Badge
            className={STATUS_COLORS[bet.status] ?? ''}
            variant="secondary"
          >
            {bet.status.charAt(0).toUpperCase() + bet.status.slice(1)}
          </Badge>
        </TableCell>
        <TableCell
          className={`text-right ${
            (bet.profit_loss ?? 0) > 0
              ? 'text-green-500'
              : (bet.profit_loss ?? 0) < 0
                ? 'text-red-500'
                : ''
          }`}
        >
          {bet.profit_loss != null ? USD.format(bet.profit_loss) : '-'}
        </TableCell>
        <TableCell>
          <AuthActions>
            {isPending ? (
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="xs"
                  className="bg-green-600 text-white hover:bg-green-700"
                  onClick={() => onSettle(bet.id, 'won')}
                >
                  Won
                </Button>
                <Button
                  size="xs"
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={() => onSettle(bet.id, 'lost')}
                >
                  Lost
                </Button>
                <Button
                  size="xs"
                  className="bg-yellow-600 text-white hover:bg-yellow-700"
                  onClick={() => onSettle(bet.id, 'push')}
                >
                  Push
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => onSettle(bet.id, 'void')}
                >
                  Void
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={editing ? onCancelEdit : onStartEdit}
                >
                  {editing ? 'Cancel' : 'Edit'}
                </Button>
              </div>
            ) : (
              <Button
                size="xs"
                variant="outline"
                onClick={editing ? onCancelEdit : onStartEdit}
              >
                {editing ? 'Cancel' : 'Edit'}
              </Button>
            )}
          </AuthActions>
        </TableCell>
      </TableRow>

      {/* Inline edit row — works for pending and settled bets */}
      {editing && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={11} className="p-3">
            <EditBetForm bet={bet} onSave={onEditSave} onCancel={onCancelEdit} />
          </TableCell>
        </TableRow>
      )}

      {/* Parlay legs expanded */}
      {isParlay && expanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={11} className="p-0">
            <div className="px-8 py-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Parlay Legs
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Sport</TableHead>
                    <TableHead className="text-right">Odds</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bet.parlay_legs?.map((leg) => (
                    <TableRow key={leg.id}>
                      <TableCell>{leg.description}</TableCell>
                      <TableCell>{leg.sport ?? '-'}</TableCell>
                      <TableCell className="text-right">
                        {leg.odds_american != null
                          ? (leg.odds_american > 0 ? '+' : '') +
                            leg.odds_american
                          : '-'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            STATUS_COLORS[leg.leg_status] ?? ''
                          }
                          variant="secondary"
                        >
                          {leg.leg_status.charAt(0).toUpperCase() +
                            leg.leg_status.slice(1)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export default BetLog
