/**
 * UploadSlateModal tests — vitest + RTL + jsdom
 *
 * @vitest-environment jsdom
 *
 * Covers:
 *   D-05: book picker renders before textarea; textarea disabled until book selected.
 *   D-11: only the four registered offshore books appear in the picker.
 *   D-04: Parse button invokes parseOffshoreSlate(book, text).
 *   D-06: fix-up table surfaces unparsed rows with editable fields + Drop action.
 *   D-12: onSuccess fires with route summary on confirm-success; onOpenChange(false) called.
 *   Error state surfaced from useOffshoreSlate.
 *
 * NOTE: Uses plain vitest assertions (no @testing-library/jest-dom) to match
 *       the project test convention.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'

// ─── Mocks — declared before any import of the tested module ─────────────────

vi.mock('@/utils/offshore-slate-parser', () => ({
  parseOffshoreSlate: vi.fn(),
}))

vi.mock('@/hooks/use-offshore-slate', () => ({
  useOffshoreSlate: vi.fn(),
}))

vi.mock('@/components/line-shop/__fixtures__/markets-lookup', () => ({
  resolveMarketId: vi.fn(),
  inferMarketType: vi.fn(),
  FIXTURE_MARKETS: [],
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { parseOffshoreSlate } from '@/utils/offshore-slate-parser'
import { useOffshoreSlate } from '@/hooks/use-offshore-slate'
import { resolveMarketId, inferMarketType } from '@/components/line-shop/__fixtures__/markets-lookup'
import { UploadSlateModal } from './UploadSlateModal'

// ─── Type casts ───────────────────────────────────────────────────────────────

const mockParse = parseOffshoreSlate as ReturnType<typeof vi.fn>
const mockUseHook = useOffshoreSlate as ReturnType<typeof vi.fn>
const mockResolve = resolveMarketId as ReturnType<typeof vi.fn>
const mockInfer = inferMarketType as ReturnType<typeof vi.fn>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHook(overrides: Record<string, unknown> = {}) {
  return {
    uploading: false,
    uploadError: null,
    lastUploadResult: null,
    upload: vi.fn().mockResolvedValue(null),
    reset: vi.fn(),
    ...overrides,
  }
}

function renderModal(props: {
  open?: boolean
  onOpenChange?: (v: boolean) => void
  onSuccess?: (r: { inserted: number; superseded: number; arbs_detected: number }) => void
} = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn()
  const onSuccess = props.onSuccess ?? vi.fn()
  return {
    onOpenChange,
    onSuccess,
    ...render(
      <UploadSlateModal
        open={props.open ?? true}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />,
    ),
  }
}

/**
 * Open the book Select dropdown and click the option with the given label.
 * base-ui renders the popup in a portal (document.body). We click the trigger,
 * then wait for options to appear (they render asynchronously via the portal),
 * then click the target option.
 */
async function selectBook(bookLabel: string) {
  const trigger = screen.getByTestId('book-select-trigger')
  await act(async () => {
    fireEvent.click(trigger)
  })
  // Wait for options to appear in the portal.
  const option = await screen.findByRole('option', { name: bookLabel })
  await act(async () => {
    fireEvent.click(option)
  })
  // Allow React state updates from the selection to flush.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

/** One parsed row fixture. */
const PARSED_ROW_NYY = {
  rawLine: 'NYY -130',
  sport: 'mlb',
  side: 'home',
  point: null,
  priceAmerican: -130,
  eventNameHint: 'Yankees',
  parseConfidence: 'high',
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockUseHook.mockReturnValue(makeHook())
  mockParse.mockReturnValue({ parsed: [], unparsed: [] })
  mockResolve.mockResolvedValue(null)
  mockInfer.mockReturnValue('moneyline')
})

afterEach(() => {
  cleanup()
})

// ─── D-05: Book picker ordering + textarea gating ────────────────────────────

