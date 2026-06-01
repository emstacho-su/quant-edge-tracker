// Cleans bankroll_events: removes known duplicates and rebuilds balance_after.
// Also restores Toumani Camara PRA (Apr 10 game) settled_at to Apr 11 03:00 UTC
// so ET grouping puts it on Apr 10.
// Run: node scripts/rebuild_bankroll_chain.mjs
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  'https://yuxjidjpiqeybrdsprgt.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1eGppZGpwaXFleWJyZHNwcmd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1ODY5MzgsImV4cCI6MjA5MTE2MjkzOH0.sAxSoeeEk4x2C0vIfqfKErfgeyXMVcfaJadybsRjcGE',
)

async function main() {
  // ─── 1. Find Toumani Camara PRA duplicate bankroll events ─────────────
  const camaraId = '2053b8c3-2854-4f0d-b585-d11bd0ffc3c1'
  const { data: dupes, error: dupeErr } = await sb
    .from('bankroll_events')
    .select('id, occurred_at, amount, balance_after, bankroll_type')
    .eq('bet_id', camaraId)
    .order('occurred_at')
  if (dupeErr) throw dupeErr
  console.log(`Camara PRA bankroll events: ${dupes.length}`)
  for (const d of dupes) console.log(`  ${d.occurred_at} ${d.bankroll_type} amt=${d.amount}`)

  if (dupes.length > 1) {
    const keep = dupes[0]
    const remove = dupes.slice(1)
    console.log(`  → keep ${keep.id.slice(0, 8)} @ ${keep.occurred_at}`)
    for (const r of remove) {
      console.log(`  → delete ${r.id.slice(0, 8)} @ ${r.occurred_at}`)
      const { error } = await sb.from('bankroll_events').delete().eq('id', r.id)
      if (error) throw error
    }
  }

  // ─── 2. Restore Camara bet.settled_at ──────────────────────────────────
  const { error: betUpdErr } = await sb
    .from('bets')
    .update({ settled_at: '2026-04-11T03:00:00Z' })
    .eq('id', camaraId)
  if (betUpdErr) throw betUpdErr
  console.log('Restored Camara bet.settled_at → 2026-04-11T03:00:00Z')

  // ─── 3. Rebuild balance_after chains ───────────────────────────────────
  for (const type of ['cash', 'freeplay']) {
    const { data: events, error } = await sb
      .from('bankroll_events')
      .select('id, occurred_at, amount, balance_after')
      .eq('bankroll_type', type)
      .order('occurred_at')
      .order('id')
    if (error) throw error

    let running = 0
    let drifted = 0
    for (const e of events) {
      running = Number((running + Number(e.amount)).toFixed(2))
      if (Math.abs(Number(e.balance_after) - running) > 0.01) {
        const { error: updErr } = await sb
          .from('bankroll_events')
          .update({ balance_after: running })
          .eq('id', e.id)
        if (updErr) throw updErr
        drifted++
      }
    }
    console.log(`${type}: ${events.length} events, ${drifted} rebalanced, final $${running.toFixed(2)}`)
  }

  console.log('DONE')
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
