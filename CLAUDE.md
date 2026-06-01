# quant-edge-tracker

Personal sportsbook tracker — bets, bankroll ledger, daily/weekly reporting. Single-user, Supabase-backed, deployed on Vercel.

## Deployment

- **Live:** https://quant-edge-tracker.vercel.app
- **Stack:** React 19 + TypeScript + Vite, Tailwind v4 + shadcn/ui + base-ui, Supabase, Recharts, Vitest
- **Deploy flow:** edit locally → `vercel deploy --yes` (preview) → user reviews preview URL → `git push origin main` → auto-promotes to production via Vercel's GitHub integration
- **Vercel project:** `quant-edge-tracker` (id `prj_wuwYEe4B3mzUf2rEHkpsN6ALfmvb`, team `team_ohEBa3VTUFU4xAf7tHm4VY0e`)

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build` (use to typecheck)
- `npm run test` — Vitest once
- `npm run test:watch` — Vitest watch
- `npm run lint` — ESLint

## Routes & pages

| Route | File | Purpose | Auth |
|-------|------|---------|------|
| `/` | `src/pages/Dashboard.tsx` | Bankroll-over-time chart, 7-day P&L, sport performance | Public |
| `/today` | `src/pages/Today.tsx` | Today's pending picks | Read public; settle buttons gated |
| `/stats` | `src/pages/Stats.tsx` | Cumulative P&L, edge analytics, sport/bet-type perf | Public |
| `/import` | `src/pages/Import.tsx` | Paste-parser bet import | **Gated** (full page) |
| `/bets` | `src/pages/BetLog.tsx` | All bets table — settle (W/L/P/V) or **Edit** per row | Read public; action column gated |
| `/report` | `src/pages/DailyReport.tsx` | WagerTalk-style daily breakdown + Daily/Weekly toggle | Read public; settle/edit gated |
| `/account` | `src/pages/AccountSettings.tsx` | Bankroll event management, unit size | Read public; write controls gated |

Routing in `src/App.tsx`. Nav in `src/components/Layout.tsx` (`NAV_ITEMS`).

## Auth model

Single-user gate over writes. Reads are public.

- `api/auth/login.ts`, `api/auth/logout.ts`, `api/auth/me.ts` — Vercel serverless functions
- `api/_lib/session.ts` — HMAC-SHA256 cookie sign/verify, httpOnly + sameSite=lax + 30-day TTL
- `src/lib/auth.tsx` — `AuthProvider`, `useAuth()` hook
- `src/components/auth/AuthGate.tsx` — `<AuthGate>` (page-level) and `<AuthActions>` (inline controls)
- `src/components/auth/LoginDialog.tsx` — global login modal, mounted in `App.tsx`
- Header (`src/components/ui/header-2.tsx`) shows `AuthIndicator` (sign-in button or username + sign-out)

Required env vars: `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_COOKIE_SECRET` (32+ chars).
See `.env.example`. `npm run dev` (Vite alone) does NOT serve `/api/*`; use
`npm run dev:vercel` (vercel CLI) to test auth locally.

This is UI-level gating only — Supabase still uses the public anon key from the
browser. Adequate for single-user, not a security boundary.

## Demo mode

`src/lib/demo-mode.tsx` exports a drop-in `USD` formatter and a `useDemoMode()`
hook. When toggled on (Account Settings → Demo Mode card), every value that
goes through `USD.format(n)` is divided by 10 before formatting. Data is never
mutated — toggling off restores real values. The Layout subscribes to the
store so flipping the toggle re-renders the whole tree. State persists in
localStorage under `qe.demoMode`.

Page-level formatters (`fmtSignedUsd` in DailyReport, etc.) call `USD.format`
internally, so they automatically participate. Recharts Y-axis ticks use
`tickFormatter={(v) => USD.format(Number(v))}` to keep axis labels in sync
with tooltips/data.

When adding a new currency display, import `USD` from `@/lib/demo-mode` —
don't roll a fresh `Intl.NumberFormat`.

## Data layer

**Supabase project:** `quant-edge-tracker-v2` (id `yuxjidjpiqeybrdsprgt`, us-east-1)

| Table | Notes |
|-------|-------|
| `bets` | Single + parlay. `status` ∈ pending\|won\|lost\|push\|void. `is_freeplay` distinguishes FP. |
| `parlay_legs` | FK to bets; per-leg outcomes |
| `bankroll_events` | Append-only ledger. `event_type` ∈ starting_balance \| bet_settled \| manual_adjustment \| deposit \| withdrawal \| promo. `bankroll_type` ∈ cash \| freeplay. `balance_after` is the running total. |
| `settings` | Key-value. Only `unit_size` lives here now — starting-balance keys were dropped (the ledger is source of truth). |

**Hooks own all writes** — UI never calls `supabase.from(...).insert/update/delete` directly:

- `useBets()` → `bets`, `parlay_legs`; exposes `settleBet`, `editBet`, `insertBets`
- `useBankroll()` → `bankroll_events`; exposes `addEvent`, `updateEvent`, `deleteEvent` (auto-rebuilds chain)
- `useSettings()` → `settings`; exposes `updateSetting`

**Pure utils:**

- `src/utils/bankroll-helpers.ts` — `recomputeChain`, `projectBalanceSeries` (enforces invariants)
- `src/utils/daily-report.ts` — `buildDailyReport`, `buildWeeklySummary`, ET week math, bucketing helpers
- `src/utils/stats-analytics.ts` — Edge/ROI/sport perf (intended for eventual Supabase RPC extraction)
- `src/utils/excel-export.ts` — page-specific + comprehensive exports
- `src/utils/paste-parser.ts` — sportsbook paste text → `ParsedBet`
- `src/utils/dates.ts` — ET timezone helpers
- `src/utils/sport-detector.ts`, `team-matcher.ts` — paste-parser support

**Reusable components:** `src/components/EditBetForm.tsx`, `src/components/ExportBar.tsx`, `src/components/Layout.tsx`, `src/components/stats/EdgeAnalytics.tsx`, plus shadcn primitives in `src/components/ui/`.

## Hard invariants (don't violate without explicit user OK)

1. **Cash bankroll never ≤ $0** at any point in the chain — including intermediate dips on backdated inserts. Use `projectBalanceSeries` to validate; check `Math.min(...series)`, not just the final value. FP has no floor.
2. **Ledger is source of truth.** Never read `settings.starting_cash_balance` / `starting_fp_balance` (gone). Compute current balances from the last event of each `bankroll_type`.
3. **Chain rebuild after every bankroll mutation.** Use `recomputeChain` from `bankroll-helpers.ts`. Rebuild both `cash` and `freeplay` chains after any insert/update/delete.
4. **Bet-edit pattern is wipe-and-re-emit.** `editBet` deletes ALL `bankroll_events` for the bet, then re-emits placement (FP only) + settlement events from the new bet state, then rebuilds chains. Don't try to surgically patch events across status transitions.
5. **Reports vs Dashboard bucketing — intentional divergence.** `/report` uses `getBetPlacedDayKey` (placed_at always). Dashboard 7-day chart uses `getBetReportDay` (16hr/Golf/day-prior rule). Don't unify without asking.
6. **Pending bet pct** is unsigned magnitude `(stake / weekStartingBankroll) * 100`. Settled bet pct is signed `(profit_loss / weekStartingBankroll) * 100`. The `-P` suffix is intentionally absent from `W-L-P` records — pending has its own block.
7. **PnL can be negative.** Distinct from balance. Don't conflate.

## Conventions

- Pages in `src/pages/`, hooks in `src/hooks/`, utils in `src/utils/`, components in `src/components/`
- Util-level tests live next to the util as `*.test.ts` (vitest). Coverage target 80%+.
- Tailwind: `const GROUP_DIVIDER = 'border-l border-border/60'` separates logical column groups in tables
- Commit style: conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`)
- Never commit secrets. The `.vercel/project.json` is fine to commit; the anon key in scripts is fine (it's the publishable key)

## Common gotchas

- Project lives inside OneDrive — file watchers across the OneDrive sync are sometimes flaky; restart `npm run dev` if HMR drops
- Pre-existing lint errors (3 in shadcn UI files, 3 `useEffect(() => fetchX())` in hooks) are unrelated to feature work and predate everything
- The bundled `claude-mem` standalone CLI in its `scripts/` dir is a Mac ARM64 Mach-O binary — don't try to invoke it on Windows. The plugin's worker-service hooks work fine
- Supabase `bet_settled` events are also created at FP placement time (with the "FP stake consumed at placement" note). Don't filter them out when computing FP exposure
- `parlay_legs` aren't auto-updated when editing a parlay's outcome via `editBet` — leg-level edits are a separate flow

## Past session memory (auto-loaded)

`claude-mem` plugin's SessionStart hook auto-injects relevant past observations from its SQLite DB.

User-level auto-memory entries (loaded via `~/.claude/projects/C--Users-estac/memory/MEMORY.md`):

- `reference_quant_edge_codebase.md` — codebase path, Supabase + Vercel IDs, deploy flow
- `project_quant_edge_ledger_model.md` — ledger event types, cash invariant, edit/wipe-re-emit pattern, Reports/Dashboard bucketing divergence
- `project_quant_edge_app.md` — Account 1 / Account 2 context, deposits, recent reconciliations
- `reference_sportsbook_audit.md` — canonical PnL audit rules

If past context isn't loaded automatically, ask the user to verify claude-mem hooks are firing.

## Deploy authorization

  The user's standard prod-deploy flow is `git push origin
  feat/clv-track-all-bets:main`
  → Vercel auto-promotes. Treat that exact push as pre-authorized when
  Claude has been
  asked to deploy, ship, push to prod, or merge a finished feature.