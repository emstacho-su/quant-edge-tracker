import { useState, useCallback } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ExportBarProps {
  /** Page label, e.g. "Dashboard". Shown in the page-specific button. */
  pageLabel: string
  /** Triggered when the user clicks "Export this page". */
  onExportPage: () => void
  /** Triggered when the user clicks "Export comprehensive". */
  onExportComprehensive: () => void
}

/**
 * Slim horizontal bar shown at the bottom of a page. Two options:
 * - Export the current page's data only
 * - Export comprehensive data across the whole app
 */
export function ExportBar({
  pageLabel,
  onExportPage,
  onExportComprehensive,
}: ExportBarProps) {
  const [busy, setBusy] = useState<'page' | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const wrap = useCallback(
    async (kind: 'page' | 'all', fn: () => void | Promise<void>) => {
      setBusy(kind)
      setError(null)
      try {
        await fn()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Export failed')
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Download className="size-3.5" />
        <span>Export to Excel</span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 flex-1 text-xs sm:min-h-0 sm:flex-none"
          disabled={busy !== null}
          onClick={() => wrap('page', onExportPage)}
        >
          {busy === 'page' ? 'Exporting...' : `Export ${pageLabel}`}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="min-h-11 flex-1 text-xs sm:min-h-0 sm:flex-none"
          disabled={busy !== null}
          onClick={() => wrap('all', onExportComprehensive)}
        >
          {busy === 'all' ? 'Exporting...' : 'Export Comprehensive'}
        </Button>
        {error && <span className="w-full text-xs text-red-500">{error}</span>}
      </div>
    </div>
  )
}
