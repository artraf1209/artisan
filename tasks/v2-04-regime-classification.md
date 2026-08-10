# v2-04 — Market Regime Classification

**Depends on:** v2-01, v2-02, v2-03
**Touches:** `engine-py/artisan/scoring/regime.py` (new module — note: existing `engine-py/artisan/scorers/` is a different, unrelated directory that stays as-is; `scoring/` is new and does not collide)

## Context

The v2 spec introduces a 3-state market regime classification (`risk_on` / `neutral` / `risk_off`) computed once per pipeline run from SPY price data. Every downstream decision — which candidates are ENTER-eligible vs WATCH-only, how long a position's effective holding horizon is — depends on this single classification. It must be computed exactly once per run and persisted, not recomputed ad hoc by each consumer.

## Scope

Create `engine-py/artisan/scoring/regime.py`:

```python
def classify_regime(spy_bars: pd.DataFrame) -> dict:
    """
    spy_bars: DataFrame of SPY price_bars, at least 252 trading days, sorted ascending by bar_time.

    risk_on:  close > SMA50 > SMA200, SMA200 slope positive over trailing 20d,
              ADX_14 > 15, 20d annualized realized vol below the trailing 252d median,
              close within 5% of the trailing 252d high.
    risk_off: close < SMA200, OR 20d annualized vol above the trailing 252d 80th percentile,
              OR close more than 10% below the trailing 252d high.
    neutral:  everything else.

    Returns: {
      "regime": "risk_on" | "neutral" | "risk_off",
      "spy_close": float, "spy_sma50": float, "spy_sma200": float, "spy_adx14": float,
      "spy_vol_20d_annualized": float, "spy_vol_percentile_252d": float,
      "spy_drawdown_from_high_pct": float,
    }
    """
```

Indicator computation reuses `pandas-ta` (already a dependency) for SMA/ADX; annualized 20d vol = `daily_returns.rolling(20).std() * sqrt(252)`; percentile is computed against the trailing 252-day distribution of that same rolling series.

Wire this into the `score` job (created in v2-14, `artisan/jobs/score.py`) as the **first** step of the daily pipeline: load `SPY` bars from `price_bars`, call `classify_regime()`, insert one row into `regime_snapshots` tagged with the current `run_id`, and update `pipeline_runs.market_regime`. Every other job in the pipeline (`review_positions`, `synthesize`, `briefing`) reads the regime back from `regime_snapshots` by `run_id` — none of them call `classify_regime()` themselves.

### ENTER-eligibility rank thresholds per regime (spec §5.1 + §9.2)

Not part of `regime.py` itself, but the direct consumer — implemented in v2-06/v2-11:
- `risk_on`: top decile of `composite_z` (top 10% of the shortlist)
- `neutral`: top 5% of the shortlist
- `risk_off`: top 2–3 names only, and only if all entry gates cleanly pass (no near-misses)

## Verification
1. `engine-py/tests/test_regime.py` (new): construct synthetic SPY bar DataFrames for each of the three regime cases (trending up with low vol → risk_on; choppy/near SMA200 → neutral; below SMA200 or high vol or deep drawdown → risk_off) and assert `classify_regime()` returns the expected label and plausible intermediate values.
2. Run against real `price_bars` data for `SPY` after v2-03 has ingested it; sanity-check the classification against what the market is actually doing (manual eyeball check, not automated).
3. Confirm one `regime_snapshots` row is written per pipeline run once wired into `score.py` in v2-14.
