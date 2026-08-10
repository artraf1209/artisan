-- ─── Migration: Artisan v2 Schema Rebuild ────────────────────────────────────
-- Drops the legacy TS-engine table lineage (signals/trades/positions/logs) and
-- the superseded composite_scores/social_signals/llm_analyses tables.
-- Renames signal_events -> recommendations in place (preserves FKs from
-- trade_intents.signal_id and portfolio_positions.signal_id, zero data migration).
-- Adds the v2 knowledge-base / regime / agent-output table set.
-- See tasks/v2-01-schema-migration.md for full rationale.

-- ─── 1. Drop legacy tables ───────────────────────────────────────────────────
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS composite_scores CASCADE;
DROP TABLE IF EXISTS social_signals CASCADE;
DROP TABLE IF EXISTS llm_analyses CASCADE;
-- alerts is kept: still written by supabase/functions/send-alert/

-- ─── 2. pipeline_runs (everything else FKs into it) ──────────────────────────
CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running',  -- running|completed|failed
  market_regime text,  -- risk_on|neutral|risk_off
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX pipeline_runs_run_date_idx ON pipeline_runs (run_date DESC);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_pipeline_runs" ON pipeline_runs FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_pipeline_runs" ON pipeline_runs FOR ALL TO service_role USING (true);

-- ─── 3. signal_events -> recommendations ─────────────────────────────────────
ALTER TABLE signal_events RENAME TO recommendations;

ALTER TABLE recommendations
  DROP COLUMN direction,
  DROP COLUMN composite_score,
  DROP COLUMN f_score,
  DROP COLUMN t_score,
  DROP COLUMN s_score,
  DROP COLUMN pillars_passed,
  ADD COLUMN run_id uuid REFERENCES pipeline_runs(id),
  ADD COLUMN action text NOT NULL DEFAULT 'watch',
  ADD COLUMN conviction text,
  ADD COLUMN thesis text,
  ADD COLUMN setup_type text,
  ADD COLUMN regime text,
  ADD COLUMN effective_horizon_days int,
  ADD COLUMN historical_precedent text;

ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_action_check CHECK (action in ('enter', 'watch'));
-- existing status check constraint already includes 'pending','approved','rejected','executed','expired'

ALTER INDEX signal_events_status_created_at_idx RENAME TO recommendations_status_created_at_idx;
ALTER INDEX signal_events_strategy_created_at_idx RENAME TO recommendations_strategy_created_at_idx;
CREATE INDEX recommendations_run_id_idx ON recommendations (run_id);

DROP POLICY IF EXISTS "anon read signal_events" ON recommendations;
CREATE POLICY "anon_read_recommendations" ON recommendations FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_recommendations" ON recommendations FOR ALL TO service_role USING (true);

-- ─── 4. New v2 tables ─────────────────────────────────────────────────────────

-- regime_snapshots: one row per pipeline run
CREATE TABLE regime_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  date date NOT NULL,
  regime text NOT NULL,  -- risk_on|neutral|risk_off
  spy_close numeric(12,4),
  spy_sma50 numeric(12,4),
  spy_sma200 numeric(12,4),
  spy_adx14 numeric(8,4),
  spy_vol_20d_annualized numeric(8,4),
  spy_vol_percentile_252d numeric(8,4),
  spy_drawdown_from_high_pct numeric(8,4),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX regime_snapshots_run_id_idx ON regime_snapshots (run_id);
CREATE INDEX regime_snapshots_date_idx ON regime_snapshots (date DESC);

ALTER TABLE regime_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_regime_snapshots" ON regime_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_regime_snapshots" ON regime_snapshots FOR ALL TO service_role USING (true);

-- decision_outcomes: the knowledge base (spec §12)
CREATE TABLE decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,  -- recommendation|position_review
  source_id uuid NOT NULL,
  symbol text NOT NULL,
  mode text NOT NULL DEFAULT 'shadow',  -- shadow|real
  entry_price_reference numeric(12,4),
  stop_price numeric(12,4),
  target_price numeric(12,4),
  effective_horizon_days int,
  setup_type text,
  regime text,
  resolution text NOT NULL DEFAULT 'still_open',
  -- hit_target|hit_stop|time_expired_favorable|time_expired_unfavorable|time_expired_flat|superseded|still_open
  resolved_at timestamptz,
  days_to_resolution int,
  r_multiple numeric(8,4),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX decision_outcomes_symbol_resolution_idx ON decision_outcomes (symbol, resolution);
CREATE INDEX decision_outcomes_mode_resolution_idx ON decision_outcomes (mode, resolution);