describe('UploadSlateModal — book picker first (D-05)', () => {
  it('renders book picker before paste area', () => {
    renderModal()

    const trigger = screen.getByTestId('book-select-trigger')
    const textarea = screen.getByRole('textbox')

    expect(trigger).toBeTruthy()
    expect(textarea).toBeTruthy()

    // Book trigger must appear before the textarea in DOM order (D-05).
    // DOCUMENT_POSITION_FOLLOWING (4) = textarea comes after trigger.
    const pos = trigger.compareDocumentPosition(textarea)
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('paste textarea is disabled until a book is selected (D-05)', () => {
    renderModal()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
  })

  it('textarea becomes enabled after selecting a book', async () => {
    renderModal()

    const textareaBefore = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textareaBefore.disabled).toBe(true)

    await selectBook('7stacks')

    await waitFor(() => {
      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
      expect(textarea.disabled).toBe(false)
    })
  })
})

// ─── D-11: Fixed book set ─────────────────────────────────────────────────────

describe('UploadSlateModal — fixed book set (D-11)', () => {
  it('shows exactly the four offshore books in the picker', async () => {
    renderModal()

    fireEvent.click(screen.getByTestId('book-select-trigger'))

    // All four labels must appear in the portal-rendered dropdown.
    await waitFor(() => {
      expect(screen.getByText('7stacks')).toBeTruthy()
      expect(screen.getByText('betvegas23')).toBeTruthy()
      expect(screen.getByText('Bovada')).toBeTruthy()
      expect(screen.getByText('BetUS')).toBeTruthy()
    })

    // Exactly four option elements (role=option) — no extras.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
  })
})

// ─── D-04: Parse invocation ───────────────────────────────────────────────────

describe('UploadSlateModal — Parse invocation (D-04)', () => {
  it('calls parseOffshoreSlate with the selected book and text on Parse click', async () => {
    mockParse.mockReturnValue({ parsed: [], unparsed: [] })

    renderModal()

    // Select '7stacks' — same as other tests; Bovada is tested via D-11.
    await selectBook('7stacks')

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'New York Yankees -130' } })

    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    expect(mockParse).toHaveBeenCalledWith('7stacks', 'New York Yankees -130')
  })
})

// ─── D-06: Fix-up table ───────────────────────────────────────────────────────

describe('UploadSlateModal — fix-up table (D-06)', () => {
  /** Navigate to the review step with one parsed + one unparsed row. */
  async function gotoReview() {
    await selectBook('7stacks')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'some slate text' } })

    mockParse.mockReturnValue({
      parsed: [PARSED_ROW_NYY],
      unparsed: [{ line: 'GARBAGE', reason: 'no odds found' }],
    })

    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    await waitFor(() => {
      expect(screen.getByText('GARBAGE')).toBeTruthy()
    })
  }

  it('fix-up table surfaces unparsed rows with Drop button (D-06)', async () => {
    renderModal()
    await gotoReview()

    // Raw line visible.
    expect(screen.getByText('GARBAGE')).toBeTruthy()
    // Reason visible.
    expect(screen.getByText('no odds found')).toBeTruthy()
    // At least one Drop button.
    const dropButtons = screen.getAllByRole('button', { name: /drop/i })
    expect(dropButtons.length).toBeGreaterThanOrEqual(1)
  })

  it('dropping a row removes it from the upload payload (D-06)', async () => {
    mockResolve.mockResolvedValue('aaaaaaaa-0001-0000-0000-000000000001')
    mockInfer.mockReturnValue('moneyline')

    const uploadFn = vi.fn().mockResolvedValue({
      inserted: 1,
      superseded: 0,
      arbs_detected: 0,
    })
    mockUseHook.mockReturnValue(makeHook({ upload: uploadFn }))

    mockParse.mockReturnValue({
      parsed: [
        PARSED_ROW_NYY,
        {
          rawLine: 'BOS +110',
          sport: 'mlb',
          side: 'away',
          point: null,
          priceAmerican: 110,
          eventNameHint: 'Red Sox',
          parseConfidence: 'high',
        },
      ],
      unparsed: [],
    })

    renderModal()

    await selectBook('7stacks')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'some text' } })
    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    await waitFor(() => {
      expect(screen.getByText('NYY -130')).toBeTruthy()
    })

    // Wait for market resolution.
    await waitFor(() => expect(mockResolve).toHaveBeenCalled())

    // Drop the first row.
    const dropButtons = screen.getAllByRole('button', { name: /drop/i })
    fireEvent.click(dropButtons[0])

    // Confirm enabled once 1 resolved row remains.
    await waitFor(() => {
      const confirmBtn = screen.getByRole('button', { name: /confirm upload/i })
      expect((confirmBtn as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: /confirm upload/i }))

    await waitFor(() => expect(uploadFn).toHaveBeenCalled())
    const call = uploadFn.mock.calls[0][0]
    // Only 1 row in payload (not 2).
    expect(call.rows).toHaveLength(1)
  })

  it('cannot confirm when no kept rows have a resolved market_id', async () => {
    mockResolve.mockResolvedValue(null)
    mockInfer.mockReturnValue('moneyline')

    mockParse.mockReturnValue({
      parsed: [PARSED_ROW_NYY],
      unparsed: [],
    })

    renderModal()

    await selectBook('7stacks')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NYY -130' } })
    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    await waitFor(() => expect(screen.getByText('NYY -130')).toBeTruthy())

    // Wait for resolution attempt.
    await waitFor(() => expect(mockResolve).toHaveBeenCalled())
    await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

    const confirmBtn = screen.getByRole('button', { name: /confirm upload/i }) as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)
  })
})

