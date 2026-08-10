# v2-14 — Daily Pipeline Workflow

**Depends on:** v2-01 through v2-13 (this is the wiring task that connects everything into one scheduled workflow)
**Touches:** `.github/workflows/daily_pipeline.yml` (new), `engine-py/artisan/jobs/score.py` (new), `track_outcomes.py`/`expire_stale.py` (wrapping v2-08 logic into runnable job entry points), `review_positions.py` (new), `synthesize.py` (new), `briefing.py` (new)

## Context

This task assembles the 6 previously-built pieces (regime classification, factor scoring, entry gates, knowledge base jobs, and the 4 non-analyst-batch agents) into one chained GitHub Actions workflow that runs automatically after each nightly ingest, replacing the old single-job `daily-score-signal.yml`/`daily-briefing.yml` workflows.

## Scope

### Workflow: `.github/workflows/daily_pipeline.yml`

- **Trigger:** `on: workflow_run: workflows: ["Nightly Ingest"], types: [completed]`, gated to only proceed when `github.event.workflow_run.conclusion == 'success'`. Also `workflow_dispatch` for manual runs/debugging.
- **Six jobs, chained with `needs:`** so each only starts after the previous succeeds:
  ```yaml
  jobs:
    score:            # regime + factor scoring + gates + horizon
    track_outcomes:   # needs: score
    expire_stale:     # needs: track_outcomes
    review_positions: # needs: expire_stale
    synthesize:       # needs: review_positions
    briefing:         # needs: synthesize
  ```
- Each job: `working-directory: engine-py`, `uv sync` then `uv run python -m artisan.jobs.<job_name>`. Env vars mirror `nightly-ingest.yml`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALPACA_API_KEY`/`ALPACA_API_SECRET`/`ALPACA_BASE_URL`, `FMP_API_KEY`, `FINNHUB_API_KEY`, `ANTHROPIC_API_KEY`, `STRATEGY_ID`, `ACCOUNT_ID`, `ADMIN_USER_ID`, `LOG_LEVEL`.
- Every job resolves the current `run_id` by reading the most recent `pipeline_runs` row created by `nightly_ingest.py` (v2-03) rather than creating a new one — the whole day's pipeline (ingest through briefing) shares a single `pipeline_runs` row.

### New job entry points

- **`artisan/jobs/score.py`** — orchestrates, in order: `classify_regime()` (v2-04) on `SPY` bars → write `regime_snapshots` → `score_universe()` (v2-05) → write `factor_scores` → `evaluate_entry()` for the shortlist (v2-06), computing `performance_multiplier` from the latest `portfolio_snapshots.drawdown_from_high_pct` and calling `compute_effective_horizon()` per candidate → write `entry_signals`. Updates `pipeline_runs.market_regime`.
- **`artisan/jobs/track_outcomes.py`** — thin CLI wrapper around the logic built in v2-08.
- **`artisan/jobs/expire_stale.py`** — thin CLI wrapper around the logic built in v2-08.
- **`artisan/jobs/review_positions.py`** — applies `apply_trailing_stop_ratchet()` (v2-07) to every open position, then runs the Position Review agent (v2-12) over all of them, computes `available_risk_budget`.
- **`artisan/jobs/synthesize.py`** — runs the 3 analyst agents in parallel per shortlisted symbol (v2-10), then the Synthesis agent (v2-11) using the `available_risk_budget` computed by the previous job.
- **`artisan/jobs/briefing.py`** — runs the Briefing agent (v2-13), triggers the Telegram push via `send-alert`.

Each job entry point follows the existing `if __name__ == "__main__":` pattern already used by `nightly_ingest.py` and the other job modules — no new invocation convention introduced.

## Verification
1. Trigger `daily_pipeline.yml` manually via `gh workflow run daily_pipeline.yml` (after ensuring a `nightly-ingest` run has completed recently so a `pipeline_runs` row exists to attach to) — confirm all 6 jobs show green in the Actions UI, in order.
2. After a full run, confirm each of `regime_snapshots`, `factor_scores`, `entry_signals`, resolved `decision_outcomes`, `position_reviews`, `agent_analyses`, `recommendations`, `briefings` has fresh rows tagged with the same `run_id`.
3. Deliberately break one job (e.g. temporarily raise an exception in `score.py`) and confirm downstream jobs (`track_outcomes` etc.) do **not** run, per the `needs:` chain — and that `pipeline_runs.status` ends up `'failed'`.
