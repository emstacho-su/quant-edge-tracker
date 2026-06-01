/**
 * useOffshoreSlate — hook that owns the POST to /api/line-shop/upload-slate.
 *
 * Per CLAUDE.md "hooks own all writes" invariant, UI components never call
 * the route directly; they destructure { uploading, upload, lastUploadResult,
 * uploadError, reset } from this hook.
 *
 * The pure helper `postUploadSlate` is exported separately so unit tests can
 * exercise the fetch logic without React rendering overhead.
 */

import { useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Matches the AllowedBook union in api/line-shop/upload-slate.ts (D-11). */
export type OffshoreBook = '7stacks' | 'betvegas23' | 'bovada' | 'betus'

/** A single row of an uploaded slate (D-04, D-05). */
export interface UploadRow {
  market_id: string
  side: 'home' | 'away' | 'over' | 'under'
  price_american: number
  point: number | null
}

/** The success response body returned by the route (D-10). */
export interface UploadResult {
  inserted: number
  superseded: number
  arbs_detected: number
}

/** Full request shape mirroring the route's UploadSlateBody. */
export interface UploadRequest {
  book: OffshoreBook
  rows: UploadRow[]
}

/** Return surface of useOffshoreSlate(). */
export interface UseOffshoreSlate {
  uploading: boolean
  uploadError: string | null
  lastUploadResult: UploadResult | null
  /** POST the slate; returns the parsed UploadResult on success, null on error. */
  upload(req: UploadRequest): Promise<UploadResult | null>
  /** Clears uploadError and lastUploadResult without touching uploading. */
  reset(): void
}

// ─── Pure helper (exported for unit tests) ───────────────────────────────────

/**
 * Executes the POST and returns either the parsed UploadResult or an error
 * envelope `{ error: string }`.
 *
 * Accepting `fetchImpl` as a parameter makes this testable without stubbing
 * the global — callers just pass `vi.fn()`.
 */
export async function postUploadSlate(
  req: UploadRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult | { error: string }> {
  try {
    const res = await fetchImpl('/api/line-shop/upload-slate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      credentials: 'include', // httpOnly session cookie must travel with the request
    })

    if (res.ok) {
      const data = (await res.json()) as UploadResult
      return data
    }

    // Non-2xx — try to extract the route's { error } envelope.
    try {
      const body = (await res.json()) as { error?: string }
      return { error: body.error ?? `Upload failed (${res.status})` }
    } catch {
      return { error: `Upload failed (${res.status})` }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' }
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOffshoreSlate(): UseOffshoreSlate {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lastUploadResult, setLastUploadResult] = useState<UploadResult | null>(null)

  const upload = useCallback(async (req: UploadRequest): Promise<UploadResult | null> => {
    setUploading(true)
    setUploadError(null)
    try {
      const result = await postUploadSlate(req)
      if ('error' in result) {
        setUploadError(result.error)
        return null
      }
      setLastUploadResult(result)
      return result
    } finally {
      setUploading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setUploadError(null)
    setLastUploadResult(null)
  }, [])

  return { uploading, uploadError, lastUploadResult, upload, reset }
}