ALTER TABLE decision_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_decision_outcomes" ON decision_outcomes FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_decision_outcomes" ON decision_outcomes FOR ALL TO service_role USING (true);

-- position_reviews: verdicts on existing open positions (distinct lifecycle from recommendations)
CREATE TABLE position_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  position_id uuid NOT NULL REFERENCES portfolio_positions(id),
  symbol text NOT NULL,
  recommended_action text NOT NULL,  -- hold|trim|close|add|tighten_stop
  reasoning text,
  historical_precedent text,
  new_stop_price numeric(12,4),
  new_target_price numeric(12,4),
  trim_shares int,
  status text NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|executed|expired
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  review_note text
);

CREATE INDEX position_reviews_run_id_idx ON position_reviews (run_id);
CREATE INDEX position_reviews_status_created_at_idx ON position_reviews (status, created_at DESC);

ALTER TABLE position_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_position_reviews" ON position_reviews FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_position_reviews" ON position_reviews FOR ALL TO service_role USING (true);

-- portfolio_snapshots: daily equity/drawdown time series
CREATE TABLE portfolio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  run_id uuid REFERENCES pipeline_runs(id),
  snapshot_date date NOT NULL,
  equity numeric(18,2) NOT NULL,
  cash numeric(18,2),
  open_positions_count int,
  unrealized_pnl numeric(18,2),
  high_water_mark numeric(18,2),
  drawdown_from_high_pct numeric(8,4),
  trailing_return_pct numeric(8,4),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX portfolio_snapshots_run_id_idx ON portfolio_snapshots (run_id);
CREATE INDEX portfolio_snapshots_account_snapshot_date_idx ON portfolio_snapshots (account_id, snapshot_date DESC);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_portfolio_snapshots" ON portfolio_snapshots FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_portfolio_snapshots" ON portfolio_snapshots FOR ALL TO service_role USING (true);

-- agent_analyses: per-agent structured output (replaces llm_analyses)
CREATE TABLE agent_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  symbol text,
  agent_type text NOT NULL,  -- fundamental|technical|sentiment|synthesis|position_review
  output jsonb NOT NULL,
  prompt_version text,
  model text,
  prompt_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cost_usd numeric(10,6),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX agent_analyses_run_id_idx ON agent_analyses (run_id);
CREATE INDEX agent_analyses_run_symbol_type_idx ON agent_analyses (run_id, symbol, agent_type);

ALTER TABLE agent_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_agent_analyses" ON agent_analyses FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_agent_analyses" ON agent_analyses FOR ALL TO service_role USING (true);

-- briefings: one row per daily briefing (replaces llm_analyses analysis_type='briefing')
CREATE TABLE briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id),
  briefing_date date NOT NULL,
  regime_line text,
  urgent_flags jsonb DEFAULT '[]',
  new_recommendations_summary text,
  position_actions_summary text,
  outcomes_note text,
  portfolio_state_line text,
  full_text text NOT NULL,
  model text,
  cost_usd numeric(10,6),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX briefings_run_id_idx ON briefings (run_id);
CREATE INDEX briefings_briefing_date_idx ON briefings (briefing_date DESC);

ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_briefings" ON briefings FOR SELECT TO anon USING (true);
CREATE POLICY "service_write_briefings" ON briefings FOR ALL TO service_role USING (true);

-- ─── 5. Alter existing tables ─────────────────────────────────────────────────

-- strategies: replace all hardcoded params with jsonb config blobs
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS risk_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS screening_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS timing_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS position_mgmt_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS performance_goals jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;
-- Resolves a pre-existing bug: app/src/app/api/strategy/overview/route.ts and
-- GoalPanel.tsx referenced goal_growth_pct/goal_months/risk_level/start_equity,
-- none of which were ever migrated. Both are deleted in v2-21's legacy cleanup
-- and replaced by performance_goals jsonb + the /settings page.

-- entry_signals: add effective_horizon_days + run_id
ALTER TABLE entry_signals
  ADD COLUMN IF NOT EXISTS effective_horizon_days int,
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id);

CREATE INDEX IF NOT EXISTS entry_signals_run_id_idx ON entry_signals (run_id);

-- factor_scores: add run_id
ALTER TABLE factor_scores
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id);

CREATE INDEX IF NOT EXISTS factor_scores_run_id_idx ON factor_scores (run_id);

-- trade_intents: add overrides jsonb
ALTER TABLE trade_intents
  ADD COLUMN IF NOT EXISTS overrides jsonb;

-- Note: price_bars is a range-partitioned table (quarterly partitions 2021-2028);
-- this migration does not touch it.
