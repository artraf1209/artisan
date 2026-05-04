# Task 22 — Extended Fundamentals History + SPY Ingest

**Status:** ⬜ pending  
**Depends on:** 04 06 20 21  
**Estimated effort:** 4–6 hours  

---

## Goal

Upgrade nightly ingest so the database contains all factor inputs needed by the multi-factor model:

- extended FMP fundamentals fields
- trailing annual fundamentals history
- `SPY` benchmark bars
- budgeted fundamentals refreshes instead of full-universe refetches every run

Full feature spec is in [specs.md §9.3–9.4](../specs.md#93-fmp-budget-and-ingest-requirements).

---

## Files to modify

- `engine-py/artisan/adapters/fmp_fundamentals.py`
- `engine-py/artisan/jobs/nightly_ingest.py`
- `engine-py/tests/test_fmp_fundamentals.py`
- `engine-py/tests/test_nightly_ingest.py`

---

## Adapter requirements

Extend the FMP fundamentals adapter to fetch and persist:

- cash-flow statement
- balance-sheet statement
- annual income history
- annual cash-flow history where required for growth scoring

Persist at minimum:

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

Implementation rules:

- annual history must be saved into `fundamentals`, not fetched live during daily scoring
- `ebitda` may be derived when the raw field is absent
- store enough history to support 3-year growth calculations

---

## Nightly ingest requirements

Update `nightly_ingest.py` to:

- include `SPY` in the price bar fetch
- ingest enough lookback history to support both `Momentum 12m-1m` and `Beta_60m`
- refresh only the missing or stalest fundamentals subset each run
- score from the full active universe later, using DB-resident data

The refresh subset should be budget-aware and configurable.

---

## Acceptance criteria

- [ ] `fundamentals` rows include the extended fields required by the factor model
- [ ] annual fundamentals history is present in the database
- [ ] nightly price ingest includes `SPY`
- [ ] nightly ingest refreshes only a budgeted subset of active symbols
- [ ] tests cover both extended field mapping and refresh-selection behavior
