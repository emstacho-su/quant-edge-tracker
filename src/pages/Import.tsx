import { useState, useCallback } from 'react'
import { useBets } from '@/hooks/use-bets'
import { parsePaste } from '@/utils/paste-parser'
import type { ParsedBet } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { USD } from '@/lib/demo-mode'
import { AuthGate } from '@/components/auth/AuthGate'
import { vigForParsedBet } from '@/utils/import-vig'

const SPORTS = [
  'MLB',
  'NBA',
  'NFL',
  'NHL',
  'NCAAF',
  'NCAAB',
  'Soccer',
  'Tennis',
  'MMA',
  'Golf',
  'Cricket',
] as const

function Import() {
  return (
    <AuthGate
      title="Sign in to import bets"
      description="Importing modifies your bet log. Sign in to continue."
    >
      <ImportInner />
    </AuthGate>
  )
}

function ImportInner() {
  const { insertBets } = useBets()

  const [rawText, setRawText] = useState('')
  const [parsed, setParsed] = useState<ParsedBet[]>([])
  const [committing, setCommitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleParse = useCallback(() => {
    setSuccessMsg('')
    setErrorMsg('')
    if (!rawText.trim()) {
      setErrorMsg('Paste some bet data first.')
      return
    }

    try {
      const results = parsePaste(rawText)
      if (results.length === 0) {
        setErrorMsg("Couldn't parse any bets from that text.")
        return
      }
      setParsed(results)
    } catch {
      setErrorMsg('Failed to parse pasted text. Check the format and try again.')
    }
  }, [rawText])

  const updateSport = useCallback((index: number, sport: string) => {
    setParsed((prev) =>
      prev.map((bet, i) => (i === index ? { ...bet, sport } : bet))
    )
  }, [])

  const hasUnknownSport = parsed.some((b) => b.sport === 'unknown')

  const handleCommit = useCallback(async () => {
    if (hasUnknownSport) return

    setCommitting(true)
    setErrorMsg('')
    try {
      await insertBets(parsed)
      setSuccessMsg(
        `Successfully imported ${parsed.length} bet${parsed.length > 1 ? 's' : ''}.`
      )
      setParsed([])
      setRawText('')
    } catch {
      setErrorMsg('Failed to commit bets. Please try again.')
    } finally {
      setCommitting(false)
    }
  }, [parsed, hasUnknownSport, insertBets])

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Import Bets</h1>

      <Card className="glass-card" data-glow="rgba(125,211,252,1)">
        <CardHeader>
          <CardTitle>Paste Bet Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Paste your bet blocks here..."
            className="min-h-[12rem] max-h-[60vh] font-mono text-base sm:text-sm"
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value)
              setSuccessMsg('')
              setErrorMsg('')
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleParse} className="min-h-11 w-full sm:w-auto">
              Parse
            </Button>
            {errorMsg && (
              <p className="text-sm text-red-500">{errorMsg}</p>
            )}
            {successMsg && (
              <p className="text-sm text-green-500">{successMsg}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {parsed.length > 0 && (
        <Card className="glass-card" data-glow="rgba(74,222,128,1)">
          <CardHeader>
            <CardTitle>Preview ({parsed.length} bets)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasUnknownSport && (
              <p className="text-sm text-yellow-500">
                Some bets have an unknown sport. Select the correct sport before
                committing.
              </p>
            )}

            <Table className="min-w-[50rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Stake</TableHead>
                  <TableHead className="text-right">To Win</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Odds</TableHead>
                  <TableHead className="text-right">Vig</TableHead>
                  <TableHead>FP</TableHead>
                  <TableHead>Sport</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.map((bet, idx) => {
                  const isUnknown = bet.sport === 'unknown'
                  return (
                    <TableRow
                      key={idx}
                      className={isUnknown ? 'bg-red-500/10' : ''}
                    >
                      <TableCell className="text-right">
                        {USD.format(bet.stake)}
                      </TableCell>
                      <TableCell className="text-right">
                        {USD.format(bet.to_win)}
                      </TableCell>
                      <TableCell className="capitalize">{bet.bet_type}</TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        {bet.description}
                      </TableCell>
                      <TableCell className="text-right">
                        {bet.odds_american != null
                          ? (bet.odds_american > 0 ? '+' : '') +
                            bet.odds_american
                          : '-'}
                      </TableCell>
                      {/* Vig column: shows '—' for all current rows because the
                          paste-parser captures only one side's odds. Two-sided
                          vig cannot be computed from a single ParsedBet.
                          (RESEARCH reconciliation #1 — honest display) */}
                      <TableCell className="text-right text-muted-foreground">
                        {(() => {
                          const v = vigForParsedBet(bet)
                          return v == null ? '—' : `+${v.toFixed(1)}%`
                        })()}
                      </TableCell>
                      <TableCell>
                        {bet.is_freeplay ? 'Yes' : ''}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={bet.sport}
                          onValueChange={(val) => val != null && updateSport(idx, val)}
                        >
                          <SelectTrigger
                            className={
                              isUnknown
                                ? 'border-yellow-500 text-yellow-500'
                                : ''
                            }
                          >
                            <SelectValue placeholder="Select sport" />
                          </SelectTrigger>
                          <SelectContent>
                            {isUnknown && (
                              <SelectItem value="unknown" disabled>
                                Select sport…
                              </SelectItem>
                            )}
                            {SPORTS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <Button
              onClick={handleCommit}
              disabled={hasUnknownSport || committing}
              className="min-h-11 w-full sm:w-auto"
            >
              {committing ? 'Committing...' : 'Commit to Database'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default Import
