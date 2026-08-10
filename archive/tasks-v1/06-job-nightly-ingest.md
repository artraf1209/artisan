# Task 06 — Job: Nightly Ingest

**Status:** ⬜ pending  
**Depends on:** 03 04 05  
**Estimated effort:** 2–4 hours  

---

## Goal
Create the orchestration job that runs each weeknight at `2:00 AM UTC`, ingests prices, fundamentals, and news for the seeded universe, and records the run in `audit_log`.

---

## Files to create

```text
engine-py/artisan/jobs/__init__.py
engine-py/artisan/jobs/nightly_ingest.py
.github/workflows/nightly-ingest.yml
engine-py/tests/test_nightly_ingest.py
```

---

## Implementation notes

- Read the active strategy from `settings.strategy_id`.
- Load the 10-symbol universe from `universes`.
- Run the adapters in order:
  1. Alpaca prices
  2. FMP fundamentals
  3. Finnhub news
- Use a lookback window suitable for daily bars and daily news:
  - prices: enough history for later indicator work, minimum 260 trading days
  - news: last 24 hours for weeknights, longer catch-up on Mondays
- Write structured audit rows after each ingest step.
- Print a concise run summary for GitHub Actions logs.
- Exit non-zero if a critical ingest step fully fails.
- Allow partial-symbol failures without losing the whole run; record them in `audit_log`.

---

## Workflow requirements

- Add `.github/workflows/nightly-ingest.yml`.
- Trigger:
  - `schedule` at `0 2 * * 1-5`
  - `workflow_dispatch`
- Steps:
  - checkout
  - install Python 3.12
  - install `uv`
  - `uv sync` in `engine-py/`
  - run `uv run python -m artisan.jobs.nightly_ingest`
- Provide the required secrets as environment variables.

---

## Acceptance criteria

- [ ] Workflow file exists and matches the `2:00 AM UTC` schedule
- [ ] Job reads symbols from `universes`, not a hard-coded list
- [ ] Prices, fundamentals, and news ingest in one run
- [ ] `audit_log` records at least one row per ingest stage
- [ ] Partial failures are logged without silent success
