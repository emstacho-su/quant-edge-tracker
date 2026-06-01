-- Situational systems catalog mirror.
-- Source of truth: quant-edge-runner/data/situational-systems-catalog.json
-- Synced nightly via scripts/sync-catalog-to-supabase.mjs (Phase F).
-- This table is for runtime queries by other tools / audit trail; the JSON
-- file remains canonical for any developer edits.

CREATE TABLE IF NOT EXISTS public.situational_systems_catalog (
  id              text PRIMARY KEY,
  cluster         text NOT NULL,
  applies_when    jsonb NOT NULL,
  direction_bias  text NOT NULL CHECK (direction_bias IN ('back', 'fade', 'over', 'under')),
  side            text NOT NULL CHECK (side IN ('team', 'opponent')),
  mechanism       text NOT NULL,
  min_n           integer NOT NULL DEFAULT 50,
  markets         text[] NOT NULL,
  era_required    text NOT NULL CHECK (era_required IN ('any', 'full')),
  is_active       boolean NOT NULL DEFAULT TRUE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.situational_systems_catalog IS
  'Mirror of quant-edge-runner/data/situational-systems-catalog.json. Synced nightly. JSON file is canonical.';
COMMENT ON COLUMN public.situational_systems_catalog.cluster IS
  'Correlation cluster (negative_form, positive_form, getaway_signals, travel_burden, rest_advantage, matchup_context). Aggregator dedupes best-per-cluster.';
COMMENT ON COLUMN public.situational_systems_catalog.applies_when IS
  'Dim filter dict — both trigger and historical query. Op syntax: {dim: value} (eq) or {dim: {lte|gte|between: value}}.';
COMMENT ON COLUMN public.situational_systems_catalog.direction_bias IS
  'Author hypothesis of direction this team performs: back/fade for ML/RL, over/under for TOTAL.';
COMMENT ON COLUMN public.situational_systems_catalog.era_required IS
  'any = uses only Tier-3a dims (works pre-2021), full = uses Tier-3b dims (2021+ only)';

CREATE INDEX IF NOT EXISTS idx_situational_systems_catalog_cluster
  ON public.situational_systems_catalog (cluster) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_situational_systems_catalog_markets
  ON public.situational_systems_catalog USING GIN (markets) WHERE is_active = TRUE;

-- RLS: read-public + service-role writes (matches historical_* convention)
ALTER TABLE public.situational_systems_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read access to situational systems catalog"
  ON public.situational_systems_catalog;
CREATE POLICY "Public read access to situational systems catalog"
  ON public.situational_systems_catalog FOR SELECT
  USING (TRUE);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_situational_systems_catalog
  ON public.situational_systems_catalog;
CREATE TRIGGER set_updated_at_situational_systems_catalog
  BEFORE UPDATE ON public.situational_systems_catalog
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
