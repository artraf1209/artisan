# v2-22 — /settings Page

**Depends on:** v2-01, v2-02
**Touches:** `app/src/app/settings/page.tsx` (existing — contents fully replaced), `app/src/app/api/settings/update/route.ts` (new)

## Context

Every decision threshold in v2 lives in `strategies`' five jsonb columns (seeded in v2-02), specifically so it's editable here without a code deploy. `app/src/app/settings/page.tsx` already exists as a route but predates the v2 config model — this task replaces its contents entirely.

## Scope

### Page: six config groups per spec §13, one row per param

- **Risk & Sizing** (`risk_params`): `risk_per_trade_pct`, `max_position_pct`, `max_concurrent_positions`, `max_sector_exposure_pct`, `max_portfolio_heat_pct`, `daily_drawdown_kill_switch_pct`.
- **Screening & Shortlisting** (`screening_params`): `shortlist_size`, `daily_recommendation_cap`, `factor_weights` (5 sub-fields, must sum to 1.0).
- **Timing & Horizon** (`timing_params`): `max_holding_period_days`, `horizon_baseline_days` (3 sub-fields: pullback/breakout/squeeze), `regime_multipliers` (3 sub-fields: risk_on/neutral/risk_off), `earnings_blackout_pre_days`, `earnings_blackout_post_days`.
- **Position Management** (`position_mgmt_params`): `trailing_stop_atr_multiple`, `breakeven_trigger_r`, `auto_apply_stop_tightening` (boolean).
- **Performance Goals** (`performance_goals`): `target_annual_return_pct`, `max_drawdown_tolerance_pct`, `benchmark_symbol`.
- **Cost Control** (`performance_goals`): `llm_daily_cost_cap_usd`.

Each param row: label, editable input (with the current value pre-filled from `strategies`), min/max hint text (bounds documented in v2-02), and a one-line description of what it controls.

### `app/src/app/api/settings/update/route.ts` (new)

1. Validate every submitted value against the min/max bounds from v2-02 (including `factor_weights` summing to ~1.0 within tolerance) — reject the whole request with field-specific errors if anything is out of bounds, don't partially apply.
2. Read the current `strategies` row.
3. Write the updated jsonb column(s) back (merge, don't replace whole objects, so unrelated fields in the same jsonb blob aren't clobbered by a partial-form submission).
4. Insert an `audit_log` row: `{actor: <user>, action: 'config_update', entity: 'strategies', entity_id: <strategy_id>, payload: {param, old_value, new_value, changed_at}}` — one row per changed param, not one row per save action, so the audit trail is granular.
5. Return success.

Show a "last modified" timestamp (from the most recent matching `audit_log` row) and a static note that changes take effect on the next pipeline run, not retroactively.

## Verification
1. `cd app && bun run build` passes.
2. Change a value (e.g. `shortlist_size` from 30 to 20), save, confirm `strategies.screening_params.shortlist_size` updates in the DB and an `audit_log` row is written.
3. Submit an out-of-bounds value (e.g. `risk_per_trade_pct = 0.5`), confirm the API rejects with a clear field-specific error and the DB is unchanged.
4. Submit `factor_weights` that don't sum to 1.0, confirm rejection.
5. Confirm the next v2-14 pipeline run actually picks up the changed `shortlist_size` (cross-check against v2-05's verification step, which already tests this wiring).
