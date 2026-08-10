# v2-03 — Nightly Ingest Rewrite

**Depends on:** v2-01, v2-02
**Touches:** `engine-py/artisan/jobs/nightly_ingest.py`, `.github/workflows/nightly-ingest.yml`

## Context

`nightly_ingest.py` already exists and works (pulls universe, prices, fundamentals, news via the 4 adapters in `engine-py/artisan/adapters/`). This task rewrites it in place — same module path, so `uv run python -m artisan.jobs.nightly_ingest` and the existing GitHub Actions workflow keep working unchanged except for two additions: reading params from the DB instead of any hardcoded values, and anchoring every write to a `pipeline_runs` row.

## Scope

Rewrite `engine-py/artisan/jobs/nightly_ingest.py`. Keep using the existing adapters (`AlpacaPricesAdapter`, `FmpFundamentalsAdapter`, `FinnhubNewsAdapter`, `FmpScreenerAdapter`) unchanged — only the orchestration around them changes:

1. **Start of run:** `INSERT INTO pipeline_runs (run_date, status) VALUES (today, 'running') RETURNING id` — capture `run_id`, thread it through every subsequent write via `audit_log.payload`.
2. **Load strategy params:** `get_strategy_params(settings.strategy_id)` from v2-02 — no hardcoded universe size, no hardcoded lookback windows.
3. **Universe refresh:** `FmpScreenerAdapter.screen()` → upsert into `universes` (existing table, already has `active`/`screened_at` columns from `20260504130834_factor_scoring.sql`).
4. **Price bars:** `AlpacaPricesAdapter` for every active universe symbol + `SPY` (already implemented, keep as-is).
5. **Fundamentals:** `FmpFundamentalsAdapter` for every active universe symbol.
6. **News:** `FinnhubNewsAdapter` for every active universe symbol.
7. **Portfolio snapshot (new):** fetch current Alpaca account (`GET /v2/account` — equity, cash) via a lightweight direct call (this is a read, not an order — doesn't violate the "execute-trade is the only Alpaca order path" rule). Compute:
   - `high_water_mark = max(prior portfolio_snapshots.high_water_mark, current equity)` (read the most recent snapshot row first; if none exists, `high_water_mark = current equity`)
   - `drawdown_from_high_pct = (current equity - high_water_mark) / high_water_mark`
   - `trailing_return_pct` vs the oldest snapshot within a trailing window (e.g. 252 calendar days, or the oldest available if shorter)
   - `open_positions_count`, `unrealized_pnl` from `portfolio_positions`
   - Insert one `portfolio_snapshots` row. This is the **only** place in the whole system that writes `portfolio_snapshots` — no other job touches it.
8. **End of run:** `UPDATE pipeline_runs SET status = 'completed', completed_at = now() WHERE id = run_id` (or `'failed'` in the exception handler).
9. **Audit log:** write one `audit_log` row summarizing symbol counts, any adapter failures, and `run_id` in `payload`.

Reuse the existing `write_audit_log()` helper and `is_within_fmp_quota_window()` guard already in this file — both are still correct for v2.

### Workflow update

`.github/workflows/nightly-ingest.yml` needs one change: after the ingest job succeeds, it should trigger `daily_pipeline.yml` (created in v2-14). Do this via `workflow_run` triggered `on: workflow_run: workflows: ["Nightly Ingest"], types: [completed]` inside `daily_pipeline.yml` itself (not by adding a trigger step here) — so no change to `nightly-ingest.yml` is actually required beyond leaving it as-is. Keep the existing `workflow_dispatch` + `force_pre_reset` input and the FMP quota guard logic untouched.

## Verification
1. `uv run pytest engine-py/tests/test_nightly_ingest.py` passes (update the test file for the new `pipeline_runs`/`portfolio_snapshots` writes).
2. Manually trigger via `gh workflow run nightly-ingest.yml -f force_pre_reset=true`, confirm a new `pipeline_runs` row appears with `status='completed'` and a `portfolio_snapshots` row appears with a plausible `drawdown_from_high_pct` (0 on first run).
3. Confirm `universes`, `price_bars`, `fundamentals`, `news_articles` all show fresh `fetched_at`/`bar_time` timestamps after the run.
