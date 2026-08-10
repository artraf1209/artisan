# v2-21 — /strategy Page

**Depends on:** v2-01, v2-04, v2-05, v2-06
**Touches:** `app/src/app/strategy/page.tsx` (existing — simplified), `app/src/components/strategy/StrategySummary.tsx`, `WhenToTrade.tsx`, `TradePipeline.tsx`, `GoalPanel.tsx`, `UniverseThesis.tsx` (all deleted per Legacy Cleanup), `app/src/app/api/strategy/overview/route.ts` (deleted), `app/src/app/api/strategy/trades/route.ts` (kept/updated)

## Context

The current `/strategy` page mixes a selection funnel (screened → hard-filtered → scored → in-portfolio counts), a goal panel referencing DB columns that were never migrated (`goal_growth_pct` etc. — see v2-01's note), and several other v1-era components. v2 simplifies this down to three focused sections that surface the regime/scoring/gates pipeline transparently, matching what the agents themselves see.

## Scope

Rewrite `app/src/app/strategy/page.tsx` with three sections, dropping the funnel entirely:

1. **Market Regime** — latest `regime_snapshots` row (by `run_id`/`date` descending): color-coded pill (green=risk_on, yellow=neutral, red=risk_off) plus the underlying inputs (SPY close vs SMA50/SMA200, ADX, vol percentile, drawdown from high).

2. **Shortlist + Factor Scores** — table of the latest run's `factor_scores` (up to `shortlist_size`, default 30), sorted by `composite_z` descending. Columns: rank, symbol, sector, value_z, quality_z, momentum_z, low_vol_z, growth_z, composite_z, `hard_filter_pass`, and a computed "ENTER-eligible" column (rank falls within the current regime's threshold from v2-04: top decile in risk_on, top 5% in neutral, top 2-3 in risk_off). Show each z-score's delta vs. the immediately preceding run (using the `*_prev` columns already on `factor_scores`).

3. **Entry Gates** — for ENTER-eligible symbols only: gate status pills (market/trend/setup/confirmation), `setup_type`, `entry_price`/`stop_price`/`target_price`/`r_multiple`, `effective_horizon_days`.

### Deletions (this task owns them, listed fully in Legacy Cleanup)

- `components/strategy/GoalPanel.tsx`, `UniverseThesis.tsx`, `StrategySummary.tsx` (funnel), `WhenToTrade.tsx`, `TradePipeline.tsx` — remove all five; none map to a v2 concept on this page (queue/positions pages absorb what TradePipeline showed).
- `app/src/app/api/strategy/overview/route.ts` — deleted (backed the funnel + the never-migrated goal columns).
- `app/src/app/api/strategy/trades/route.ts` — kept but updated to query `factor_scores`/`entry_signals` instead of any legacy table.

## Verification
1. `cd app && bun run build` passes with the five deleted components fully removed (no dangling imports).
2. Load `/strategy` after a real v2-14 pipeline run; confirm the regime pill matches `regime_snapshots`, the factor table matches `factor_scores`, and the ENTER-eligible column correctly reflects the regime-based rank threshold from v2-04.
3. Confirm z-score deltas render correctly (up/down arrows or similar) by comparing two consecutive runs.
