/**
 * ArbPanel tests — vitest + RTL + jsdom
 *
 * @vitest-environment jsdom
 *
 * Covers (21-08):
 *   D-12: Upload button rendered and auth-gated.
 *   D-12: Clicking Upload button opens UploadSlateModal.
 *   D-12: onSuccess from modal closes modal and calls onRefresh.
 *   D-03: BookFilterChips renders one chip per candidateBook.
 *   D-03: Toggling chip calls toggleBook.
 *   D-09: ArbLegRow renders manual badge when sourceConfidence='manual'.
 *   D-09: ArbLegRow does NOT render manual badge when sourceConfidence='api'.
 *
 * NOTE: Uses plain vitest assertions (no @testing-library/jest-dom) to match
 *       the project test convention.
 */

// ─── Mocks — declared before any import of the tested module ─────────────────

import { vi } from 'vitest'

vi.mock('@/hooks/use-line-shop', () => ({
  ARB_STALE_MINUTES: 10,
  ARB_MIN_RETURN_DEFAULT: 0.5,
  useLineShop: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./UploadSlateModal', () => ({
  UploadSlateModal: vi.fn(() => null),
}))

vi.mock('@/lib/demo-mode', () => ({
  USD: { format: (n: number) => `$${n.toFixed(2)}` },
}))

vi.mock('@/lib/kalshi-fee', () => ({
  kalshiEffectiveDecimalOdds: (dec: number) => dec,
}))

vi.mock('@/lib/clv', () => ({
  formatOdds: (n: number) => (n > 0 ? `+${n}` : String(n)),
  americanToDecimal: (n: number) => (n > 0 ? (n + 100) / 100 : (100 - n) / -n),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ArbPanel } from './ArbPanel'
import { BookFilterChips } from './BookFilterChips'
import { useLineShop } from '@/hooks/use-line-shop'
import { useAuth } from '@/lib/auth'
import { UploadSlateModal } from './UploadSlateModal'
import type { ArbRow } from '@/hooks/use-line-shop'

// ─── Type casts ───────────────────────────────────────────────────────────────

const mockUseLineShop = useLineShop as ReturnType<typeof vi.fn>
const mockUseAuth = useAuth as ReturnType<typeof vi.fn>
const MockUploadSlateModal = UploadSlateModal as ReturnType<typeof vi.fn>

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeArbRow(overrides: Partial<ArbRow> = {}): ArbRow {
  return {
    id: 'row-1',
    market_id: 'mkt-1',
    side_a: 'home',
    side_a_book: 'pinnacle',
    side_a_price: -110,
    side_a_stake_pct: 0.5,
    side_b: 'away',
    side_b_book: '7stacks',
    side_b_price: 115,
    side_b_stake_pct: 0.5,
    total_return_pct: 1.2,
    detected_at: new Date().toISOString(),
    status: 'detected',
    markets: {
      sport: 'MLB',
      event_name: 'NYY @ BOS',
      market_type: 'moneyline',
      market_param: null,
      event_start: new Date().toISOString(),
    },
    ageMinutes: 2,
    isStale: false,
    stakeA: 52,
    stakeB: 48,
    side_a_source_confidence: null,
    side_b_source_confidence: null,
    side_a_uploaded_at: null,
    side_b_uploaded_at: null,
    side_a_kalshi_fee: 0,
    side_b_kalshi_fee: 0,
    kalshi_fee_total: 0,
    ...overrides,
  }
}

function defaultLineShopReturn(overrides = {}) {
  return {
    allArbBooks: ['7stacks', 'pinnacle'],
    enabledBooks: ['pinnacle', '7stacks', 'bovada', 'draftkings'],
    toggleBook: vi.fn(),
    isBookEnabled: vi.fn().mockReturnValue(true),
    ...overrides,
  }
}

function defaultAuthReturn(authenticated = true) {
  return {
    loading: false,
    authenticated,
    promptLogin: vi.fn(),
    user: authenticated ? 'evan' : null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    _dialogOpen: false,
    _setDialogOpen: vi.fn(),
  }
}

// ─── ArbPanel tests ───────────────────────────────────────────────────────────

describe('ArbPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLineShop.mockReturnValue(defaultLineShopReturn())
    mockUseAuth.mockReturnValue(defaultAuthReturn(true))
    // Default: modal stub records its props
    MockUploadSlateModal.mockImplementation(({ open, onSuccess }: { open: boolean; onSuccess?: () => void }) => {
      if (!open) return null
      return (
        <div data-testid="upload-modal-open">
          <button data-testid="modal-success-btn" onClick={() => onSuccess?.()}>
            Trigger Success
          </button>
        </div>
      )
    })
  })

  afterEach(() => {
    cleanup()
  })

  const defaultProps = {
    rows: [makeArbRow()],
    loading: false,
    error: null,
    totalStake: 100,
    onTotalStakeChange: vi.fn(),
    minReturnPct: 0.5,
    onMinReturnPctChange: vi.fn(),
    onRefresh: vi.fn(),
  }

  // (a) Upload button visible when authenticated
  it('(a) renders Upload offshore slate button when authenticated', () => {
    render(<ArbPanel {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /upload offshore slate/i })
    expect(btn).toBeTruthy()
  })

  // (b) Upload button hidden (replaced by AuthActions sign-in chip) when unauthed
  it('(b) shows sign-in chip instead of Upload button when not authenticated', () => {
    mockUseAuth.mockReturnValue(defaultAuthReturn(false))
    render(<ArbPanel {...defaultProps} />)
    // Upload button should NOT be present as a full button
    const uploadBtns = screen.queryAllByRole('button', { name: /upload offshore slate/i })
    expect(uploadBtns).toHaveLength(0)
    // Sign-in chip should be present (AuthActions renders it)
    const signInChip = screen.getByTitle('Sign in to edit')
    expect(signInChip).toBeTruthy()
  })

  // (c) Clicking Upload button opens modal (open={true})
  it('(c) clicking Upload button opens UploadSlateModal', () => {
    render(<ArbPanel {...defaultProps} />)
    const btn = screen.getByRole('button', { name: /upload offshore slate/i })
    fireEvent.click(btn)
    const modal = screen.getByTestId('upload-modal-open')
    expect(modal).toBeTruthy()
  })

  // (d) onSuccess from modal triggers onRefresh
  it('(d) onSuccess from modal closes modal and calls onRefresh', () => {
    const onRefresh = vi.fn()
    render(<ArbPanel {...defaultProps} onRefresh={onRefresh} />)

    // Open the modal
    const btn = screen.getByRole('button', { name: /upload offshore slate/i })
    fireEvent.click(btn)

    // Trigger onSuccess
    const successBtn = screen.getByTestId('modal-success-btn')
    fireEvent.click(successBtn)

    expect(onRefresh).toHaveBeenCalledTimes(1)
    // Modal should close (no longer open)
    const modal = screen.queryByTestId('upload-modal-open')
    expect(modal).toBeNull()
  })
})

