import { useState, useMemo, useCallback } from 'react'
import type { Bet, LegDraft } from '@/lib/types'
import { computeToWin, computeProfitLoss, computeOddsFromToWin } from '@/hooks/use-bets'
import { LegHighlighter } from '@/components/LegHighlighter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { USD } from '@/lib/demo-mode'

type EditableStatus = 'pending' | 'won' | 'lost' | 'push' | 'void'

interface EditBetFormProps {
  bet: Bet
  onSave: (patch: {
    stake?: number
    odds_american?: number | null
    status?: EditableStatus
    bet_type?: 'single' | 'parlay'
    legs?: LegDraft[]
    description?: string
  }) => Promise<void>
  onCancel: () => void
}

const STATUS_OPTIONS: { value: EditableStatus; label: string; tone: string }[] = [
  { value: 'pending', label: 'Pending', tone: 'bg-sky-600 text-white hover:bg-sky-700' },
  { value: 'won', label: 'Won', tone: 'bg-green-600 text-white hover:bg-green-700' },
  { value: 'lost', label: 'Lost', tone: 'bg-red-600 text-white hover:bg-red-700' },
  { value: 'push', label: 'Push', tone: 'bg-amber-600 text-white hover:bg-amber-700' },
  { value: 'void', label: 'Void', tone: 'bg-zinc-600 text-white hover:bg-zinc-700' },
]

