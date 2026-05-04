-- ─── Migration: Factor Scoring System ───────────────────────────────────────
-- Adds dynamic universe screener columns, extended fundamentals,
-- 5-factor scores table, and entry gate signals table.

-- ─── 1. Extend universes table ────────────────────────────────────────────────
ALTER TABLE universes
  ADD COLUMN IF NOT EXISTS active      boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS screened_at timestamptz;

-- ─── 2. Extend fundamentals table ────────────────────────────────────────────
ALTER TABLE fundamentals
  ADD COLUMN IF NOT EXISTS fcf                 numeric(20,2),
  ADD COLUMN IF NOT EXISTS operating_cash_flow numeric(20,2),
  ADD COLUMN IF NOT EXISTS gross_profit        numeric(20,2),
  ADD COLUMN IF NOT EXISTS total_assets        numeric(20,2),
  ADD COLUMN IF NOT EXISTS total_debt          numeric(20,2),
  ADD COLUMN IF NOT EXISTS book_equity         numeric(20,2),
  ADD COLUMN IF NOT EXISTS cash                numeric(20,2),
  ADD COLUMN IF NOT EXISTS ebitda              numeric(20,2),
  ADD COLUMN IF NOT EXISTS market_cap          numeric(20,2),
  ADD COLUMN IF NOT EXISTS interest_expense    numeric(20,2);

-- ─── 3. Extend indicator_values table ────────────────────────────────────────
ALTER TABLE indicator_values
  ADD COLUMN IF NOT EXISTS adx_14    numeric(8,4),
  ADD COLUMN IF NOT EXISTS obv       numeric(20,2),
  ADD COLUMN IF NOT EXISTS vol_ratio numeric(8,4);

-- ─── 4. factor_scores table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS factor_scores (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           text        NOT NULL,
  strategy_id      uuid        REFERENCES strategies(id) ON DELETE CASCADE,
  scored_at        timestamptz NOT NULL,

  -- sector-neutral z-scores, winsorized, clipped [-3, 3]
  value_z          numeric(8,4),
  quality_z        numeric(8,4),
  momentum_z       numeric(8,4),
  low_vol_z        numeric(8,4),
  growth_z         numeric(8,4),

  -- previous run values (for delta display)
  value_prev       numeric(8,4),
  quality_prev     numeric(8,4),
  momentum_prev    numeric(8,4),
  low_vol_prev     numeric(8,4),
  growth_prev      numeric(8,4),

  -- composite weighted score and ranking
  composite_z      numeric(8,4),
  rank             integer,
  is_new           boolean     NOT NULL DEFAULT false,
  hard_filter_pass boolean     NOT NULL DEFAULT false,
  sector           text,

  UNIQUE (symbol, strategy_id, scored_at)
);

ALTER TABLE factor_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_factor_scores"  ON factor_scores  FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_factor_scores" ON factor_scores FOR ALL TO service_role USING (true);

-- ─── 5. entry_signals table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entry_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          text        NOT NULL,
  strategy_id     uuid        REFERENCES strategies(id) ON DELETE CASCADE,
  evaluated_at    timestamptz NOT NULL,

  -- Gate 0: market regime (SPY SMA check)
  gate_market     boolean,
  -- Gate 1: stock trend (SMA50 > SMA200, close > SMA200, slope > 0, ADX > 20)
  gate_trend      boolean,
  -- Gate 2: entry setup type
  setup_type      text,           -- 'pullback' | 'breakout' | 'squeeze' | null
  -- Gate 3: multi-signal confirmation
  gate_confirmed  boolean,

  -- risk levels from Gate 4
  entry_price     numeric(12,4),
  stop_price      numeric(12,4),
  target_price    numeric(12,4),
  atr             numeric(12,4),
  r_multiple      numeric(6,2),

  -- position sizing from Gate 5
  shares          integer,
  dollar_risk     numeric(12,2),

  -- true only when all gates pass
  actionable      boolean         NOT NULL DEFAULT false,

  UNIQUE (symbol, strategy_id, evaluated_at)
);

ALTER TABLE entry_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_entry_signals"     ON entry_signals FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_entry_signals" ON entry_signals FOR ALL TO service_role USING (true);
