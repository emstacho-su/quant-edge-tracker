# Quant Edge Tracker

> A personal sports-betting analytics platform — import bets, track a bankroll
> ledger, measure edge/ROI, and capture closing-line value across 30+ sportsbooks.

**Live demo:** https://quant-edge-tracker.vercel.app
&nbsp;·&nbsp; React 19 · TypeScript · Vite · Tailwind v4 · Supabase · Vercel

> The live app has a **Demo Mode** toggle (Account Settings) that divides every
> displayed dollar figure by 10 — so you can click through realistic data
> without seeing real bankroll numbers.

---

## The system (3 repos)

Quant Edge is a small distributed system. This repo is the user-facing web app;
two sister repos run the modeling pipeline that feeds it.

```
┌─────────────────────────────────────────────────────────────┐
│  quant-edge-tracker   ← YOU ARE HERE                          │
│  React + Vercel web app: bet import, bankroll ledger,         │
│  CLV/PLM tracking, line-shopping, daily/weekly reporting      │
└───────────────────────────────┬─────────────────────────────┘
                                 │  Supabase (Postgres)
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  quant-edge-runner    Windows daemon (Node + Claude Code SDK) │
│  Polls queued model runs, executes them, audits the output,   │
│  and writes structured results back to Supabase.              │
└───────────────────────────────┬─────────────────────────────┘
                                 │  reads strategy specs from
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  quant-edge-skills    Versioned strategy "skill" specs the    │
│  daemon feeds to the model; a weekly optimizer proposes diffs │
└─────────────────────────────────────────────────────────────┘
```

- **quant-edge-runner** → https://github.com/emstacho-su/quant-edge-runner
- **quant-edge-skills** → https://github.com/emstacho-su/quant-edge-skills

---

## What it does

- **Bet ingestion** — a paste-parser turns raw sportsbook copy/paste (and screenshot
  OCR) into structured single & parlay bets, with sport/team detection.
- **Bankroll ledger** — an append-only event log (`starting_balance`, `bet_settled`,
  `deposit`, `withdrawal`, `manual_adjustment`, …) with a recomputed running balance.
  A hard invariant guarantees the cash bankroll never dips below `$0` at *any*
  historical point, even on backdated inserts.
- **CLV & PLM** — captures Closing Line Value and Positive Line Movement against a
  sharp-book benchmark subset, on a polling cadence (5-min ≤24h out, hourly beyond).
- **Line shopping** — ingests prices from 30+ books and scans for best-price and
  arbitrage opportunities.
- **Reporting** — WagerTalk-style daily/weekly P&L breakdowns, plus edge analytics
  and per-sport / per-bet-type performance.

## Architecture

| Layer    | Tech |
|----------|------|
| Frontend | React 19, TypeScript, Vite, Tailwind v4, shadcn/ui + base-ui, Recharts |
| Backend  | Vercel serverless functions (Node.js) under `api/` |
| Database | Supabase (Postgres) |
| Auth     | Single-user, HMAC-SHA256 signed httpOnly cookie gating **writes**; reads are public |
| Testing  | Vitest — utils covered to 80%+ |
| Deploy   | Vercel — preview-per-push, auto-promote to production on merge to `main` |

**Write discipline:** the UI never touches Supabase directly. All mutations go through
hooks (`src/hooks/*`), and pure business logic lives in unit-tested utilities
(`src/utils/*`).

## Notable engineering decisions

- **Wipe-and-re-emit bet edits** — editing a settled bet deletes all of its ledger
  events and replays placement + settlement from the new state, instead of trying to
  surgically patch events across status transitions.
- **Two deliberate bucketing rules** — daily reports bucket by *placed-at*; the
  dashboard 7-day chart applies a 16-hour / golf / day-prior rule. Different views,
  different mental models — kept intentionally divergent.
- **Ledger is the single source of truth** — current balances are derived from the
  last event per account, never from a stored "starting balance" setting.
- **Demo mode** — a drop-in `USD` formatter divides displayed values by 10 for
  screen-sharing, without ever mutating stored data.

## Built with an AI agent workflow

This project was built using a custom [Claude Code](https://claude.com/claude-code)
agent setup — the `.claude/` directory contains the hooks, subagents, output styles,
and skills used during development (planning artifacts themselves are kept private).
It's included here intentionally, as part of how the project was made.

## Getting started

```bash
git clone https://github.com/emstacho-su/quant-edge-tracker
cd quant-edge-tracker
npm install
cp .env.example .env.local        # fill in Supabase + AUTH_* vars
npm run dev                       # Vite (UI only)
# npm run dev:vercel              # full stack incl. /api auth routes (needs Vercel CLI)
```

| Script | Purpose |
|--------|---------|
| `npm run dev`   | Vite dev server |
| `npm run build` | `tsc -b && vite build` (also type-checks) |
| `npm run test`  | Vitest once |
| `npm run lint`  | ESLint |

See `.env.example` for required environment variables. Reads work without auth;
write actions (import, settle, edit, bankroll events) require the single-user sign-in.

## License

MIT — see [LICENSE](./LICENSE).