// ─── ArbLegRow badge tests (via ArbPanel rendering) ──────────────────────────

describe('ArbPanel — manual badge in ArbLegRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLineShop.mockReturnValue(defaultLineShopReturn())
    mockUseAuth.mockReturnValue(defaultAuthReturn(true))
    MockUploadSlateModal.mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  // (e) manual badge rendered when source_confidence='manual'
  it('(e) renders manual badge on side_b leg when side_b_source_confidence=manual', () => {
    const row = makeArbRow({
      side_b_source_confidence: 'manual',
      side_b_uploaded_at: '2026-05-27T12:00:00Z',
    })
    render(
      <ArbPanel
        rows={[row]}
        loading={false}
        error={null}
        totalStake={100}
        onTotalStakeChange={vi.fn()}
        minReturnPct={0.5}
        onMinReturnPctChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    // Find badge with text 'manual'
    const badges = screen.getAllByText('manual')
    expect(badges.length).toBeGreaterThanOrEqual(1)
    // The badge should have a title attribute mentioning ET
    const badgeWithTitle = badges.find((el) => el.getAttribute('title')?.includes('ET'))
    expect(badgeWithTitle).toBeTruthy()
  })

  // (f) manual badge NOT rendered when source_confidence='api'
  it('(f) does NOT render manual badge when side_b_source_confidence=api', () => {
    const row = makeArbRow({ side_b_source_confidence: 'api' })
    render(
      <ArbPanel
        rows={[row]}
        loading={false}
        error={null}
        totalStake={100}
        onTotalStakeChange={vi.fn()}
        minReturnPct={0.5}
        onMinReturnPctChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    const manualTexts = screen.queryAllByText('manual')
    expect(manualTexts).toHaveLength(0)
  })
})

// ─── BookFilterChips tests ────────────────────────────────────────────────────

describe('BookFilterChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // (g) renders one chip per distinct candidateBook
  it('(g) renders one chip per book in candidateBooks', () => {
    const toggleBook = vi.fn()
    mockUseLineShop.mockReturnValue({
      enabledBooks: ['pinnacle', '7stacks'],
      toggleBook,
      isBookEnabled: (b: string) => ['pinnacle', '7stacks'].includes(b),
    })
    render(<BookFilterChips candidateBooks={['pinnacle', '7stacks']} />)
    expect(screen.getByText('pinnacle')).toBeTruthy()
    expect(screen.getByText('7stacks')).toBeTruthy()
  })

  // (g) toggling chip calls toggleBook
  it('(g) clicking a chip calls toggleBook with the book name', () => {
    const toggleBook = vi.fn()
    mockUseLineShop.mockReturnValue({
      enabledBooks: ['pinnacle', '7stacks'],
      toggleBook,
      isBookEnabled: () => true,
    })
    render(<BookFilterChips candidateBooks={['pinnacle', '7stacks']} />)
    fireEvent.click(screen.getByText('pinnacle'))
    expect(toggleBook).toHaveBeenCalledWith('pinnacle')
  })

  // renders nothing when candidateBooks is empty
  it('renders null when candidateBooks is empty', () => {
    mockUseLineShop.mockReturnValue({
      enabledBooks: [],
      toggleBook: vi.fn(),
      isBookEnabled: () => false,
    })
    const { container } = render(<BookFilterChips candidateBooks={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
