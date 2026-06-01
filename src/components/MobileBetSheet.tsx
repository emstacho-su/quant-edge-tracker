import type { Bet, LegDraft } from '@/lib/types'
import { EditBetForm } from '@/components/EditBetForm'
import { useViewport } from '@/hooks/useViewport'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface MobileBetSheetProps {
  bet: Bet | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (patch: {
    stake?: number
    odds_american?: number | null
    status?: Bet['status']
    bet_type?: 'single' | 'parlay'
    legs?: LegDraft[]
    description?: string
  }) => Promise<void>
}

/**
 * Wraps EditBetForm in a sheet popout — bottom drawer on mobile, right-side
 * panel on desktop. BetLog/DailyReport gate this behind `isMobile` and inline
 * EditBetForm in their table row context themselves; the Today page (card grid)
 * has no row context so it uses this wrapper for both viewports.
 */
export function MobileBetSheet({ bet, open, onOpenChange, onSave }: MobileBetSheetProps) {
  const { isMobile } = useViewport()

  if (!bet) return null

  const side = isMobile ? 'bottom' : 'right'
  const contentClass = isMobile
    ? 'max-h-[85vh] overflow-y-auto rounded-t-xl pb-6'
    : 'h-full w-full sm:max-w-md overflow-y-auto pb-6'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={contentClass}>
        <SheetHeader>
          <SheetTitle>Edit bet</SheetTitle>
          <SheetDescription className="line-clamp-2">
            {bet.sport} — {bet.description}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <EditBetForm
            bet={bet}
            onSave={async (patch) => {
              await onSave(patch)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
