# v2-01 — Schema Migration

**Depends on:** nothing (first task)
**Touches:** `supabase/migrations/`

## Context

Artisan is being rebuilt from `artisan-v2-spec.md` (rev 5), which supersedes all v1 decisions. The current DB has two parallel lineages: a legacy TS-engine lineage (`signals`, `trades`, `positions`, `logs`) still wired to the `process-signal`/`execute-trade` edge functions, and a newer scoring-driven lineage (`signal_events`, `trade_intents`, `trade_executions`, `portfolio_positions`, `factor_scores`, `entry_signals`) that already matches most of the v2 shape. This task drops the legacy lineage and evolves the newer one into the v2 schema.

Decision (confirmed with user): clean slate for the legacy tables — they hold only paper-trading data — and rename-in-place for `signal_events` → `recommendations` to preserve existing foreign keys with zero data migration.

All table/column names below are ground-truthed against the actual 6 migration files in `supabase/migrations/` (read in full) — not assumed from naming conventions.

## Scope

Create `supabase/migrations/20260810000000_v2_schema.sql` with four ordered sections.

### 1. Drop legacy tables
```sql
DROP TABLE IF EXISTS signals CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS composite_scores CASCADE;
DROP TABLE IF EXISTS social_signals CASCADE;
DROP TABLE IF EXISTS llm_analyses CASCADE;
```
Do **not** drop `alerts` — it's still written by `supabase/functions/send-alert/` (kept as-is) and holds Telegram notification history.

### 2. Create `pipeline_runs` first (everything else FKs into it)
```sql
CREATE TABLE pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running',  -- running|completed|failed
  market_regime text,  -- risk_on|neutral|risk_off
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
```

### 3. Rename `signal_events` → `recommendations`, drop obsolete 3-pillar columns, add v2 fields
```sql
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
-- existing status check constraint already includes 'pending','approved','rejected','executed','expired' — no change needed
```
This preserves the existing FKs from `trade_intents.signal_id` and `portfolio_positions.signal_id` — they now point at `recommendations(id)` automatically, no data migration required.

### 4. Create remaining new tables
```sql
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

-- portfolio_snapshots: daily equity/drawdown time series (none exists today)
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
```

### 5. Alter existing tables
```sql
-- strategies: replace all hardcoded params with jsonb config blobs
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS risk_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS screening_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS timing_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS position_mgmt_params jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS performance_goals jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS paused_until timestamptz;
-- This resolves a pre-existing bug: app/src/app/api/strategy/overview/route.ts and
-- GoalPanel.tsx reference goal_growth_pct/goal_months/risk_level/start_equity,
-- none of which were ever migrated. Both are deleted in Legacy Cleanup (see
-- tasks/v2-21-frontend-strategy.md) and replaced by performance_goals jsonb.

-- entry_signals: add effective_horizon_days + run_id
ALTER TABLE entry_signals
  ADD COLUMN IF NOT EXISTS effective_horizon_days int,
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id);

-- factor_scores: add run_id
ALTER TABLE factor_scores
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES pipeline_runs(id);

-- trade_intents: add overrides jsonb
ALTER TABLE trade_intents
  ADD COLUMN IF NOT EXISTS overrides jsonb;
```

### 6. RLS + indexes

For every new table, mirror the exact `anon_read_<table>` (SELECT) + `service_write_<table>` (ALL, service_role) policy pattern already used on `factor_scores`/`entry_signals` — see `supabase/migrations/20260504130834_factor_scoring.sql` for the syntax to copy. Add indexes on `run_id` for every new table (all queries will filter "latest run"), plus:
- `decision_outcomes`: index on `(symbol, resolution)`, `(mode, resolution)`
- `position_reviews`: index on `(status, created_at desc)`
- `portfolio_snapshots`: index on `(account_id, snapshot_date desc)`
- `agent_analyses`: index on `(run_id, symbol, agent_type)`
- `briefings`: index on `(briefing_date desc)`

Note: `price_bars` is a range-partitioned table (quarterly partitions 2021–2028); this migration does not touch it, so no partition-aware DDL is needed.

## Verification
1. Apply the migration to the linked Supabase project (`supabase db push` or via the dashboard SQL editor).
2. Confirm all 7 new/renamed tables exist with correct columns: `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('pipeline_runs','regime_snapshots','decision_outcomes','position_reviews','portfolio_snapshots','agent_analyses','briefings','recommendations');`
3. Confirm the legacy tables are gone: `SELECT table_name FROM information_schema.tables WHERE table_name IN ('signals','trades','positions','logs','composite_scores','social_signals','llm_analyses');` should return zero rows.
4. Confirm `alerts` still exists.
5. Confirm existing FKs still resolve: `SELECT conname FROM pg_constraint WHERE conrelid = 'trade_intents'::regclass;` should still show the FK to `recommendations` (formerly `signal_events`).
