/**
 * DiffViewer — renders a unified diff using react-diff-viewer-continued (05-05 W4.3).
 *
 * Parses the unified diff text into before/after content per file, then renders
 * one <ReactDiffViewer> per file patch.
 */

import { useMemo } from 'react'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { parsePatch } from 'diff'

// ---------------------------------------------------------------------------
// Media query hook (inline — avoids adding a dep just for one value)
// ---------------------------------------------------------------------------

function useIsMobile(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 768px)').matches
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FilePatch {
  fileName: string
  oldContent: string
  newContent: string
}

/**
 * Parse a unified diff into per-file before/after content strings.
 * Handles the case where the diff has no old file (new file creation).
 */
function parseFilePatch(diffText: string): FilePatch[] {
  let patches
  try {
    patches = parsePatch(diffText)
  } catch {
    return []
  }

  return patches.map((patch) => {
    const fileName = (patch.newFileName ?? patch.oldFileName ?? 'unknown')
      .replace(/^[ab]\//, '') // strip a/ or b/ prefix

    // Reconstruct old and new content from hunk lines.
    // This is sufficient for rendering; we don't need perfect line number accuracy.
    const oldLines: string[] = []
    const newLines: string[] = []

    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        const type = line[0]
        const content = line.slice(1)
        if (type === ' ') {
          oldLines.push(content)
          newLines.push(content)
        } else if (type === '-') {
          oldLines.push(content)
        } else if (type === '+') {
          newLines.push(content)
        }
      }
    }

    return {
      fileName,
      oldContent: oldLines.join('\n'),
      newContent: newLines.join('\n'),
    }
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DiffViewerProps {
  diff: string
  viewMode?: 'split' | 'unified'
}

export function DiffViewer({ diff, viewMode }: DiffViewerProps) {
  const isMobile = useIsMobile()
  const splitView = viewMode === 'split' || (viewMode === undefined && !isMobile)

  const filePatch = useMemo(() => parseFilePatch(diff), [diff])

  if (filePatch.length === 0) {
    return (
      <div className="rounded border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Unable to render diff.
      </div>
    )
  }

  return (
    <div className="rounded overflow-hidden border border-border/50 text-xs">
      {filePatch.map((fp, idx) => (
        <div key={idx}>
          {filePatch.length > 1 && (
            <div className="bg-muted/40 px-3 py-1 text-xs font-mono text-muted-foreground border-b border-border/50">
              {fp.fileName}
            </div>
          )}
          <ReactDiffViewer
            oldValue={fp.oldContent}
            newValue={fp.newContent}
            splitView={splitView}
            hideLineNumbers={false}
            useDarkTheme
            styles={{
              variables: {
                dark: {
                  diffViewerBackground: 'hsl(var(--muted)/0.3)',
                  addedBackground: 'hsl(142 71% 45% / 0.15)',
                  addedColor: 'hsl(142 71% 65%)',
                  removedBackground: 'hsl(0 84% 60% / 0.15)',
                  removedColor: 'hsl(0 84% 70%)',
                  wordAddedBackground: 'hsl(142 71% 45% / 0.25)',
                  wordRemovedBackground: 'hsl(0 84% 60% / 0.25)',
                  codeFoldBackground: 'hsl(var(--muted)/0.5)',
                  gutterColor: 'hsl(var(--muted-foreground))',
                  gutterBackground: 'hsl(var(--muted)/0.4)',
                },
              },
            }}
          />
        </div>
      ))}
    </div>
  )
}
