-- Seed file for local development and remote bootstrap.
-- Upserts the v2 default strategy config (risk/screening/timing/position/perf
-- params live in jsonb so they're editable from /settings without a deploy —
-- see tasks/v2-02-strategies-seed.md and artisan-v2-spec.md §13).

INSERT INTO strategies (
  id, name, horizon, active,
  risk_params, screening_params, timing_params, position_mgmt_params, performance_goals
)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'artisan_v2',
  'swing',
  true,
  '{
    "risk_per_trade_pct": 0.01,
    "max_position_pct": 0.10,
    "max_concurrent_positions": 15,
    "max_sector_exposure_pct": 0.25,
    "max_portfolio_heat_pct": 0.08,
    "daily_drawdown_kill_switch_pct": -0.03,
    "max_drawdown_tolerance_pct": 0.18
  }'::jsonb,
  '{
    "shortlist_size": 50,
    "daily_recommendation_cap": 10,
    "factor_weights": {"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15}
  }'::jsonb,
  '{
    "max_holding_period_days": 30,
    "horizon_baseline_days": {"pullback": 20, "breakout": 15, "squeeze": 10},
    "regime_multipliers": {"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
    "earnings_blackout_pre_days": 3,
    "earnings_blackout_post_days": 1
  }'::jsonb,
  '{
    "trailing_stop_atr_multiple": 2,
    "breakeven_trigger_r": 1,
    "auto_apply_stop_tightening": true
  }'::jsonb,
  '{
    "target_annual_return_pct": 0.25,
    "max_drawdown_tolerance_pct": 0.18,
    "benchmark_symbol": "SPY",
    "llm_daily_cost_cap_usd": 5.0
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  horizon = EXCLUDED.horizon,
  active = EXCLUDED.active,
  risk_params = EXCLUDED.risk_params,
  screening_params = EXCLUDED.screening_params,
  timing_params = EXCLUDED.timing_params,
  position_mgmt_params = EXCLUDED.position_mgmt_params,
  performance_goals = EXCLUDED.performance_goals;
