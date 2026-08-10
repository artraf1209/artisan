# v2-06 — Technical Gates + Effective Horizon

**Depends on:** v2-01, v2-02, v2-04, v2-05
**Touches:** `engine-py/artisan/timing/entry_gates.py` (existing — rewritten in place, module path unchanged)

## Context

`entry_gates.py` already implements the gate sequence (market/trend/setup-detection/confirmation) and ATR-based stop/target sizing for pullback/breakout/squeeze setups. Two things change for v2: Gate 0 (market condition) now reads the regime computed once per run in v2-04 instead of doing its own live SPY check, and every actionable signal gets a new `effective_horizon_days` field — the core v2 concept that caps how long a position is expected to be held, scaled by setup type, market regime, and recent portfolio performance.

## Scope

1. **Gate 0 (market):** replace the existing live SPY SMA50/200 check with a read of `regime_snapshots` for the current `run_id` (passed in as an argument, produced by v2-04's `classify_regime()` earlier in the same pipeline run). `risk_off` regime narrows what's actionable per the v2-04 rank-threshold rules; it does not hard-block Gate 0 by itself — the rank thresholds are enforced later in Synthesis (v2-11).
2. **Gate 1 (trend):** unchanged — `ADX_14 > 20`.
3. **Setup detection (pullback/breakout/squeeze):** unchanged — keep all existing detection rules and their ATR-based stop/target/entry price formulas.
4. **New: `effective_horizon_days` computation** (spec §5.2):
   ```python
   def compute_effective_horizon(
       setup_type: str, regime: str, performance_multiplier: float, strategy_params: StrategyParams
   ) -> int:
       baseline = strategy_params.horizon_baseline_days[setup_type]      # pullback=20, breakout=15, squeeze=10
       regime_mult = strategy_params.regime_multipliers[regime]          # risk_on=1.0, neutral=0.85, risk_off=0.65
       perf_mult = min(1.0, performance_multiplier)                      # never inflates above 1.0
       return min(int(baseline * regime_mult * perf_mult), strategy_params.max_holding_period_days)  # hard ceiling 30
   ```
5. **`performance_multiplier`:** defaults to `1.0`; drops to `0.8` when the current portfolio drawdown (from the latest `portfolio_snapshots.drawdown_from_high_pct`, written in v2-03) is worse than or equal to half of `max_drawdown_tolerance_pct` (i.e. ≥9% drawdown when tolerance is 18%). This value is computed once in `score.py` (v2-14) and passed into every `compute_effective_horizon()` call for the run.
6. Store `effective_horizon_days` on every `entry_signals` row (column added in v2-01). Write `run_id` on every row.
7. `trend_score` (0–1 continuous, used for ranking near-misses in the UI) — keep the existing computation unchanged.

## Verification
1. `uv run pytest engine-py/tests/test_entry_gates.py` passes after updating for the `regime` param and the new `effective_horizon_days` field.
2. Add explicit unit tests for `compute_effective_horizon()`: each of the 3 setup types × 3 regimes × {performance_multiplier=1.0, 0.8} = 18 cases, verifying the ceiling caps correctly (e.g. `pullback` + `risk_on` + `1.0` = 20, uncapped; confirm no combination ever exceeds `max_holding_period_days`).
3. Run against real shortlist data from v2-05; confirm `entry_signals.effective_horizon_days` is populated and never null for `actionable = true` rows.
