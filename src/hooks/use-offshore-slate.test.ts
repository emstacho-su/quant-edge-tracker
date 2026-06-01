/**
 * Tests for use-offshore-slate.ts
 *
 * Strategy: most assertions target the pure `postUploadSlate` helper directly
 * (no React needed). A small number of hook-level tests confirm state
 * transitions via renderHook + act.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  postUploadSlate,
  useOffshoreSlate,
} from './use-offshore-slate'
import type { UploadRequest, UploadResult } from './use-offshore-slate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_REQ: UploadRequest = {
  book: 'bovada',
  rows: [
    { market_id: 'mkt-1', side: 'home', price_american: -110, point: null },
    { market_id: 'mkt-1', side: 'away', price_american: 115, point: null },
  ],
}

const SAMPLE_RESULT: UploadResult = {
  inserted: 2,
  superseded: 0,
  arbs_detected: 1,
}

/** Build a minimal Response-like mock. */
function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  })
}

// ─── postUploadSlate — pure helper tests ─────────────────────────────────────

describe('postUploadSlate', () => {
  it('(a) returns parsed UploadResult on 200', async () => {
    const mockFetch = makeFetch(200, SAMPLE_RESULT)
    const result = await postUploadSlate(SAMPLE_REQ, mockFetch)
    expect(result).toEqual(SAMPLE_RESULT)
  })

  it('(b) includes credentials:include in the fetch call', async () => {
    const mockFetch = makeFetch(200, SAMPLE_RESULT)
    await postUploadSlate(SAMPLE_REQ, mockFetch)
    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(callArgs[1].credentials).toBe('include')
  })

  it('(b) returns {error} on 400 with the route\'s message', async () => {
    const mockFetch = makeFetch(400, { error: 'invalid book' })
    const result = await postUploadSlate(SAMPLE_REQ, mockFetch)
    expect(result).toEqual({ error: 'invalid book' })
  })

  it('(b) returns {error} on 401 with fallback message when no body error field', async () => {
    const mockFetch = makeFetch(401, {})
    const result = await postUploadSlate(SAMPLE_REQ, mockFetch)
    expect(result).toEqual({ error: 'Upload failed (401)' })
  })

  it('(b) returns {error} on 500 using body message when available', async () => {
    const mockFetch = makeFetch(500, { error: 'internal error' })
    const result = await postUploadSlate(SAMPLE_REQ, mockFetch)
    expect(result).toEqual({ error: 'internal error' })
  })

  it('(c) returns {error} on network failure (rejected fetch promise)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    const result = await postUploadSlate(SAMPLE_REQ, mockFetch)
    expect(result).toEqual({ error: 'Failed to fetch' })
  })
})

// ─── useOffshoreSlate — hook state transition tests ───────────────────────────

describe('useOffshoreSlate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('(d) initial state matches contract', () => {
    const { result } = renderHook(() => useOffshoreSlate())
    expect(result.current.uploading).toBe(false)
    expect(result.current.uploadError).toBeNull()
    expect(result.current.lastUploadResult).toBeNull()
  })

  it('(e) upload() on happy path sets lastUploadResult and clears uploadError', async () => {
    // Stub global fetch so the hook's internal postUploadSlate call succeeds.
    vi.stubGlobal('fetch', makeFetch(200, SAMPLE_RESULT))

    const { result } = renderHook(() => useOffshoreSlate())

    let returnedResult: UploadResult | null = null
    await act(async () => {
      returnedResult = await result.current.upload(SAMPLE_REQ)
    })

    expect(returnedResult).toEqual(SAMPLE_RESULT)
    expect(result.current.lastUploadResult).toEqual(SAMPLE_RESULT)
    expect(result.current.uploadError).toBeNull()
    expect(result.current.uploading).toBe(false)
  })

  it('(e) upload() on 400 error sets uploadError and leaves lastUploadResult null', async () => {
    vi.stubGlobal('fetch', makeFetch(400, { error: 'invalid book' }))

    const { result } = renderHook(() => useOffshoreSlate())

    await act(async () => {
      await result.current.upload(SAMPLE_REQ)
    })

    expect(result.current.uploadError).toBe('invalid book')
    expect(result.current.lastUploadResult).toBeNull()
    expect(result.current.uploading).toBe(false)
  })

  it('(e) upload() on network failure sets uploadError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    const { result } = renderHook(() => useOffshoreSlate())

    await act(async () => {
      await result.current.upload(SAMPLE_REQ)
    })

    expect(result.current.uploadError).toBe('Network down')
    expect(result.current.lastUploadResult).toBeNull()
    expect(result.current.uploading).toBe(false)
  })

  it('(f) reset() clears both uploadError and lastUploadResult', async () => {
    vi.stubGlobal('fetch', makeFetch(200, SAMPLE_RESULT))

    const { result } = renderHook(() => useOffshoreSlate())

    // First upload to populate state.
    await act(async () => {
      await result.current.upload(SAMPLE_REQ)
    })
    expect(result.current.lastUploadResult).toEqual(SAMPLE_RESULT)

    // Now cause an error state.
    vi.stubGlobal('fetch', makeFetch(400, { error: 'invalid book' }))
    await act(async () => {
      await result.current.upload(SAMPLE_REQ)
    })
    expect(result.current.uploadError).toBe('invalid book')

    // reset() clears both.
    act(() => {
      result.current.reset()
    })
    expect(result.current.uploadError).toBeNull()
    expect(result.current.lastUploadResult).toBeNull()
  })
})
