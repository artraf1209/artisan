# Task 03 — Adapter: Alpaca Prices

**Status:** ⬜ pending  
**Depends on:** 02  
**Estimated effort:** 2–3 hours  

---

## Goal
Create the Python market-data adapter that fetches daily OHLCV bars from Alpaca Data API v2 and upserts them into `price_bars`.

---

## Files to create

```text
engine-py/artisan/adapters/__init__.py
engine-py/artisan/adapters/alpaca_prices.py
engine-py/tests/test_alpaca_prices.py
```

---

## Implementation notes

- Create an `AlpacaPricesAdapter` class that accepts an optional `httpx.Client` and uses `artisan.config.settings`.
- Fetch daily bars from Alpaca Data API v2 for one or more symbols.
- Normalize each bar to:
  - `symbol`
  - `bar_time`
  - `open`
  - `high`
  - `low`
  - `close`
  - `volume`
  - `vwap`
  - `source='alpaca'`
- Add a `fetch_daily_bars(symbols: list[str], start: date, end: date) -> list[dict]` method.
- Add a `save_bars(rows: list[dict]) -> int` method that upserts on `(symbol, bar_time)`.
- Handle Alpaca pagination if the response returns `next_page_token`.
- Use retries with `tenacity` for transient HTTP failures and `429` rate limits.
- Log request counts and inserted row counts for later job orchestration.

---

## API contract

- Base URL comes from `ALPACA_BASE_URL`.
- Use the market data endpoint shape:
  - `/v2/stocks/bars`
- Required query params:
  - `symbols`
  - `timeframe=1Day`
  - `start`
  - `end`
  - `adjustment=raw`
- Auth headers:
  - `APCA-API-KEY-ID`
  - `APCA-API-SECRET-KEY`

---

## Testing

- Mock Alpaca HTTP responses with one multi-symbol payload.
- Cover pagination with at least two pages.
- Verify the adapter converts timestamps to UTC `timestamptz`-safe ISO strings.
- Verify `save_bars()` calls Supabase with the expected payload and `upsert`.

---

## Acceptance criteria

- [ ] Adapter fetches daily bars for all 10 seeded universe symbols
- [ ] Pagination is supported
- [ ] Upsert targets `price_bars` with `source='alpaca'`
- [ ] Duplicate runs do not create duplicate rows
- [ ] Unit tests pass for transform and persistence behavior
