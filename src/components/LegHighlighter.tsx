import { useState, useCallback } from 'react'
import type { LegDraft } from '@/lib/types'
import { legFromSpan } from '@/utils/leg-from-span'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface LegHighlighterProps {
  description: string
  fallbackSport: string | null
  legs: LegDraft[]
  onChange: (legs: LegDraft[]) => void
}

/**
 * Straight→parlay leg authoring: the user selects (highlights) a span of the
 * bet description and adds it as a leg, which is parsed into a structured
 * selection. Legs are shown as editable cards (odds input + remove).
 */
export function LegHighlighter({ description, fallbackSport, legs, onChange }: LegHighlighterProps) {
  const [sel, setSel] = useState('')

  const captureSelection = useCallback(() => {
    setSel((window.getSelection()?.toString() ?? '').trim())
  }, [])

  const addLeg = useCallback(() => {
    if (!sel) return
    onChange([...legs, legFromSpan(sel, fallbackSport)])
    setSel('')
    window.getSelection()?.removeAllRanges()
  }, [sel, legs, fallbackSport, onChange])

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Highlight a chunk of the description below, then “Add as leg”. Repeat for each leg.
      </p>
      <div
        onMouseUp={captureSelection}
        className="select-text rounded border border-border/60 bg-background/60 p-2 text-sm leading-relaxed"
      >
        {description}
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-xs text-muted-foreground">
          Selected: {sel || '—'}
        </span>
        <Button size="sm" type="button" disabled={!sel} onClick={addLeg}>
          Add as leg
        </Button>
      </div>

      {legs.length > 0 && (
        <div className="space-y-1">
          {legs.map((l, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded border border-border/40 bg-muted/20 p-2 text-xs"
            >
              <span className="w-10 shrink-0 font-semibold text-muted-foreground">
                Leg {i + 1}
              </span>
              <span className="flex-1 truncate">
                <span className="font-medium">{l.clv_market ?? 'other'}</span>
                {' · '}
                {l.clv_selection ?? l.description}
                {l.clv_line != null ? ` ${l.clv_line}` : ''}
                {' · '}
                <span className="text-muted-foreground">{l.sport ?? '?'}</span>
              </span>
              <Input
                className="h-7 w-20 text-xs"
                placeholder="odds"
                value={l.odds_american ?? ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10)
                  const next = [...legs]
                  next[i] = { ...l, odds_american: Number.isFinite(v) ? v : null }
                  onChange(next)
                }}
              />
              <button
                type="button"
                aria-label={`Remove leg ${i + 1}`}
                className="px-1 text-red-400 hover:text-red-300"
                onClick={() => onChange(legs.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
