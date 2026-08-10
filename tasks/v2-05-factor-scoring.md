# v2-05 — Factor Scoring + Shortlisting

**Depends on:** v2-01, v2-02, v2-03
**Touches:** `engine-py/artisan/scorers/factor_composite.py`, `value_scorer.py`, `quality_scorer.py`, `momentum_scorer.py`, `low_vol_scorer.py`, `growth_scorer.py`, `zscore.py` (all existing — modified in place, not rewritten from scratch)

## Context

The existing factor-scoring suite (`engine-py/artisan/scorers/{factor_composite,value_scorer,quality_scorer,momentum_scorer,low_vol_scorer,growth_scorer,zscore}.py`) already implements sector-neutral z-scoring across value/quality/momentum/low_vol/growth factors — this logic is sound and kept. What changes for v2 is where the configuration comes from: currently factor weights and shortlist size are hardcoded (`FACTOR_WEIGHTS` constant, some fixed top-N); v2 requires these to come from `strategies.screening_params` (seeded in v2-02) so they're editable via `/settings` without a code deploy.

Note: this is unrelated to the legacy `scorers/composite.py`/`fundamental.py`/`sentiment.py`/`technical.py` modules (the old 3-pillar system) — those are deleted entirely per the rebuild plan, not touched by this task.

## Scope

1. **`factor_composite.py`:** `score_universe()` signature changes from implicit/hardcoded config to explicit required args:
   ```python
   def score_universe(strategy_params: StrategyParams, run_id: str) -> None:
       ...
   ```
   Replace the hardcoded `FACTOR_WEIGHTS` dict with `strategy_params.factor_weights` (keys: `value`, `quality`, `momentum`, `low_vol`, `growth` — validated to sum to ~1.0 in v2-02).
2. **Shortlist size:** replace any hardcoded top-N with `strategy_params.shortlist_size` (default 30 per the v2-02 seed, down from the v1 default of 40).
3. **`hard_filter_pass`:** unchanged — still computed via `engine-py/artisan/filters/hard_filters.py` as a pre-condition before ranking, using the same positive-FCF/positive-EBITDA/debt-cash checks as v1.
4. **`is_new` flag:** true if a symbol is in this run's top-N `factor_scores` but was not in the immediately preceding run's top-N (query the most recent `factor_scores` row per symbol before this run's `scored_at`/`run_id`).
5. **`run_id`:** every `factor_scores` row written by this run must carry the `run_id` column added in v2-01.
6. **Factor formulas themselves:** unchanged from v1 — `value_scorer.py` (EarningsYield/BookYield/SalesYield/FcfYield/EbitdaYield), `quality_scorer.py` (profitability + leverage/safety), `momentum_scorer.py` (12-1 month, sector-neutral), `low_vol_scorer.py` (252d realized vol + 60m beta, inverted), `growth_scorer.py` (CAGR-based), `zscore.py` (`zscore_sector_neutral()`, `mean_of_zscores()`, winsorized). No changes needed to these five files beyond whatever plumbing is required to pass `run_id` through to their output.

## Verification
1. `uv run pytest engine-py/tests/test_factor_scorers.py` passes after updating for the new `score_universe(strategy_params, run_id)` signature.
2. Run against real `fundamentals`/`price_bars` data from a v2-03 ingest; confirm `factor_scores` rows are written with non-null `run_id`, `composite_z`, `rank`, and that the top-30 (or whatever `shortlist_size` is currently set to) matches `rank <= shortlist_size`.
3. Change `strategies.screening_params.shortlist_size` to a different value directly in the DB, rerun, confirm the shortlist size changes without a code deploy — proves the config-driven wiring actually works end to end.
