# v2-20 — /history Page (Decision Knowledge Base)

**Depends on:** v2-01, v2-08, v2-11, v2-12
**Touches:** `app/src/app/history/page.tsx` (new), `app/src/app/api/history/route.ts` (new)

## Context

`decision_outcomes` is the knowledge base agents query via `query_decision_history` (v2-08) before making new calls. This page makes that same data browsable by the user directly — the human-facing mirror of what the agents already see, useful for understanding why the system's conviction on a setup type or symbol has shifted over time.

## Scope

### `app/src/app/api/history/route.ts` (new)

Query `decision_outcomes` joined with `recommendations` (for `thesis`, `conviction`) and `position_reviews` (for `source_type='position_review'` rows), supporting query params: `symbol`, `setup_type`, `regime`, `resolution`, `mode`.

### `app/src/app/history/page.tsx`

**Filters:** symbol, setup_type, regime, resolution (hit_target / hit_stop / time_expired_favorable / time_expired_unfavorable / time_expired_flat / superseded / still_open), mode (real / shadow).

**Stats bar at top** (recomputes as filters change): aggregate `win_rate`, `avg_r_multiple`, total `count`, real-vs-shadow breakdown — same computation as `query_decision_history`'s `aggregate` block (v2-08), just exposed over HTTP instead of as an agent tool.

**Per-row:** symbol, `run_date` (via linked `pipeline_runs`), action/recommended_action, conviction, thesis (truncated with expand), setup_type, regime, effective_horizon_days, entry_price_reference, stop_price, target_price, resolution, days_to_resolution, r_multiple.

## Verification
1. `cd app && bun run build` passes.
2. With a mix of resolved and still-open `decision_outcomes` rows (from a few completed v2-14 pipeline runs), load `/history`, confirm the table and stats bar render correctly.
3. Apply each filter individually and confirm the row set and stats bar both narrow correctly (i.e. the stats bar reflects the filtered set, not the global aggregate).
4. Cross-check one row's `win_rate` contribution manually against the raw `decision_outcomes` table via SQL to confirm the aggregate math matches `query_decision_history`'s implementation exactly (both should use identical logic — consider sharing the aggregate SQL/query between the Python tool and this API route if the ORM/query builder allows it, to avoid drift).
