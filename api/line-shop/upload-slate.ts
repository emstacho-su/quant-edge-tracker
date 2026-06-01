/**
 * POST /api/line-shop/upload-slate
 *
 * Auth-gated Vercel handler for uploading manual offshore book price slates.
 *
 * Contract (D-07, D-08, D-10, D-11):
 *   - Validates `book` against the four registered offshore books (D-11).
 *   - Supersedes ALL prior live manual rows for the given book (D-08).
 *   - Inserts new rows tagged source_confidence='manual' + is_account_line=true (D-07).
 *   - Synchronously detects arbs on affected markets (D-10).
 *   - Writes detected arbs into arb_opportunities via the canonical arbToRow builder.
 *   - Returns { inserted, superseded, arbs_detected }.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireSession } from '../_lib/session.js'
import { getServiceClient } from '../_lib/supabase-admin.js'
import { detectArbsForMarkets } from '../_lib/line-shop/arb-detection.js'
import { arbToRow } from '../cron/arbitrage-scan.js'
import { americanToDecimal, impliedFromAmerican } from '../_lib/clv.js'

// ─── Constants (D-11) ─────────────────────────────────────────────────────────

const ALLOWED_BOOKS = ['7stacks', 'betvegas23', 'bovada', 'betus'] as const
type AllowedBook = (typeof ALLOWED_BOOKS)[number]

/** Defense-in-depth cap against pasted-bomb payloads (T-21-05-05). */
const MAX_ROWS = 500

// ─── Request body shapes ──────────────────────────────────────────────────────

interface SlateRow {
  market_id: string
  side: 'home' | 'away' | 'over' | 'under'
  price_american: number
  point: number | null
}

interface UploadSlateBody {
  book: AllowedBook
  rows: SlateRow[]
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // (1) Method guard.
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // (2) Auth gate — fires BEFORE body parsing (defense-in-depth, T-21-05-01).
  const session = requireSession(req, res)
  if (!session) return

  // (3) Body parse + validation.
  const rawBody = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
    string,
    unknown
  >

  const book = typeof rawBody['book'] === 'string' ? rawBody['book'] : ''
  if (!ALLOWED_BOOKS.includes(book as AllowedBook)) {
    return res.status(400).json({ error: 'invalid book' })
  }

  const rawRows = rawBody['rows']
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return res.status(400).json({ error: 'no rows' })
  }

  // (4) Row count cap (T-21-05-05).
  if (rawRows.length > MAX_ROWS) {
    return res.status(400).json({ error: `too many rows (max ${MAX_ROWS})` })
  }

  // Per-row validation.
  const VALID_SIDES = new Set(['home', 'away', 'over', 'under'])
  const rows: SlateRow[] = []
  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i] as Record<string, unknown>
    if (typeof r['market_id'] !== 'string' || r['market_id'].length === 0) {
      return res.status(400).json({ error: `invalid row at index ${i}: market_id must be a non-empty string` })
    }
    if (!VALID_SIDES.has(r['side'] as string)) {
      return res.status(400).json({ error: `invalid row at index ${i}: side must be home|away|over|under` })
    }
    const price = r['price_american']
    if (typeof price !== 'number' || !isFinite(price) || !Number.isInteger(price) || Math.abs(price) < 100) {
      return res.status(400).json({ error: `invalid row at index ${i}: price_american must be a finite integer with |value| >= 100` })
    }
    if (r['point'] !== null && typeof r['point'] !== 'number') {
      return res.status(400).json({ error: `invalid row at index ${i}: point must be a number or null` })
    }
    rows.push({
      market_id: r['market_id'] as string,
      side: r['side'] as SlateRow['side'],
      price_american: price,
      point: (r['point'] as number | null) ?? null,
    })
  }

  // (5) Supabase + timestamp.
  const db = getServiceClient()
  const now = new Date().toISOString()

  try {
    // (6) Supersession (D-08): mark ALL prior live manual rows for this book superseded.
    const { error: superErr, count: rawCount } = await db
      .from('book_prices')
      .update({ superseded_at: now }, { count: 'exact' })
      .eq('book', book)
      .eq('source_confidence', 'manual')
      .is('superseded_at', null)

    if (superErr) {
      return res.status(500).json({ error: `supersede: ${superErr.message}` })
    }
    const superseded = rawCount ?? 0

    // (7) Insert new rows (D-07): source_confidence='manual', is_account_line=true.
    const inserts = rows.map((row) => ({
      market_id: row.market_id,
      book,
      side: row.side,
      price_american: row.price_american,
      price_decimal: americanToDecimal(row.price_american),
      implied_prob: impliedFromAmerican(row.price_american),
      point: row.point,
      fetched_at: now,
      source_confidence: 'manual' as const,
      is_closing: false,
      is_account_line: true,
      // superseded_at defaults NULL — these are the new live rows
    }))

    const { error: insertErr } = await db.from('book_prices').insert(inserts)
    if (insertErr) {
      return res.status(500).json({ error: `insert: ${insertErr.message}` })
    }

    // (8) Synchronous detection (D-10) — best-effort; detection failure does NOT 500.
    const affectedMarketIds = [...new Set(rows.map((r) => r.market_id))]
    let detections: Awaited<ReturnType<typeof detectArbsForMarkets>> = []
    try {
      detections = await detectArbsForMarkets(affectedMarketIds)
    } catch (err) {
      console.error('[upload-slate] detection error:', err)
      // Detection failure is non-fatal — the book_prices write is the contract.
    }

    // (9) Arb write — best-effort; arb-insert failure does NOT 500.
    if (detections.length > 0) {
      const arbRows = detections.map((d) => arbToRow(d.arb, d.marketId, null))
      const { error: arbErr } = await db.from('arb_opportunities').insert(arbRows)
      if (arbErr) {
        console.error('[upload-slate] arb insert error:', arbErr.message)
      }
    }

    // (10) Success response.
    return res.status(200).json({
      inserted: inserts.length,
      superseded,
      arbs_detected: detections.length,
    })
  } catch (err) {
    return res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
}
