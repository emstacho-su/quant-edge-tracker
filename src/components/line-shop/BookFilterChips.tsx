/**
 * BookFilterChips — one toggleable chip per distinct book in the current arb rows.
 *
 * Reads enabledBooks + toggleBook from useLineShop (same qe.enabledBooks slice
 * used by PriceTable — D-03, no new localStorage key).
 *
 * Only books in `candidateBooks` are rendered (Pitfall 7: don't show chips for
 * books that never appear in any arb row). The parent computes candidateBooks from
 * allArbBooks (pre-enabledBooks-filter) so disabled books remain togglable.
 *
 * Pitfall 5 compliance: chip hover labels use HTML `title=""` attribute, not the
 * Tooltip primitive.
 */

import { Badge } from '@/components/ui/badge'
import { useLineShop } from '@/hooks/use-line-shop'
import type { BookName } from '@/lib/line-shop-types'

export interface BookFilterChipsProps {
  /** Books computed from pre-filter arb rows — passed by parent to keep this component pure. */
  candidateBooks: string[]
}

export function BookFilterChips({ candidateBooks }: BookFilterChipsProps) {
  const { toggleBook, isBookEnabled } = useLineShop()

  if (candidateBooks.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground shrink-0">Books:</span>
      {candidateBooks.map((book) => {
        const enabled = isBookEnabled(book as BookName)
        return (
          <Badge
            key={book}
            variant={enabled ? 'outline' : 'secondary'}
            className={`cursor-pointer select-none transition-opacity ${enabled ? '' : 'opacity-50'}`}
            onClick={() => toggleBook(book as BookName)}
            title={`Click to ${enabled ? 'hide' : 'show'} arbs at ${book}`}
          >
            {book}
          </Badge>
        )
      })}
    </div>
  )
}
