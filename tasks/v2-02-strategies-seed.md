# v2-02 — Strategies Config Seed

**Depends on:** v2-01 (schema migration)
**Touches:** `supabase/seed.sql`, `engine-py/artisan/config.py` (or a new `engine-py/artisan/strategy_params.py`)

## Context

Per the v2 spec, every decision threshold (risk sizing, screening, timing/horizon, position management, performance goals) must live in the DB as editable configuration, not as hardcoded constants in code. This is what makes the `/settings` page (v2-22) meaningful — changes there take effect on the next pipeline run without a deploy. `v2-01` added five jsonb columns to `strategies` (`risk_params`, `screening_params`, `timing_params`, `position_mgmt_params`, `performance_goals`); this task seeds them with the v2 defaults from spec §13 and builds the typed reader every downstream module uses.

## Scope

### 1. Seed data

`supabase/seed.sql` is currently empty (just a commented-out example). Add an upsert for the existing strategy row (id `00000000-0000-0000-0000-000000000010`, already seeded by `20260503000000_hybrid_engine_phase0.sql` as `long_term_v0`):

```sql
INSERT INTO strategies (id, name, is_active, risk_params, screening_params, timing_params, position_mgmt_params, performance_goals)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'artisan_v2',
  true,
  '{
    "risk_per_trade_pct": 0.01,
    "max_position_pct": 0.10,
    "max_concurrent_positions": 15,
    "max_sector_exposure_pct": 0.25,
    "max_portfolio_heat_pct": 0.08,
    "daily_drawdown_kill_switch_pct": -0.03,
    "max_drawdown_tolerance_pct": 0.18
  }',
  '{
    "shortlist_size": 30,
    "daily_recommendation_cap": 10,
    "factor_weights": {"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15}
  }',
  '{
    "max_holding_period_days": 30,
    "horizon_baseline_days": {"pullback": 20, "breakout": 15, "squeeze": 10},
    "regime_multipliers": {"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
    "earnings_blackout_pre_days": 3,
    "earnings_blackout_post_days": 1
  }',
  '{
    "trailing_stop_atr_multiple": 2,
    "breakeven_trigger_r": 1,
    "auto_apply_stop_tightening": true
  }',
  '{
    "target_annual_return_pct": 0.25,
    "max_drawdown_tolerance_pct": 0.18,
    "benchmark_symbol": "SPY",
    "llm_daily_cost_cap_usd": 5.0
  }'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  risk_params = EXCLUDED.risk_params,
  screening_params = EXCLUDED.screening_params,
  timing_params = EXCLUDED.timing_params,
  position_mgmt_params = EXCLUDED.position_mgmt_params,
  performance_goals = EXCLUDED.performance_goals;
```

### 2. Typed Python reader

Add `engine-py/artisan/strategy_params.py`:

```python
@dataclass(frozen=True)
class StrategyParams:
    # risk_params
    risk_per_trade_pct: float
    max_position_pct: float
    max_concurrent_positions: int
    max_sector_exposure_pct: float
    max_portfolio_heat_pct: float
    daily_drawdown_kill_switch_pct: float
    max_drawdown_tolerance_pct: float
    # screening_params
    shortlist_size: int
    daily_recommendation_cap: int
    factor_weights: dict[str, float]
    # timing_params
    max_holding_period_days: int
    horizon_baseline_days: dict[str, int]
    regime_multipliers: dict[str, float]
    earnings_blackout_pre_days: int
    earnings_blackout_post_days: int
    # position_mgmt_params
    trailing_stop_atr_multiple: float
    breakeven_trigger_r: float
    auto_apply_stop_tightening: bool
    # performance_goals
    target_annual_return_pct: float
    benchmark_symbol: str
    llm_daily_cost_cap_usd: float

def get_strategy_params(strategy_id: str) -> StrategyParams:
    """Reads the strategies row and flattens its 5 jsonb columns into a typed dataclass."""
```

Every downstream engine module (v2-04 through v2-15) calls `get_strategy_params(settings.strategy_id)` once per job invocation and threads the result through — never re-reads hardcoded values.

### 3. Validation bounds (used by v2-22's `/api/settings/update`)

Document min/max per param for later reuse by the settings page validation:
- `risk_per_trade_pct`: 0.001–0.05
- `max_position_pct`: 0.02–0.25
- `max_concurrent_positions`: 3–30
- `max_sector_exposure_pct`: 0.10–0.50
- `max_drawdown_tolerance_pct`: 0.05–0.35
- `shortlist_size`: 10–60
- `daily_recommendation_cap`: 1–25
- `max_holding_period_days`: 5–60
- factor weights must sum to 1.0 (±0.01 tolerance)

## Verification
1. Apply `seed.sql` against the linked project; confirm `SELECT risk_params, screening_params FROM strategies WHERE id = '00000000-0000-0000-0000-000000000010';` returns the expected jsonb.
2. `uv run python -c "from artisan.strategy_params import get_strategy_params; print(get_strategy_params('00000000-0000-0000-0000-000000000010'))"` returns a fully populated `StrategyParams`.
3. Add `engine-py/tests/test_strategy_params.py` covering: happy path, missing jsonb key raises clearly, malformed jsonb raises clearly.
