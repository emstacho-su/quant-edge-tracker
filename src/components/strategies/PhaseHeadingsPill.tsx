/**
 * PhaseHeadingsPill (05-03 W3.5)
 *
 * Parses the most recent `### Phase N -- name` heading from streaming markdown
 * and renders it as a small pill. Used in RunViewer while status='running'.
 */

const PHASE_RE_SOURCE = /^###\s+Phase\s+(\d+[a-z]?)\s+—\s+(.+)$/m.source

/**
 * Extract the most recent phase heading from partial markdown output.
 * Pure function - exported for unit testing.
 */
export function extractLastPhaseHeading(outputMd: string): { phase: string; name: string } | null {
  let last: { phase: string; name: string } | null = null
  let match: RegExpExecArray | null
  const re = new RegExp(PHASE_RE_SOURCE, 'gm')
  while ((match = re.exec(outputMd)) !== null) {
    last = { phase: match[1], name: match[2].trim() }
  }
  return last
}

export function PhaseHeadingsPill({ outputMd }: { outputMd: string }) {
  const parsed = extractLastPhaseHeading(outputMd)

  return (
    <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-400">
      {parsed ? `Phase ${parsed.phase} — ${parsed.name}` : 'Initializing…'}
    </span>
  )
}
