/**
 * OutputSummary Zod schema — tracker copy (05-03 W1.3)
 *
 * This file is a manual mirror of
 *   quant-edge-runner/src/audit/output-summary.schema.ts
 *
 * The runner owns the canonical definition. When the schema changes,
 * update both files in sync (package extraction is a future refactor).
 *
 * The tracker uses this for runtime validation of output_summary jsonb
 * when rendering the RunViewer structured view.
 *
 * TOLERANCE POLICY (2026-05-21): output_summary is a DISPLAY artifact; only
 * final_card drives settlement. Settlement-critical pick fields stay required;
 * every descriptive field is optional with a sane default so the structured view
 * renders against real (variable) Claude output instead of failing validation.
 * Kept identical to the runner copy.
 */

import { z } from 'zod'

export const PickSchema = z.object({
  // Settlement-critical — kept required:
  game: z.string(),
  market: z.string(),
  line: z.number().int(),
  stake_u: z.number().nonnegative(),
  pick_key: z.string(),
  // Display-only — tolerant:
  n: z.number().int().positive().optional(),
  stack: z.enum(['T1', 'T1+T2', 'T1+T2+T3']).or(z.string()).optional(),
  edge_pct: z.number().optional().default(0),
})

export const ParlaySchema = z.object({
  legs: z.array(z.string()).default([]),
  combined_odds: z.number().int().optional().default(0),
  stake_u: z.number().nonnegative().optional().default(0),
  edge_pct: z.number().optional().default(0),
})

export const PitcherNoteSchema = z.object({
  game: z.string().optional().default(''),
  starter: z.string().optional().default(''),
  verdict: z.string().optional().default(''),
  tier1_signal: z.enum(['strong', 'neutral', 'weak']).or(z.string()).optional().default('neutral'),
})

export const SituationalNoteSchema = z.object({
  game: z.string().optional().default(''),
  factor: z.string().optional().default(''),
  detail: z.string().optional().default(''),
  impact: z.string().optional().default(''),
})

export const AuditSeminarSchema = z.object({
  play: z.string().optional().default(''),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).or(z.string()).optional().default('n/a'),
  p_pre: z.number().optional(),
  p_audited: z.number().optional(),
  delta: z.number().optional(),
  key_findings: z.string().optional().default(''),
})

export const CoverageVerdictSchema = z.object({
  game: z.string().optional().default(''),
  market: z.string().optional().default(''),
  verdict: z.enum(['FIRE', 'WATCH', 'PASS']).or(z.string()).optional().default('PASS'),
  edge_pct: z.number().optional().default(0),
  stake_u: z.number().nonnegative().optional().default(0),
})

/**
 * Element-resilient array: keeps valid elements, drops ones that fail `schema`,
 * yields [] when the value isn't an array. output_summary is a DISPLAY artifact
 * with LLM-variable shape; this prevents one malformed display element (e.g.
 * pitcher_notes emitted as strings) from rejecting the whole extraction. Kept
 * identical to the runner copy.
 */
function lenientArray<T extends z.ZodTypeAny>(schema: T) {
  return z
    .array(z.unknown())
    .transform((arr) =>
      arr.flatMap((x) => {
        const r = schema.safeParse(x)
        return r.success ? [r.data as z.infer<T>] : []
      }),
    )
    .catch([] as z.infer<T>[])
}

export const OutputSummarySchema = z.object({
  headline: z.string().optional().default(''),
  pitcher_notes: lenientArray(PitcherNoteSchema),
  situational_notes: lenientArray(SituationalNoteSchema),
  coverage: lenientArray(CoverageVerdictSchema),
  audit_seminars: lenientArray(AuditSeminarSchema),
  // final_card stays STRICT (not lenient): a pick missing a settlement-critical
  // field MUST fail loudly rather than be silently dropped (money-safety).
  final_card: z.array(PickSchema).default([]),
  parlays: lenientArray(ParlaySchema),
  flags: z.array(z.string()).catch([]),
})

export type Pick = z.infer<typeof PickSchema>
export type Parlay = z.infer<typeof ParlaySchema>
export type PitcherNote = z.infer<typeof PitcherNoteSchema>
export type SituationalNote = z.infer<typeof SituationalNoteSchema>
export type AuditSeminar = z.infer<typeof AuditSeminarSchema>
export type CoverageVerdict = z.infer<typeof CoverageVerdictSchema>
export type OutputSummary = z.infer<typeof OutputSummarySchema>

// Audit findings (for strategy_run_audits.findings)
export const AuditFindingSchema = z.object({
  rule: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
  pass: z.boolean(),
  evidence: z.string(),
})

export type AuditFinding = z.infer<typeof AuditFindingSchema>
