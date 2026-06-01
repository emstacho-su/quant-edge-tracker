/**
 * PickInput — two entry paths for the line shopper:
 *
 * 1. Paste textarea (primary): debounced → POST /api/line-shop/parse → confidence feedback
 *    Low confidence (< 0.75) → show structured-form fallback (needsFallback)
 * 2. Browse selectors (secondary): sport → event → market from `markets`/`odds_snapshots`
 *
 * Either path produces input for POST /api/line-shop/prices.
 *
 * UI-SPEC: PickInput contract
 *   - Paste textarea + browse selectors (SHOP-02/03)
 *   - needsFallback -> render structured form
 *   - Browse: sport -> event -> market Selects from markets/odds_snapshots anon
 */

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search } from 'lucide-react'
import type { ParsedPick } from '@/hooks/use-line-shop'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrowseEvent {
  id: string
  sport: string
  event_name: string
  event_start: string
  market_type: string
  market_param: string | null
}

interface PickInputProps {
  /** Called with a market_id (browse) OR parsedPick (paste) for prices fetch. */
  onSubmit: (input: { market_id?: string; parsedPick?: ParsedPick }) => void
  /** From the parse hook. */
  parseResult: { parsed: ParsedPick | null; confidence: number; needsFallback: boolean } | null
  parseLoading: boolean
  parseError: string | null
  /** Trigger parse on text change. */
  onTextChange: (text: string) => void
  loading?: boolean
}

// ─── Sport options ─────────────────────────────────────────────────────────────

const SPORT_OPTIONS = ['mlb', 'nba', 'nfl', 'nhl', 'golf', 'soccer', 'tennis', 'mma']

// ─── PickInput ─────────────────────────────────────────────────────────────────

