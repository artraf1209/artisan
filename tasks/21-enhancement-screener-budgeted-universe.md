# Task 21 — Dynamic Universe Screener + Budget Controls

**Status:** ⬜ pending  
**Depends on:** 04 06 20  
**Estimated effort:** 3–5 hours  

---

## Goal

Replace the static universe assumption with a dynamic, budget-aware screener pipeline that updates `universes` nightly and records degraded states explicitly when the screener is unavailable.

Full feature spec is in [specs.md §9.2–9.3](../specs.md#92-universe-funnel-and-hard-filters).

---

## Files to create

```text
engine-py/artisan/adapters/fmp_screener.py
engine-py/artisan/filters/hard_filters.py
```

## Files to modify

- `engine-py/artisan/config.py`
- `engine-py/artisan/jobs/nightly_ingest.py`
- `engine-py/tests/test_nightly_ingest.py`

---

## Screener requirements

Implement an FMP-backed screener that:

- targets active US-listed stocks
- limits to NASDAQ and NYSE
- enforces market cap > $1B
- enforces average daily volume > $5M
- filters out names listed for less than 5 years
- returns the top candidates by market cap

The active screened universe target must be configurable and default to 40 names.

---

## Budget and degradation requirements

Add engine config for:

- `SCREENER_TOP_N`
- `FUNDAMENTALS_REFRESH_LIMIT`
- any other lookback/budget knobs needed for safe nightly operation

Behavior requirements:

- nightly ingest must update `universes.active` and `universes.screened_at`
- symbols removed from the screener are not deleted; they are marked inactive
- if the screener endpoint is unavailable for the current account, the job must record a degraded state explicitly
- the job must not silently pretend the screener succeeded when it actually fell back

---

## Hard-filter requirements

Implement `passes_hard_filters()` using:

- `FCF > 0`
- `net_debt / EBITDA < 4`

The helper must be reusable by the factor model and any audit or funnel reporting.

---

## Acceptance criteria

- [ ] `fmp_screener.py` returns a screened candidate list matching the universe rules
- [ ] `hard_filters.py` exposes the required hard-filter logic
- [ ] nightly ingest updates `universes.active` and `screened_at`
- [ ] screener caps are configurable from engine settings
- [ ] degraded screener behavior is visible in logs and summaries instead of being silent
