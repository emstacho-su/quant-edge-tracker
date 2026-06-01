import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock getServiceClient so no real Supabase calls happen in tests.
// Pattern: api/_lib/espn-teams.test.ts (vi.mock with ESM .js extension)
// ---------------------------------------------------------------------------

// Capture all calls for assertion
const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn()
const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockEq = vi.fn()

// We need .update().eq() to return { error: null }
// Chainable mock: update() returns { eq: mockEq }
mockEq.mockResolvedValue({ error: null })
mockUpdate.mockReturnValue({ eq: mockEq })

function makeMockSupabase() {
  return {
    from: vi.fn((_table: string) => ({
      upsert: mockUpsert,
      update: mockUpdate,
      insert: mockInsert,
      eq: mockEq,
    })),
  }
}

vi.mock('./supabase-admin.js', () => ({
  getServiceClient: () => makeMockSupabase(),
}))

// Import AFTER the mock is set up (ESM hoisting handled by vi.mock)
import {
  upsertPlayers,
  upsertTeamAlias,
  writeBetResolution,
  markResolutionQueueDone,
} from './entity-write.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface PlayerRow {
  espn_id: string
  sport: string
  full_name: string
  short_name?: string
  team_espn_id?: string | null
  position?: string
  jersey?: string
  active?: boolean
  source?: string
  source_id?: string | null
  agent_derived?: boolean
  updated_at?: string
}

function makePlayer(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    espn_id: 'espn-123',
    sport: 'MLB',
    full_name: 'Aaron Nola',
    short_name: 'A. Nola',
    team_espn_id: '22',
    position: 'P',
    jersey: '27',
    active: true,
    source: 'mlb_statsapi',
    source_id: '605400',
    agent_derived: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockEq.mockResolvedValue({ error: null })
  mockUpdate.mockReturnValue({ eq: mockEq })
  mockUpsert.mockResolvedValue({ error: null })
  mockInsert.mockResolvedValue({ error: null })
})

// ---------------------------------------------------------------------------
// upsertPlayers
// ---------------------------------------------------------------------------

describe('upsertPlayers', () => {
  it('calls .from("players").upsert with onConflict espn_id', async () => {
    const players = [makePlayer()]
    const result = await upsertPlayers(players)
    expect(result.ok).toBe(true)
    expect(mockUpsert).toHaveBeenCalledOnce()
    const [rows, opts] = mockUpsert.mock.calls[0]
    expect(opts).toMatchObject({ onConflict: 'espn_id' })
    // Each row should have updated_at stamped
    expect(rows[0]).toHaveProperty('updated_at')
  })

  it('returns ok:false with error message when upsert fails', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'constraint violation' } })
    const result = await upsertPlayers([makePlayer()])
    expect(result.ok).toBe(false)
    expect(result.error).toBe('constraint violation')
  })
})

// ---------------------------------------------------------------------------
// upsertTeamAlias
// ---------------------------------------------------------------------------

describe('upsertTeamAlias', () => {
  it('calls .from("team_aliases").upsert with onConflict team_id,alias', async () => {
    const result = await upsertTeamAlias('team-uuid-abc', 'cards', 'seed')
    expect(result.ok).toBe(true)
    expect(mockUpsert).toHaveBeenCalledOnce()
    const [row, opts] = mockUpsert.mock.calls[0]
    expect(opts).toMatchObject({ onConflict: 'team_id,alias' })
    expect(row).toMatchObject({ team_id: 'team-uuid-abc', alias: 'cards', source: 'seed' })
  })

  it('returns ok:false when upsert fails', async () => {
    mockUpsert.mockResolvedValueOnce({ error: { message: 'unique violation' } })
    const result = await upsertTeamAlias('team-uuid-abc', 'cards', 'manual')
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// agent-derived tag (D-13)
// ---------------------------------------------------------------------------

describe('upsertTeamAlias — agent-derived', () => {
  it('passes source:"agent_derived" through to the upsert row (D-13 tag)', async () => {
    const result = await upsertTeamAlias('team-uuid-xyz', 'stl birds', 'agent_derived')
    expect(result.ok).toBe(true)
    const [row] = mockUpsert.mock.calls[0]
    expect(row.source).toBe('agent_derived')
    expect(row.alias).toBe('stl birds')
    expect(row.team_id).toBe('team-uuid-xyz')
  })
})

// ---------------------------------------------------------------------------
// writeBetResolution
// ---------------------------------------------------------------------------

describe('writeBetResolution', () => {
  it('calls .from("bets").update({entity_espn_id, entity_resolution_status, entity_type, entity_confidence}).eq("id", betId)', async () => {
    const resolution = {
      espn_id: 'espn-24',
      name: 'St. Louis Cardinals',
      confidence: 0.95,
      tier: 1 as const,
      entity_type: 'team' as const,
    }
    const result = await writeBetResolution('bet-abc-123', resolution)
    expect(result.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalledOnce()
    const [updatePayload] = mockUpdate.mock.calls[0]
    expect(updatePayload).toMatchObject({
      entity_espn_id: 'espn-24',
      entity_type: 'team',
      entity_confidence: 0.95,
    })
    expect(mockEq).toHaveBeenCalledWith('id', 'bet-abc-123')
  })

  it('stamps entity_resolution_status = "agent_derived" when resolution has tier 2 and caller sets agent_derived', async () => {
    // The writeBetResolution function uses the resolution.entity_resolution_status if provided
    // or derives from tier. When called from the agent write-back, status is passed explicitly.
    const resolution = {
      espn_id: 'espn-24',
      name: 'St. Louis Cardinals',
      confidence: 0.92,
      tier: 2 as const,
      entity_type: 'team' as const,
      entity_resolution_status: 'agent_derived' as const,
    }
    const result = await writeBetResolution('bet-agent-456', resolution)
    expect(result.ok).toBe(true)
    const [updatePayload] = mockUpdate.mock.calls[0]
    expect(updatePayload.entity_resolution_status).toBe('agent_derived')
  })

  it('returns ok:false when update fails', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'row not found' } })
    const resolution = {
      espn_id: 'espn-24', name: 'Cards', confidence: 1, tier: 1 as const,
      entity_type: 'team' as const,
    }
    const result = await writeBetResolution('bet-missing', resolution)
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// markResolutionQueueDone
// ---------------------------------------------------------------------------

describe('markResolutionQueueDone', () => {
  it('calls .from("entity_resolution_queue").update({status:"resolved", result_espn_id, resolved_at}).eq("id", queueId)', async () => {
    const result = await markResolutionQueueDone('queue-id-abc', 'espn-24')
    expect(result.ok).toBe(true)
    expect(mockUpdate).toHaveBeenCalledOnce()
    const [updatePayload] = mockUpdate.mock.calls[0]
    expect(updatePayload).toMatchObject({
      status: 'resolved',
      result_espn_id: 'espn-24',
    })
    expect(updatePayload).toHaveProperty('resolved_at')
    expect(mockEq).toHaveBeenCalledWith('id', 'queue-id-abc')
  })

  it('returns ok:false when update fails', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'queue row not found' } })
    const result = await markResolutionQueueDone('queue-bad', 'espn-24')
    expect(result.ok).toBe(false)
  })
})
