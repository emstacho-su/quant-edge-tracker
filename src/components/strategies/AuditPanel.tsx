/**
 * AuditPanel (05-03 W3.4)
 *
 * Collapsible panel showing audit findings, severity table, and summary.
 * Collapsed by default; chevron toggle.
 */

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AuditScoreChip } from './AuditScoreChip'
import type { AuditFinding } from '@/types/strategies'

/** Sort findings: failed-high > failed-medium > failed-low > passed. */
export function sortFindings(findings: AuditFinding[]): AuditFinding[] {
  const severityOrder = { high: 0, medium: 1, low: 2 }
  return [...findings].sort((a, b) => {
    if (a.pass !== b.pass) return a.pass ? 1 : -1
    return (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1)
  })
}

const SEVERITY_BADGE: Record<string, string> = {
  high: 'text-red-400 font-semibold',
  medium: 'text-amber-400',
  low: 'text-zinc-400',
}

export function AuditPanel({
  score,
  findings,
  summaryMd,
}: {
  score: number | null
  findings: AuditFinding[]
  summaryMd: string
}) {
  const [open, setOpen] = useState(false)

  const sortedFindings = sortFindings(findings)

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Audit</CardTitle>
            <AuditScoreChip score={score} variant="large" />
          </div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={open}
          >
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {open ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          {score === null && (
            <p className="text-sm text-muted-foreground">Audit unavailable for this run.</p>
          )}

          {findings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border/40 text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Rule</th>
                    <th className="py-1.5 pr-3 font-medium">Severity</th>
                    <th className="py-1.5 pr-3 font-medium">Result</th>
                    <th className="py-1.5 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFindings.map((finding, i) => (
                    <tr
                      key={i}
                      className={`border-b border-border/20 ${!finding.pass && finding.severity === 'high' ? 'bg-red-500/5' : !finding.pass ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="py-1.5 pr-3 max-w-[200px] truncate" title={finding.rule}>
                        {finding.rule}
                      </td>
                      <td className={`py-1.5 pr-3 ${SEVERITY_BADGE[finding.severity] ?? ''}`}>
                        {finding.severity}
                      </td>
                      <td className="py-1.5 pr-3">
                        {finding.pass ? (
                          <span className="text-emerald-400">pass</span>
                        ) : (
                          <span className="text-red-400 font-semibold">fail</span>
                        )}
                      </td>
                      <td className="py-1.5 max-w-[300px]">
                        <code className="text-[10px] text-muted-foreground break-words">
                          {finding.evidence}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summaryMd && (
            <div className="prose prose-sm prose-invert max-w-none text-sm text-muted-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summaryMd}</ReactMarkdown>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
