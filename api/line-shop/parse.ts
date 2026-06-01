/**
 * POST /api/line-shop/parse
 *
 * Parses a free-text sports pick into a structured market object.
 *
 * Flow:
 *   1. Validate: POST + non-empty text (400 otherwise)
 *   2. Run precheckParse (deterministic, free) — SHOP-02, D-03
 *      - If confidence >= 0.75: return { parsed, confidence, needsFallback: false }
 *      - Saves LLM credits for already-structured text (T-09-05)
 *   3. If no ANTHROPIC_API_KEY: return { parsed: null, confidence: 0, needsFallback: true }
 *      (SHOP-07 graceful degradation — never throws)
 *   4. Call Claude Haiku 4.5 via tool_use with a typed input_schema
 *      - NOT the structured-outputs beta header (not GA on Haiku 4.5 — RESEARCH State of the Art)
 *      - max_tokens: 256 (limits per-call credit spend — T-09-05)
 *   5. Return { parsed, confidence, needsFallback: confidence < 0.75 }
 *
 * Security:
 *   - ANTHROPIC_API_KEY read from process.env ONLY (never VITE_-prefixed) — T-09-04
 *   - Key is never logged
 *   - Input validated non-empty before any LLM call — T-09-06 / V5 ASVS
 */

import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { precheckParse } from '../_lib/parse-utils.js'

// ---------------------------------------------------------------------------
// tool_use schema — typed input_schema for Claude Haiku 4.5
// Do NOT use anthropic-beta structured-outputs-* header (not GA on Haiku 4.5)
// ---------------------------------------------------------------------------

const PARSE_TOOL: Anthropic.Tool = {
  name: 'parse_sports_pick',
  description: 'Extract structured market data from a free-text sports pick',
  input_schema: {
    type: 'object' as const,
    properties: {
      sport: {
        type: 'string' as const,
        enum: ['MLB', 'NBA', 'NFL', 'NHL', 'PGA', 'ATP', 'WTA', 'EPL', 'UFC'],
        description: 'Sport league abbreviation',
      },
      home_team: { type: 'string' as const, description: 'Home team name or null' },
      away_team: { type: 'string' as const, description: 'Away team name or null' },
      market: {
        type: 'string' as const,
        enum: ['moneyline', 'spread', 'total', 'team_total', 'runline', 'puckline'],
        description: 'Bet market type',
      },
      side: {
        type: 'string' as const,
        enum: ['home', 'away', 'over', 'under'],
        description: 'Which side of the market the pick is on',
      },
      line: {
        type: ['number', 'null'] as unknown as 'number',
        description: 'Spread or total line value (null for moneyline)',
      },
      price: {
        type: ['integer', 'null'] as unknown as 'integer',
        description: 'American odds (e.g. -110, +130)',
      },
      confidence: {
        type: 'number' as const,
        minimum: 0,
        maximum: 1,
        description: 'How confident (0-1) the parse is. Set below 0.75 if ambiguous.',
      },
      parse_notes: {
        type: 'string' as const,
        description: 'Notes about ambiguity or assumptions made during parsing',
      },
    },
    required: ['sport', 'market', 'side', 'confidence'],
  },
}

const SYSTEM_PROMPT =
  'You are a sports betting pick parser. Extract the structured market data from the user\'s free-text pick. ' +
  'Set confidence below 0.75 if the pick is ambiguous, incomplete, or you are uncertain about any required field. ' +
  'Always call the parse_sports_pick tool — do not respond with text.'

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Method guard
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Input validation — non-empty text (ASVS V5 / T-09-06)
  const body = req.body as { text?: unknown }
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'text is required and must be non-empty' })
    return
  }

  // 1. Deterministic precheck (free, fast) — SHOP-02, D-03
  const precheck = precheckParse(text)
  if (precheck.confidence >= 0.75) {
    // High confidence: skip LLM (saves credits — T-09-05)
    res.status(200).json({
      parsed: precheck.parsed,
      confidence: precheck.confidence,
      needsFallback: false,
    })
    return
  }

  // 2. API key guard — graceful degradation (SHOP-07)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // No key: return needsFallback so the client renders the structured form
    res.status(200).json({ parsed: null, confidence: 0, needsFallback: true })
    return
  }

  // 3. LLM fallback — Claude Haiku 4.5 via tool_use
  //    Do NOT set anthropic-beta structured-outputs-* header (not GA on Haiku 4.5)
  try {
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      tools: [PARSE_TOOL],
      tool_choice: { type: 'auto' },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Parse this sports pick: "${text}"`,
        },
      ],
    })

    // Extract the tool_use block
    const toolUseBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      // Haiku did not call the tool (e.g. stop_reason was end_turn with no tool call)
      res.status(200).json({ parsed: null, confidence: 0, needsFallback: true })
      return
    }

    const result = toolUseBlock.input as Record<string, unknown>
    const confidence = typeof result.confidence === 'number' ? result.confidence : 0
    res.status(200).json({
      parsed: result,
      confidence,
      needsFallback: confidence < 0.75,
    })
  } catch {
    // LLM call failed — degrade gracefully (SHOP-07)
    res.status(200).json({ parsed: null, confidence: 0, needsFallback: true })
  }
}