// ─── D-12: onSuccess callback ─────────────────────────────────────────────────

describe('UploadSlateModal — onSuccess callback (D-12)', () => {
  it('calls onSuccess with the result and onOpenChange(false) after successful upload', async () => {
    const successResult = { inserted: 2, superseded: 1, arbs_detected: 3 }
    const uploadFn = vi.fn().mockResolvedValue(successResult)
    mockUseHook.mockReturnValue(makeHook({ upload: uploadFn }))

    mockResolve.mockResolvedValue('aaaaaaaa-0001-0000-0000-000000000001')
    mockInfer.mockReturnValue('moneyline')

    mockParse.mockReturnValue({
      parsed: [PARSED_ROW_NYY],
      unparsed: [],
    })

    const onSuccess = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <UploadSlateModal open={true} onOpenChange={onOpenChange} onSuccess={onSuccess} />,
    )

    await selectBook('7stacks')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NYY -130' } })
    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    await waitFor(() => expect(screen.getByText('NYY -130')).toBeTruthy())
    await waitFor(() => expect(mockResolve).toHaveBeenCalled())

    await waitFor(() => {
      const confirmBtn = screen.getByRole('button', { name: /confirm upload/i }) as HTMLButtonElement
      expect(confirmBtn.disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: /confirm upload/i }))

    await waitFor(() => expect(uploadFn).toHaveBeenCalled())
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(successResult))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

// ─── Error state ──────────────────────────────────────────────────────────────

describe('UploadSlateModal — error state', () => {
  it('surfaces uploadError from the hook in a banner on the review step', async () => {
    mockUseHook.mockReturnValue(
      makeHook({
        upload: vi.fn().mockResolvedValue(null),
        uploadError: 'Upload failed (401)',
      }),
    )
    mockResolve.mockResolvedValue('aaaaaaaa-0001-0000-0000-000000000001')
    mockInfer.mockReturnValue('moneyline')

    mockParse.mockReturnValue({
      parsed: [PARSED_ROW_NYY],
      unparsed: [],
    })

    renderModal()

    await selectBook('7stacks')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'NYY -130' } })
    fireEvent.click(screen.getByRole('button', { name: /parse/i }))

    await waitFor(() => expect(screen.getByText('NYY -130')).toBeTruthy())

    // Error banner must be visible on the review step.
    expect(screen.getByText('Upload failed (401)')).toBeTruthy()
  })
})
