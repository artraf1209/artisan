# v2-08 — Knowledge Base Plumbing

**Depends on:** v2-01
**Touches:** `engine-py/artisan/jobs/track_outcomes.py` (new), `engine-py/artisan/jobs/expire_stale.py` (new), `engine-py/artisan/agents/tools.py` (new, only the `query_decision_history` piece — the `agents/` package itself is created in v2-09)

## Context

The `decision_outcomes` knowledge base (spec §12) is what lets the AI agents learn from history — every recommendation and position review, whether approved or not, gets tracked to resolution, and agents can query aggregate win-rate/R-multiple stats before making a new call. This task builds the two pure-code jobs that maintain the knowledge base (no LLM involved) plus the tool function agents use to query it.

## Scope

### 1. `engine-py/artisan/jobs/track_outcomes.py`

For every `decision_outcomes` row where `resolution = 'still_open'`:
- Load the latest price for `symbol` from `price_bars`.
- Resolve in this priority order:
  1. `price >= target_price` → `resolution = 'hit_target'`
  2. `price <= stop_price` → `resolution = 'hit_stop'`
  3. `days since created_at > effective_horizon_days` → `resolution = 'time_expired_favorable'` if `price > entry_price_reference`, `'time_expired_unfavorable'` if `price < entry_price_reference`, else `'time_expired_flat'`
  4. For `source_type = 'position_review'` rows where the linked position was closed early by a subsequent Position Review CLOSE action (not via hitting stop/target/time) → `'superseded'`
  5. Otherwise: leave as `'still_open'`, no update.
- On resolution: `UPDATE decision_outcomes SET resolution=..., resolved_at=now(), days_to_resolution=..., r_multiple=(exit_price - entry_price_reference) / (entry_price_reference - stop_price) WHERE id = ...`
- Pure code, no LLM call, no cost.

### 2. `engine-py/artisan/jobs/expire_stale.py`

For every `recommendations` row where `status = 'pending'` and `run_id != current_run_id`, and every `position_reviews` row where `status = 'pending'` and `run_id != current_run_id`: `UPDATE ... SET status = 'expired'`. This is **queue hygiene only** — it never touches `decision_outcomes`. A recommendation that expires unactioned still has its `decision_outcomes` row tracked in shadow mode by `track_outcomes.py` regardless of queue status.

### 3. `engine-py/artisan/agents/tools.py` — `query_decision_history`

```python
def query_decision_history(symbol: str | None = None, setup_type: str | None = None, regime: str | None = None, limit: int = 20) -> dict:
    """
    Filters decision_outcomes by any combination of symbol/setup_type/regime (all optional —
    omitting all three returns portfolio-wide aggregate stats). Returns:
    {
      "aggregate": {
        "win_rate": hit_target / (hit_target + hit_stop),
        "avg_r_multiple": float,
        "avg_days_to_resolution": float,
        "count": int, "real_count": int, "shadow_count": int
      },
      "recent": [ {symbol, resolution, r_multiple, days_to_resolution, setup_type, regime, resolved_at,
                   thesis_summary (from linked recommendations.thesis, truncated)} ... up to `limit` ]
    }
    """
```

This is the Python implementation backing the `query_decision_history` tool schema every agent calls via Anthropic tool use (schema defined in `agents/base.py`, built in v2-09).

## Verification
1. `engine-py/tests/test_track_outcomes.py` (new): seed a `decision_outcomes` row in each unresolved state, mock current price, assert correct resolution + `r_multiple` math for each of the 5 branches above.
2. `engine-py/tests/test_expire_stale.py` (new): seed `recommendations`/`position_reviews` rows across two different `run_id`s, assert only the stale ones flip to `expired`, and that `decision_outcomes` rows are untouched by this job.
3. `engine-py/tests/test_query_decision_history.py` (new): seed a mix of resolved/shadow/real rows, assert `aggregate.win_rate` and `avg_r_multiple` compute correctly, assert filters (symbol/setup_type/regime) narrow results as expected.
