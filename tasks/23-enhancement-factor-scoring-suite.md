# Task 23 — Factor Scoring Suite

**Status:** ⬜ pending  
**Depends on:** 20 22  
**Estimated effort:** 5–8 hours  

---

## Goal

Implement the five-factor scoring suite and composite ranker that powers `factor_scores`.

This is a separate layer from the legacy F/T/S `composite_scores` flow and must remain additive.

Full feature spec is in [specs.md §9.4](../specs.md#94-factor-model-methodology).

---

## Files to create

```text
engine-py/artisan/scorers/zscore.py
engine-py/artisan/scorers/value_scorer.py
engine-py/artisan/scorers/quality_scorer.py
engine-py/artisan/scorers/momentum_scorer.py
engine-py/artisan/scorers/low_vol_scorer.py
engine-py/artisan/scorers/growth_scorer.py
engine-py/artisan/scorers/factor_composite.py
```

## Files to modify

- `engine-py/tests/` as needed for factor coverage

---

## Methodology requirements

Apply these cross-sectional rules consistently:

- winsorize factor components at the 1st / 99th percentile within sector
- z-score within sector
- clip z-scores to `[-3, 3]`
- average available component z-scores into each factor score
- use composite weights:
  - value 25%
  - quality 25%
  - momentum 25%
  - low vol 10%
  - growth 15%

---

## Factor formulas

### Value

- `EarningsYield = net_income / market_cap`
- `BookYield = book_equity / market_cap`
- `SalesYield = revenue / market_cap`
- `FCFYield = fcf / enterprise_value`
- `EBITDAYield = ebitda / enterprise_value`

### Quality

- `GrossProfitability = gross_profit / total_assets`
- `ROA = net_income / total_assets`
- `ROE`
- `CashFlowMargin = operating_cash_flow / revenue`
- `Accruals = -(net_income - operating_cash_flow) / total_assets`
- `Leverage = -total_debt / total_assets`
- `InterestCoverage = ebitda / interest_expense`
- `NetDebtToEBITDA = -(total_debt - cash) / ebitda`

### Momentum

- `Mom_12_1 = (price[t-21] / price[t-252]) - 1`

### Low Vol

- `RealizedVol_252`
- `Beta_60m` vs `SPY`
- lower is better, so signs flip before z-scoring

### Growth

- `SalesGrowth_3y`
- `EPSGrowth_3y`
- `FCFGrowth_3y`

Use CAGR-style growth only when current and past values are both positive.

---

## Composite requirements

`factor_composite.py` must:

- apply hard filters before ranking
- score all hard-filter survivors
- store rows for the full screened universe with `hard_filter_pass`
- rank only names that passed hard filters
- mark `is_new` relative to the previous run
- populate `*_prev` delta fields from the most recent prior run

---

## Acceptance criteria

- [ ] each factor scorer matches the formulas in the spec
- [ ] sector-neutral z-scoring is reusable and covered by tests
- [ ] `factor_composite.py` writes canonical `factor_scores` rows
- [ ] hard-filter failures remain visible in `factor_scores` but are not ranked
- [ ] previous-run delta fields and `is_new` are populated correctly
