import { useState, useMemo, useCallback, useEffect } from 'react'
import { useBankroll, type NewBankrollEvent } from '@/hooks/use-bankroll'
import { useAutoUnitSize } from '@/hooks/use-auto-unit-size'
import type {
  BankrollEvent,
  BankrollEventType,
  BankrollType,
} from '@/lib/types'
import { projectBalanceSeries } from '@/utils/bankroll-helpers'
import { cashAtRisk, totalFpAssigned, totalVault } from '@/utils/account-ledger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Trash2, Pencil, X, Check } from 'lucide-react'
import { BgAnimationCard } from '@/components/BgAnimationCard'
import { USD, useDemoMode } from '@/lib/demo-mode'
import { AuthActions } from '@/components/auth/AuthGate'
import { useAuth } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Action catalog — drives the form selector and sign convention
// ---------------------------------------------------------------------------

interface ActionDef {
  value: BankrollEventType
  label: string
  bankrollType: BankrollType
  /** How the user-entered amount maps to the signed delta. */
  sign: 'positive' | 'negative' | 'signed'
  helpText: string
}

const ACTIONS: ActionDef[] = [
  {
    value: 'deposit',
    label: 'Deposit (Cash Reload)',
    bankrollType: 'cash',
    sign: 'positive',
    helpText: 'Money added to your sportsbook from your bank.',
  },
  {
    value: 'withdrawal',
    label: 'Withdrawal',
    bankrollType: 'cash',
    sign: 'negative',
    helpText: 'Money pulled from your sportsbook back to your bank.',
  },
  {
    value: 'manual_adjustment',
    label: 'Cash Adjustment',
    bankrollType: 'cash',
    sign: 'signed',
    helpText: 'Audit/reconciliation. Use a negative amount for outflows.',
  },
  {
    value: 'promo',
    label: 'FP Promo Credit',
    bankrollType: 'freeplay',
    sign: 'positive',
    helpText: 'Promotional freeplay added to your account.',
  },
  {
    value: 'manual_adjustment',
    label: 'FP Adjustment',
    bankrollType: 'freeplay',
    sign: 'signed',
    helpText: 'Audit/reconciliation. Use a negative amount for outflows.',
  },
]

const EVENT_TYPE_BADGE: Record<BankrollEventType, string> = {
  starting_balance: 'bg-blue-500/15 text-blue-300',
  bet_settled: 'bg-zinc-500/15 text-zinc-400',
  manual_adjustment: 'bg-amber-500/15 text-amber-300',
  deposit: 'bg-green-500/15 text-green-300',
  withdrawal: 'bg-red-500/15 text-red-300',
  promo: 'bg-purple-500/15 text-purple-300',
}

// ---------------------------------------------------------------------------
// Date helpers — datetime-local in browser local time, converted to ISO
// ---------------------------------------------------------------------------

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(local: string): string {
  // input value already has no timezone — Date() interprets as local; toISOString gives UTC.
  return new Date(local).toISOString()
}

function formatRowDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function AccountSettings() {
  const {
    events,
    cashBalance,
    fpBalance,
    loading: bankrollLoading,
    addEvent,
    updateEvent,
    deleteEvent,
  } = useBankroll()
  const autoUnit = useAutoUnitSize()
  const { authenticated, promptLogin } = useAuth()

  // Ledger-derived summary figures — NEVER read dropped settings.starting_* keys
  const cashAtRiskValue = useMemo(() => cashAtRisk(events), [events])
  const vaultValue = useMemo(() => totalVault(events), [events])
  const fpAssignedAllTime = useMemo(() => totalFpAssigned(events), [events])

  // Collapsed history toggle — defaults to collapsed
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // Manual events (everything except bet_settled), most recent first
  const manualEvents = useMemo(
    () =>
      events
        .filter((e) => e.event_type !== 'bet_settled')
        .slice()
        .sort(
          (a, b) =>
            new Date(b.occurred_at).getTime() -
            new Date(a.occurred_at).getTime(),
        ),
    [events],
  )

  if (bankrollLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading account settings...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Account Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your starting balances, deposits, withdrawals, promo credits,
          and unit size.
        </p>
      </header>

      {/* Account Info — ledger-truthful summary card (replaces 4-tile BentoGrid) */}
      <Card className="glass-card" data-glow="rgba(74,222,128,1)">
        <CardHeader>
          <CardTitle className="text-sm">Account Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {[
              { label: 'Cash Balance', value: USD.format(cashBalance), color: 'text-chart-1' },
              { label: 'FP Balance', value: USD.format(fpBalance), color: 'text-chart-4' },
              { label: 'Cash at Risk', value: USD.format(cashAtRiskValue), color: 'text-muted-foreground' },
              { label: 'Vault', value: USD.format(vaultValue), color: 'text-chart-2' },
              { label: 'FP Assigned All-Time', value: USD.format(fpAssignedAllTime), color: 'text-muted-foreground' },
              { label: 'Current Unit Size', value: USD.format(autoUnit.unitSize), color: 'text-muted-foreground' },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className={`font-semibold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Auto unit-size card — read-only, visible to all viewers */}
      <CurrentUnitCard
        unitSize={autoUnit.unitSize}
        bankrollAtWeekStart={autoUnit.bankrollAtWeekStart}
        weekStart={autoUnit.weekStart}
      />

      {/* Write controls — gated. Public viewers see a sign-in prompt instead. */}
      {authenticated ? (
        <AddEventCard events={events} onAdd={addEvent} />
      ) : (
        <Card className="glass-card" data-glow="rgba(125,211,252,1)">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center text-sm">
            <p className="text-muted-foreground">
              Bankroll events are write-only controls. Sign in to modify them.
            </p>
            <Button onClick={promptLogin}>Sign in</Button>
          </CardContent>
        </Card>
      )}

      {/* Account Settings section header */}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Account Settings
      </h2>

      {/* Demo mode (display-only x10 divisor) — anyone can toggle this. */}
      <DemoModeCard />

      {/* Background animation preferences */}
      <BgAnimationCard />

      <Separator />

      {/* Event history — collapsed by default */}
      <Card className="glass-card" data-glow="rgba(125,211,252,1)">
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            Bankroll Event History
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryExpanded((v) => !v)}
            >
              {historyExpanded ? 'Hide History' : 'Show History'}
            </Button>
          </CardTitle>
        </CardHeader>
        {historyExpanded && (
          <CardContent>
            {manualEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No manual ledger events yet.
              </p>
            ) : (
              <EventTable
                events={manualEvents}
                allEvents={events}
                onUpdate={updateEvent}
                onDelete={deleteEvent}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface AddEventCardProps {
  events: readonly BankrollEvent[]
  onAdd: (input: NewBankrollEvent) => Promise<void>
}

function AddEventCard({ events, onAdd }: AddEventCardProps) {
  const [actionIndex, setActionIndex] = useState<number>(0)
  const [amountInput, setAmountInput] = useState('')
  const [dateInput, setDateInput] = useState(toLocalInputValue(new Date().toISOString()))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  // Withdrawal-only: a two-step inline confirmation. 'idle' shows Add Event;
  // 'asking' shows "Withdraw to vault?" with [Yes, to Vault] / [Other...];
  // 'other-input' shows a text input for the destination + Save.
  const [withdrawStep, setWithdrawStep] = useState<'idle' | 'asking' | 'other-input'>('idle')
  const [otherDestination, setOtherDestination] = useState('')

  const action = ACTIONS[actionIndex]

  // Reset confirmation + withdraw step when user changes inputs
  useEffect(() => {
    setConfirmation(null)
    setError(null)
    setWithdrawStep('idle')
    setOtherDestination('')
  }, [actionIndex, amountInput, dateInput, note])

  const signedAmount = useMemo(() => {
    const parsed = parseFloat(amountInput)
    if (!Number.isFinite(parsed)) return null
    if (action.sign === 'positive') return Math.abs(parsed)
    if (action.sign === 'negative') return -Math.abs(parsed)
    return parsed
  }, [action, amountInput])

  // The actual write. `destination` is the withdraw_destination tag — used
  // ONLY for withdrawals; coerced to null elsewhere by the hook (use-bankroll).
  const submitWith = useCallback(
    async (destination: string | null) => {
      setError(null)
      if (signedAmount === null || signedAmount === 0) {
        setError('Enter a non-zero amount.')
        return
      }
      if (!dateInput) {
        setError('Pick a date.')
        return
      }
      const occurred_at = fromLocalInputValue(dateInput)

      // Cash safeguard: never let any intermediate or final cash balance fall
      // to or below zero.
      if (action.bankrollType === 'cash') {
        const series = projectBalanceSeries({
          events,
          bankrollType: 'cash',
          pendingInsert: { amount: signedAmount, occurred_at },
        })
        const minBalance = Math.min(...series, Infinity)
        if (minBalance <= 0) {
          setError(
            `Blocked: this would drive your cash bankroll to ${USD.format(minBalance)}. ` +
              `Cash bankroll must stay positive.`,
          )
          return
        }
      }

      setSubmitting(true)
      try {
        await onAdd({
          event_type: action.value,
          bankroll_type: action.bankrollType,
          amount: signedAmount,
          occurred_at,
          note: note.trim() || null,
          withdraw_destination: action.value === 'withdrawal' ? destination : null,
        })
        setConfirmation('Saved.')
        setAmountInput('')
        setNote('')
        setWithdrawStep('idle')
        setOtherDestination('')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to save event.')
      } finally {
        setSubmitting(false)
      }
    },
    [action, signedAmount, dateInput, note, events, onAdd],
  )

  // Main Add Event handler. For withdrawals, intercept into the vault-confirm
  // flow instead of submitting directly. For everything else, submit straight.
  const handleSubmit = useCallback(() => {
    if (action.value === 'withdrawal' && withdrawStep === 'idle') {
      // Validate basic inputs first so we don't pop the prompt on bad input.
      setError(null)
      if (signedAmount === null || signedAmount === 0) {
        setError('Enter a non-zero amount.')
        return
      }
      if (!dateInput) {
        setError('Pick a date.')
        return
      }
      setWithdrawStep('asking')
      return
    }
    void submitWith(null)
  }, [action, withdrawStep, signedAmount, dateInput, submitWith])

  return (
    <Card className="glass-card" data-glow="rgba(251,191,36,1)">
      <CardHeader>
        <CardTitle className="text-sm">Add Bankroll Event</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="event-action">Action</Label>
            <select
              id="event-action"
              value={actionIndex}
              onChange={(e) => setActionIndex(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs"
            >
              {ACTIONS.map((a, idx) => (
                <option key={`${a.value}-${a.bankrollType}-${idx}`} value={idx}>
                  {a.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{action.helpText}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-amount">
              Amount ({action.sign === 'signed' ? 'signed' : action.sign})
            </Label>
            <Input
              id="event-amount"
              type="number"
              step="0.01"
              placeholder={action.sign === 'signed' ? '-50.00 or 50.00' : '50.00'}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-date">When</Label>
            <Input
              id="event-date"
              type="datetime-local"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="event-note">Note (optional)</Label>
            <Input
              id="event-note"
              type="text"
              placeholder="e.g. Account 2 reload"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {withdrawStep === 'idle' && (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving...' : 'Add Event'}
            </Button>
          )}

          {withdrawStep === 'asking' && (
            <>
              <span className="text-sm font-medium">Withdraw to vault?</span>
              <Button onClick={() => void submitWith('vault')} disabled={submitting}>
                {submitting ? 'Saving…' : 'Yes, to Vault'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setWithdrawStep('other-input')}
                disabled={submitting}
              >
                Other…
              </Button>
              <Button
                variant="ghost"
                onClick={() => setWithdrawStep('idle')}
                disabled={submitting}
              >
                Cancel
              </Button>
            </>
          )}

          {withdrawStep === 'other-input' && (
            <>
              <Input
                type="text"
                placeholder="Where? (e.g., paid Colton venmo)"
                value={otherDestination}
                onChange={(e) => setOtherDestination(e.target.value)}
                className="max-w-xs"
                autoFocus
              />
              <Button
                onClick={() => void submitWith(otherDestination.trim() || 'other')}
                disabled={submitting || !otherDestination.trim()}
              >
                {submitting ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setWithdrawStep('asking')}
                disabled={submitting}
              >
                Back
              </Button>
            </>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          {confirmation && !error && (
            <p className="text-sm text-green-500">{confirmation}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DemoModeCard() {
  const { enabled, setEnabled, divisor } = useDemoMode()

  return (
    <Card className="glass-card" data-glow="rgba(244,114,182,1)">
      <CardHeader>
        <CardTitle className="text-sm">Demo Mode</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Divides every displayed dollar amount by {divisor === 1 ? '10' : divisor} (balances, stakes,
          P&amp;L, charts). Display only — your data is never modified. Useful for
          screen-sharing or recording a demo video without exposing real
          numbers.
        </p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setEnabled(!enabled)}
            variant={enabled ? 'default' : 'secondary'}
          >
            {enabled ? `On (÷${divisor})` : 'Off'}
          </Button>
          <span className="text-xs text-muted-foreground">
            {enabled ? 'All displayed amounts are scaled down.' : 'Showing real values.'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

interface CurrentUnitCardProps {
  unitSize: number
  bankrollAtWeekStart: number
  weekStart: Date
}

function CurrentUnitCard({
  unitSize,
  bankrollAtWeekStart,
  weekStart,
}: CurrentUnitCardProps) {
  const weekStartLabel = weekStart.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const fmt = (n: number) => USD.format(n).replace(/\.00$/, '')
  return (
    <Card className="glass-card" data-glow="rgba(167,139,250,1)">
      <CardHeader>
        <CardTitle className="text-sm">Current Unit Size</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-3xl font-bold tabular-nums">{fmt(unitSize)}</div>
        <p className="text-xs text-muted-foreground">
          {bankrollAtWeekStart > 0
            ? `1% of ${fmt(bankrollAtWeekStart)} (cash bankroll at week of ${weekStartLabel}), rounded up to the nearest $5.`
            : 'No cash bankroll history yet — using $10 default.'}
        </p>
      </CardContent>
    </Card>
  )
}

interface EventTableProps {
  events: readonly BankrollEvent[]
  allEvents: readonly BankrollEvent[]
  onUpdate: (
    id: string,
    patch: { amount?: number; occurred_at?: string; note?: string | null },
  ) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function EventTable({ events, allEvents, onUpdate, onDelete }: EventTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      {error && (
        <p className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}
      <Table className="min-w-[48rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Bankroll</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance After</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="w-32">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((evt) =>
            editingId === evt.id ? (
              <EditingRow
                key={evt.id}
                event={evt}
                allEvents={allEvents}
                onCancel={() => {
                  setEditingId(null)
                  setError(null)
                }}
                onSave={async (patch) => {
                  setError(null)
                  try {
                    await onUpdate(evt.id, patch)
                    setEditingId(null)
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : 'Update failed.')
                  }
                }}
              />
            ) : (
              <DisplayRow
                key={evt.id}
                event={evt}
                onEdit={() => {
                  setEditingId(evt.id)
                  setError(null)
                }}
                onDelete={async () => {
                  if (!window.confirm('Delete this ledger event? This will rebuild the chain.')) {
                    return
                  }
                  setError(null)
                  try {
                    await onDelete(evt.id)
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : 'Delete failed.')
                  }
                }}
              />
            ),
          )}
        </TableBody>
      </Table>
    </>
  )
}

function DisplayRow({
  event,
  onEdit,
  onDelete,
}: {
  event: BankrollEvent
  onEdit: () => void
  onDelete: () => void
}) {
  const isStarting = event.event_type === 'starting_balance'
  return (
    <TableRow>
      <TableCell className="text-xs">{formatRowDate(event.occurred_at)}</TableCell>
      <TableCell>
        <Badge
          variant="secondary"
          className={EVENT_TYPE_BADGE[event.event_type] ?? ''}
        >
          {event.event_type.replace(/_/g, ' ')}
        </Badge>
      </TableCell>
      <TableCell className="capitalize">{event.bankroll_type}</TableCell>
      <TableCell
        className={`text-right tabular-nums ${
          event.amount >= 0 ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {event.amount >= 0 ? '+' : ''}
        {USD.format(event.amount)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {USD.format(event.balance_after)}
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
        {event.note ?? ''}
      </TableCell>
      <TableCell>
        <AuthActions>
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={onEdit}
              title="Edit event"
            >
              <Pencil className="size-3.5" />
            </Button>
            {!isStarting && (
              <Button
                size="xs"
                variant="outline"
                onClick={onDelete}
                title="Delete event"
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </AuthActions>
      </TableCell>
    </TableRow>
  )
}

interface EditingRowProps {
  event: BankrollEvent
  allEvents: readonly BankrollEvent[]
  onSave: (patch: {
    amount?: number
    occurred_at?: string
    note?: string | null
  }) => Promise<void>
  onCancel: () => void
}

function EditingRow({ event, allEvents, onSave, onCancel }: EditingRowProps) {
  const [amountInput, setAmountInput] = useState(String(event.amount))
  const [dateInput, setDateInput] = useState(toLocalInputValue(event.occurred_at))
  const [noteInput, setNoteInput] = useState(event.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSave = useCallback(async () => {
    setError(null)
    const amount = parseFloat(amountInput)
    if (!Number.isFinite(amount)) {
      setError('Enter a valid amount.')
      return
    }
    const occurred_at = fromLocalInputValue(dateInput)

    // Re-run cash safeguard on the projected chain.
    if (event.bankroll_type === 'cash') {
      const series = projectBalanceSeries({
        events: allEvents,
        bankrollType: 'cash',
        pendingUpdate: { id: event.id, amount, occurred_at },
      })
      const minBalance = Math.min(...series, Infinity)
      if (minBalance <= 0) {
        setError(
          `Blocked: this edit would drive your cash bankroll to ${USD.format(minBalance)}.`,
        )
        return
      }
    }

    setBusy(true)
    try {
      await onSave({
        amount,
        occurred_at,
        note: noteInput.trim() || null,
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }, [amountInput, dateInput, noteInput, event, allEvents, onSave])

  return (
    <TableRow className="bg-muted/30">
      <TableCell className="p-1">
        <Input
          type="datetime-local"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>
      <TableCell>
        <Badge
          variant="secondary"
          className={EVENT_TYPE_BADGE[event.event_type] ?? ''}
        >
          {event.event_type.replace(/_/g, ' ')}
        </Badge>
      </TableCell>
      <TableCell className="capitalize">{event.bankroll_type}</TableCell>
      <TableCell className="p-1">
        <Input
          type="number"
          step="0.01"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          className="h-8 text-right text-xs"
        />
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        recalc
      </TableCell>
      <TableCell className="p-1">
        <Input
          type="text"
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          className="h-8 text-xs"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="default"
            onClick={handleSave}
            disabled={busy}
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        {error && (
          <p className="mt-1 text-[10px] text-red-400">{error}</p>
        )}
      </TableCell>
    </TableRow>
  )
}

export default AccountSettings