export function PickInput({
  onSubmit,
  parseResult,
  parseLoading,
  parseError: _parseError,
  onTextChange,
  loading = false,
}: PickInputProps) {
  const [mode, setMode] = useState<'paste' | 'browse'>('paste')
  const [pasteText, setPasteText] = useState('')

  // Browse state
  const [selectedSport, setSelectedSport] = useState<string>('')
  const [browseEvents, setBrowseEvents] = useState<BrowseEvent[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [selectedMarketId, setSelectedMarketId] = useState<string>('')

  // Structured fallback form state (when needsFallback)
  const [fallbackSport, setFallbackSport] = useState('')
  const [fallbackMarket, setFallbackMarket] = useState('')
  const [fallbackSide, setFallbackSide] = useState('')
  const [fallbackLine, setFallbackLine] = useState('')
  const [fallbackPrice, setFallbackPrice] = useState('')

  const needsFallback = parseResult?.needsFallback ?? false
  const confidence = parseResult?.confidence ?? 0

  // ── Paste handler ──────────────────────────────────────────────────────────
  function handlePasteChange(text: string) {
    setPasteText(text)
    onTextChange(text)
  }

  function handlePasteSubmit() {
    if (!pasteText.trim()) return
    if (needsFallback) {
      // Build parsedPick from fallback form
      const parsedPick: ParsedPick = {
        sport: fallbackSport || undefined,
        market: fallbackMarket || undefined,
        side: fallbackSide || undefined,
        line: fallbackLine ? parseFloat(fallbackLine) : null,
        price: fallbackPrice ? parseInt(fallbackPrice, 10) : null,
        confidence: 1.0,
      }
      onSubmit({ parsedPick })
    } else if (parseResult?.parsed) {
      onSubmit({ parsedPick: parseResult.parsed })
    }
  }

  // ── Browse handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSport) {
      setBrowseEvents([])
      return
    }

    let cancelled = false
    setBrowseLoading(true)

    const now = new Date()
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    supabase
      .from('markets')
      .select('id, sport, event_name, event_start, market_type, market_param')
      .eq('sport', selectedSport)
      .gte('event_start', now.toISOString())
      .lte('event_start', windowEnd.toISOString())
      .order('event_start', { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) {
          setBrowseEvents((data as BrowseEvent[]) ?? [])
          setBrowseLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [selectedSport])

  function handleBrowseSubmit() {
    if (!selectedMarketId) return
    onSubmit({ market_id: selectedMarketId })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-card/60 p-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          variant={mode === 'paste' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('paste')}
        >
          Paste Pick
        </Button>
        <Button
          variant={mode === 'browse' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('browse')}
        >
          Browse Markets
        </Button>
      </div>

      {/* ── Paste mode ──────────────────────────────────────────────────────── */}
      {mode === 'paste' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pick-paste">Pick text</Label>
            <Textarea
              id="pick-paste"
              placeholder="e.g. Brewers ML -110 or Cubs -1.5 +130"
              value={pasteText}
              onChange={(e) => handlePasteChange(e.target.value)}
              rows={2}
              className="resize-none font-mono text-sm"
            />
          </div>

          {/* Parse feedback */}
          {parseLoading && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Parsing...
            </div>
          )}
          {parseResult && !parseLoading && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Confidence:</span>
              <Badge variant={confidence >= 0.75 ? 'default' : 'secondary'}>
                {(confidence * 100).toFixed(0)}%
              </Badge>
              {parseResult.parsed?.sport && (
                <span className="text-muted-foreground">
                  {parseResult.parsed.sport} · {parseResult.parsed.market}
                </span>
              )}
            </div>
          )}

          {/* Structured fallback form (needsFallback = true) */}
          {needsFallback && (
            <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Low confidence — fill in the fields below to continue.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Sport</Label>
                  <Select value={fallbackSport} onValueChange={(v) => setFallbackSport(v ?? '')}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Sport" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPORT_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.toUpperCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Market</Label>
                  <Select value={fallbackMarket} onValueChange={(v) => setFallbackMarket(v ?? '')}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Market" />
                    </SelectTrigger>
                    <SelectContent>
                      {['moneyline', 'spread', 'total', 'team_total', 'runline', 'puckline'].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Side</Label>
                  <Select value={fallbackSide} onValueChange={(v) => setFallbackSide(v ?? '')}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Side" />
                    </SelectTrigger>
                    <SelectContent>
                      {['home', 'away', 'over', 'under'].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Line</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. -1.5"
                    value={fallbackLine}
                    onChange={(e) => setFallbackLine(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price (American)</Label>
                  <Input
                    className="h-8 text-sm"
                    placeholder="e.g. -110"
                    value={fallbackPrice}
                    onChange={(e) => setFallbackPrice(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={handlePasteSubmit}
            disabled={!pasteText.trim() || loading || parseLoading}
            className="w-full sm:w-auto"
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
            Shop Lines
          </Button>
        </div>
      )}

      {/* ── Browse mode ──────────────────────────────────────────────────────── */}
      {mode === 'browse' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Sport selector */}
            <div className="space-y-1.5">
              <Label>Sport</Label>
              <Select
                value={selectedSport}
                onValueChange={(v) => { setSelectedSport(v ?? ''); setSelectedMarketId('') }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent>
                  {SPORT_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Event + market selector */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Event / Market</Label>
              {browseLoading ? (
                <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading events...
                </div>
              ) : (
                <Select
                  value={selectedMarketId}
                  onValueChange={(v) => setSelectedMarketId(v ?? '')}
                  disabled={!selectedSport || browseEvents.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !selectedSport
                          ? 'Select a sport first'
                          : browseEvents.length === 0
                          ? 'No upcoming markets'
                          : 'Select market'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {browseEvents.map((ev) => (
                      <SelectItem key={ev.id} value={ev.id}>
                        {ev.event_name} — {ev.market_type}
                        {ev.market_param ? ` ${ev.market_param}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Button
            onClick={handleBrowseSubmit}
            disabled={!selectedMarketId || loading}
            className="w-full sm:w-auto"
          >
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Search className="mr-2 size-4" />}
            Shop Lines
          </Button>
        </div>
      )}
    </div>
  )
}