export function EditBetForm({ bet, onSave, onCancel }: EditBetFormProps) {
  const [stakeInput, setStakeInput] = useState(String(bet.stake))
  const [oddsInput, setOddsInput] = useState(
    bet.odds_american != null ? String(bet.odds_american) : '',
  )
  const [status, setStatus] = useState<EditableStatus>(bet.status as EditableStatus)
  const [betType, setBetType] = useState<'single' | 'parlay'>(
    bet.bet_type === 'parlay' ? 'parlay' : 'single',
  )
  const [returnInput, setReturnInput] = useState('')
  const [convertToParlay, setConvertToParlay] = useState(false)
  const [legs, setLegs] = useState<LegDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Description editor — top-level bet text drives parsers/live-tracker.
  const [descriptionInput, setDescriptionInput] = useState(bet.description)
  // Existing-parlay leg description editor: one entry per leg, keyed by leg.id.
  const existingLegs = bet.parlay_legs ?? []
  const [legDescInputs, setLegDescInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(existingLegs.map((l) => [l.id, l.description])),
  )

  const parsedStake = useMemo(() => {
    const n = parseFloat(stakeInput)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [stakeInput])

  const parsedOdds = useMemo(() => {
    const trimmed = oddsInput.trim()
    if (trimmed === '') return null
    const n = parseInt(trimmed, 10)
    return Number.isFinite(n) ? n : null
  }, [oddsInput])

  const projectedToWin = useMemo(() => {
    if (parsedStake === null) return null
    return computeToWin(parsedStake, parsedOdds) ?? bet.to_win
  }, [parsedStake, parsedOdds, bet.to_win])

  const projectedPl = useMemo(() => {
    if (parsedStake === null || projectedToWin == null) return null
    if (status === 'pending') return null
    return computeProfitLoss(status, parsedStake, projectedToWin, bet.is_freeplay)
  }, [status, parsedStake, projectedToWin, bet.is_freeplay])

  const descriptionChanged =
    descriptionInput.trim() !== bet.description &&
    descriptionInput.trim().length > 0

  const legDescriptionsChanged = existingLegs.some(
    (l) => (legDescInputs[l.id] ?? l.description) !== l.description,
  )

  const isDirty =
    parsedStake !== bet.stake ||
    parsedOdds !== bet.odds_american ||
    status !== bet.status ||
    betType !== (bet.bet_type === 'parlay' ? 'parlay' : 'single') ||
    (convertToParlay && legs.length > 0) ||
    descriptionChanged ||
    legDescriptionsChanged

  const handleSave = useCallback(async () => {
    setError(null)
    if (parsedStake === null) {
      setError('Stake must be a positive number.')
      return
    }
    setBusy(true)
    try {
      // Build the patch. Two leg-related forks are mutually exclusive:
      //   - convertToParlay path uses the LegHighlighter draft (`legs` state)
      //   - leg-description-edit path rebuilds LegDraft[] from existing legs
      //     so wipe+reinsert preserves sport/odds/CLV fields and only changes
      //     the description column.
      const patch: Parameters<typeof onSave>[0] = {
        stake: parsedStake,
        odds_american: parsedOdds,
        status,
        bet_type: betType,
      }
      if (descriptionChanged) patch.description = descriptionInput.trim()
      if (betType === 'parlay' && convertToParlay && legs.length > 0) {
        patch.legs = legs
      } else if (legDescriptionsChanged && existingLegs.length > 0) {
        patch.legs = existingLegs.map((l) => ({
          description: (legDescInputs[l.id] ?? l.description).trim(),
          sport: l.sport,
          odds_american: l.odds_american,
          clv_market: l.clv_market ?? null,
          clv_selection: l.clv_selection ?? null,
          clv_line: l.clv_line ?? null,
        }))
      }
      await onSave(patch)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }, [
    parsedStake,
    parsedOdds,
    status,
    betType,
    convertToParlay,
    legs,
    descriptionInput,
    descriptionChanged,
    legDescriptionsChanged,
    existingLegs,
    legDescInputs,
    onSave,
  ])

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={`edit-stake-${bet.id}`} className="text-xs">
            Stake
          </Label>
          <Input
            id={`edit-stake-${bet.id}`}
            type="number"
            step="0.01"
            min="0"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-odds-${bet.id}`} className="text-xs">
            Odds (American)
          </Label>
          <Input
            id={`edit-odds-${bet.id}`}
            type="number"
            step="1"
            placeholder="-110 or +150"
            value={oddsInput}
            onChange={(e) => setOddsInput(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-return-${bet.id}`} className="text-xs">
            To Win (Return)
          </Label>
          <Input
            id={`edit-return-${bet.id}`}
            type="number"
            step="0.01"
            min="0"
            placeholder={String(bet.to_win)}
            value={returnInput}
            onChange={(e) => {
              const val = e.target.value
              setReturnInput(val)
              const parsedReturn = parseFloat(val)
              if (Number.isFinite(parsedReturn) && parsedReturn > 0 && parsedStake !== null) {
                const derived = computeOddsFromToWin(parsedStake, parsedReturn)
                if (derived !== null) setOddsInput(String(derived))
              }
            }}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`edit-desc-${bet.id}`} className="text-xs">
          Bet description
        </Label>
        <textarea
          id={`edit-desc-${bet.id}`}
          value={descriptionInput}
          onChange={(e) => setDescriptionInput(e.target.value)}
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-[10px] text-muted-foreground">
          The settler and live-tracker parse this text — fixing site-specific
          schema differences (e.g.&nbsp;different team names or line formats)
          improves auto-grading accuracy.
        </p>
      </div>

      {existingLegs.length > 0 && (
        <div className="space-y-2 rounded border border-border/40 bg-background/40 p-2">
          <Label className="text-xs">Parlay leg descriptions</Label>
          {existingLegs.map((leg, i) => (
            <div key={leg.id} className="space-y-1">
              <Label
                htmlFor={`edit-leg-${leg.id}`}
                className="text-[10px] text-muted-foreground"
              >
                Leg {i + 1}
                {leg.sport ? ` · ${leg.sport}` : ''}
                {leg.odds_american != null ? ` · ${leg.odds_american > 0 ? '+' : ''}${leg.odds_american}` : ''}
              </Label>
              <Input
                id={`edit-leg-${leg.id}`}
                type="text"
                value={legDescInputs[leg.id] ?? ''}
                onChange={(e) =>
                  setLegDescInputs((prev) => ({ ...prev, [leg.id]: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">
            Editing leg text re-authors the legs (sport, odds, and CLV fields
            are preserved). Bankroll-neutral.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Bet Type</Label>
        <div className="flex gap-1">
          {(['single', 'parlay'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setBetType(type)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                betType === type
                  ? 'bg-chart-1/15 text-chart-1'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {type === 'single' ? 'Straight' : 'Parlay'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Outcome</Label>
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatus(opt.value)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                status === opt.value
                  ? opt.tone
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 rounded border border-border/40 bg-background/60 p-2 text-xs sm:grid-cols-3">
        <div>
          <span className="text-muted-foreground">New To Win: </span>
          <span className="font-semibold tabular-nums">
            {projectedToWin != null ? USD.format(projectedToWin) : '—'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">New P/L: </span>
          <span
            className={`font-semibold tabular-nums ${
              (projectedPl ?? 0) > 0
                ? 'text-green-400'
                : (projectedPl ?? 0) < 0
                  ? 'text-red-400'
                  : ''
            }`}
          >
            {projectedPl != null
              ? `${projectedPl > 0 ? '+' : ''}${USD.format(projectedPl)}`
              : status === 'pending'
                ? 'Pending'
                : '—'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Current P/L: </span>
          <span className="tabular-nums">
            {bet.profit_loss != null ? USD.format(bet.profit_loss) : '—'}
          </span>
        </div>
      </div>

      {bet.bet_type === 'single' && betType === 'parlay' && (
        <div className="space-y-2 rounded border border-border/40 bg-background/40 p-2">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={convertToParlay}
              onChange={(e) => setConvertToParlay(e.target.checked)}
            />
            Define parlay legs
          </label>
          {convertToParlay && (
            <LegHighlighter
              description={bet.description}
              fallbackSport={bet.sport}
              legs={legs}
              onChange={setLegs}
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={busy || !isDirty || parsedStake === null}
        >
          {busy ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
