# Task 20 — Factor Layer Migration

**Status:** ⬜ pending  
**Depends on:** 01  
**Estimated effort:** 2–4 hours  

---

## Goal

Extend the hybrid-engine schema so the multi-factor strategy layer has first-class tables and columns instead of overloading the legacy F/T/S path.

This task is the schema foundation for:

- dynamic universes
- richer annual fundamentals history
- technical indicator enrichments
- `factor_scores`
- `entry_signals`

Full feature spec is in [specs.md §9.2–9.6](../specs.md#92-universe-funnel-and-hard-filters).

---

## Files to create

```text
supabase/migrations/20260504xxxxxx_factor_scoring_extensions.sql
```

If the repo already contains an earlier factor migration, update the migration chain so local and remote history remain aligned.

---

## Required schema changes

### `universes`

Add:

- `active boolean not null default true`
- `screened_at timestamptz`

### `fundamentals`

Add:

- `fcf`
- `operating_cash_flow`
- `gross_profit`
- `total_assets`
- `total_debt`
- `book_equity`
- `cash`
- `ebitda`
- `market_cap`
- `interest_expense`

The schema must support storing trailing annual history, not just the latest row.

### `indicator_values`

Add:

- `adx_14`
- `obv`
- `vol_ratio`

### `factor_scores`

Create table with:

- identity columns: `id`, `symbol`, `strategy_id`, `scored_at`
- factor z-scores: `value_z`, `quality_z`, `momentum_z`, `low_vol_z`, `growth_z`
- previous-run deltas: `value_prev`, `quality_prev`, `momentum_prev`, `low_vol_prev`, `growth_prev`
- ranking columns: `composite_z`, `rank`, `is_new`
- audit columns: `hard_filter_pass`, `sector`
- unique constraint on `symbol, strategy_id, scored_at`

### `entry_signals`

Create table with:

- identity columns: `id`, `symbol`, `strategy_id`, `evaluated_at`
- gate columns: `gate_market`, `gate_trend`, `setup_type`, `gate_confirmed`
- risk columns: `entry_price`, `stop_price`, `target_price`, `atr`, `r_multiple`
- sizing columns: `shares`, `dollar_risk`
- final state column: `actionable`
- unique constraint on `symbol, strategy_id, evaluated_at`

---

## Implementation notes

- Preserve existing `composite_scores` and `signal_events`; this is additive.
- Add RLS for read access from the app and write access from the service role.
- Add indexes where needed for latest-run queries by `strategy_id` and descending timestamp.
- Keep migration idempotent with `if not exists` semantics where possible.

---

## Acceptance criteria

- [ ] `universes`, `fundamentals`, and `indicator_values` expose all new columns from the spec
- [ ] `factor_scores` exists with the expected z-score, delta, ranking, and audit columns
- [ ] `entry_signals` exists with the expected gate, risk, and sizing columns
- [ ] Existing Phase 0 tables remain intact
- [ ] Migration can be applied without breaking the current app or engine
