# Task 04 — Adapter: FMP Fundamentals

**Status:** ⬜ pending  
**Depends on:** 02  
**Estimated effort:** 2–3 hours  

---

## Goal
Create the Python adapter that fetches point-in-time valuation and profitability data from Financial Modeling Prep and stores it in `fundamentals`.

---

## Files to create

```text
engine-py/artisan/adapters/fmp_fundamentals.py
engine-py/tests/test_fmp_fundamentals.py
```

---

## Implementation notes

- Create an `FmpFundamentalsAdapter` class using `FMP_API_KEY`.
- Fetch enough FMP endpoints to populate the Phase 0 fields:
  - `pe_ratio`
  - `pb_ratio`
  - `roe`
  - `debt_equity`
  - `revenue`
  - `net_income`
  - `eps`
  - `earnings_date`
- Prefer one adapter method per concern:
  - `fetch_profile(symbol: str)`
  - `fetch_key_metrics(symbol: str)`
  - `fetch_ratios(symbol: str)`
  - `fetch_income_statement(symbol: str)`
  - `fetch_earnings_calendar(symbol: str)`
- Add `build_fundamental_row(symbol: str) -> dict`.
- Store one latest row per symbol with:
  - `period_end`
  - `period_type='annual'` for Phase 0 unless quarterly is clearly available
  - `source='fmp'`
  - `fetched_at=now()`
- Upsert with unique key `(symbol, period_end, period_type)`.
- Update `assets` when sector, exchange, or company name are available from FMP.

---

## Edge cases

- Some symbols may not have all ratios on the same endpoint; allow nullable fields.
- If the earnings calendar is unavailable, store the financial row without `earnings_date`.
- Respect FMP free-tier limits and keep requests serialized for Phase 0.

---

## Testing

- Mock FMP responses for one symbol with complete data.
- Mock a partial response where some ratios are missing.
- Verify the adapter still writes a valid row with nullable fields.
- Verify the `assets` upsert uses symbol metadata when present.

---

## Acceptance criteria

- [ ] Adapter writes one `fundamentals` row per symbol in the universe
- [ ] `earnings_date` is populated when FMP provides it
- [ ] `assets` metadata is refreshed from FMP profile data
- [ ] Missing ratio fields do not crash the ingest
- [ ] Unit tests cover complete and partial responses
