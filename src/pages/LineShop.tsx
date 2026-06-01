/**
 * /line-shop — Line Shopper + Arb Scanner
 *
 * Reads are public (no <AuthGate>). Write actions (Add to Bet Log) gated via <AuthActions>.
 *
 * Tab A: Line Shopper (Mode B) — paste/browse → ranked price table + consensus header
 * Tab B: Arb Scanner — reads arb_opportunities (Phase 8 cron populated)
 *
 * D-01: Route added in src/App.tsx; nav item in header-2.tsx NAV_ITEMS
 * D-09: No AuthGate on page; AuthActions wraps Add to Bet Log only
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PickInput } from '@/components/line-shop/PickInput'
import { ConsensusHeader } from '@/components/line-shop/ConsensusHeader'
import { PriceTable } from '@/components/line-shop/PriceTable'
import { ArbPanel } from '@/components/line-shop/ArbPanel'
import { useLineShop } from '@/hooks/use-line-shop'
import { Loader2 } from 'lucide-react'

export default function LineShop() {
  const {
    parseResult,
    parseLoading,
    parseError,
    parsePick,
    pricesResult,
    pricesLoading,
    pricesError,
    fetchPrices,
    // Arb slice (ARB-02/03/04)
    arbRows,
    arbLoading,
    arbError,
    totalStake,
    setTotalStake,
    minReturnPct,
    setMinReturnPct,
    fetchArbs,
  } = useLineShop()

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Line Shop</h1>
        <p className="text-sm text-muted-foreground">
          Shop lines across books and scan for arbitrage opportunities.
        </p>
      </div>

      <Tabs defaultValue="shopper">
        <TabsList>
          <TabsTrigger value="shopper">Line Shopper</TabsTrigger>
          <TabsTrigger value="arb">Arb Scanner</TabsTrigger>
        </TabsList>

        {/* ── Tab A: Line Shopper ─────────────────────────────────────────────── */}
        <TabsContent value="shopper" className="space-y-4 mt-4">
          {/* Pick input (paste or browse) */}
          <PickInput
            onSubmit={fetchPrices}
            parseResult={parseResult}
            parseLoading={parseLoading}
            parseError={parseError}
            onTextChange={parsePick}
            loading={pricesLoading}
          />

          {/* Loading state */}
          {pricesLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm">Fetching prices across books...</span>
            </div>
          )}

          {/* Error state */}
          {pricesError && !pricesLoading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">{pricesError}</p>
            </div>
          )}

          {/* Results */}
          {pricesResult && !pricesLoading && (
            <>
              <ConsensusHeader analysis={pricesResult.analysis} />
              <PriceTable
                analysis={pricesResult.analysis}
                missingBooks={pricesResult.missingBooks}
              />
            </>
          )}

          {/* Empty state */}
          {!pricesResult && !pricesLoading && !pricesError && (
            <div className="rounded-lg border border-border/40 bg-card/40 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Paste a pick above or browse a market to see prices across all books.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ── Tab B: Arb Scanner ──────────────────────────────────────────────── */}
        <TabsContent value="arb" className="mt-4">
          <ArbPanel
            rows={arbRows}
            loading={arbLoading}
            error={arbError}
            totalStake={totalStake}
            onTotalStakeChange={setTotalStake}
            minReturnPct={minReturnPct}
            onMinReturnPctChange={setMinReturnPct}
            onRefresh={fetchArbs}
          />
        </TabsContent>
      </Tabs>

    </div>
  )
}
