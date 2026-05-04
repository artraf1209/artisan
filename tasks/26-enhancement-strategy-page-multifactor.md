# Task 26 — Strategy Page Multi-Factor Frontend

**Status:** ⬜ pending  
**Depends on:** 16 18 20 25  
**Estimated effort:** 5–8 hours  

---

## Goal

Align `/strategy` with the multi-factor spec so it becomes the control room for:

- strategy selection
- screened-to-ranked funnel visibility
- ranked factor candidates
- ranked-shortlist timing
- the existing hybrid trade pipeline

Full feature spec is in [specs.md §9.1–9.9](../specs.md#91-page-structure).

---

## Files to modify

- `app/src/app/strategy/page.tsx`
- `app/src/components/strategy/StrategySummary.tsx`
- `app/src/components/strategy/StocksToTrade.tsx`
- `app/src/components/strategy/WhenToTrade.tsx`
- `app/src/components/strategy/TradePipeline.tsx`
- `app/src/components/strategy/TradeCard.tsx`
- `app/src/components/strategy/StrategyDropdown.tsx`
- `app/src/types/index.ts`

## Files to create

```text
app/e2e/strategy-page.spec.ts
```

---

## Block requirements

### Block 1 — Strategy Summary

- strategy selector dropdown
- universe rules
- hard filters
- factor weights
- goal metadata
- live funnel: `screened → hard-filtered → scored → in portfolio`

### Block 2 — Stocks to Trade

- ranked table, not thesis-style cards
- symbol and sector
- five factor z-scores
- previous-run deltas from `*_prev`
- composite z-score
- rank badge
- `NEW` chip for `is_new = true`
- only names with `hard_filter_pass = true`

### Block 3 — When to Trade

- only names where `rank <= strategy.max_positions`
- gate pills
- setup label
- entry, stop, target
- `R`
- shares
- dollar risk
- `actionable` highlight

### Block 4 — Trade Pipeline

- keep the existing lifecycle UI
- scope hybrid rows by selected strategy where possible
- hide or explicitly label legacy fallback rows when strategy attribution is not possible

---

## Data and type requirements

Add or extend frontend types for:

- `factor_scores`
- `entry_signals`
- `universes.active`
- `universes.screened_at`
- `indicator_values.adx_14`
- `indicator_values.obv`
- `indicator_values.vol_ratio`

---

## Acceptance criteria

- [ ] `/strategy` renders all four blocks from the updated spec
- [ ] strategy selection scopes all four blocks
- [ ] Stocks to Trade shows factor deltas and rank metadata
- [ ] When to Trade shows only the ranked shortlist
- [ ] Trade Pipeline remains intact while respecting strategy scoping rules
- [ ] frontend type coverage is updated
- [ ] an e2e or smoke test covers the route
