# Task 15 — Execution: Alpaca Executor

**Status:** ⬜ pending  
**Depends on:** 12  
**Estimated effort:** 3–5 hours  

---

## Goal
Implement the Python execution layer that reads approved `trade_intents`, submits market orders to Alpaca paper trading, and writes `trade_executions` plus `portfolio_positions`.

---

## Files to create

```text
engine-py/artisan/execution/__init__.py
engine-py/artisan/execution/alpaca_executor.py
engine-py/tests/test_alpaca_executor.py
```

---

## Implementation notes

- Define an abstract `BrokerAdapter` interface.
- Implement:
  - `AlpacaAdapter`
  - `PaperAdapter` if a local no-op fallback is useful for tests
- Read only `trade_intents` with `status='pending'`.
- Submit market orders to Alpaca paper trading.
- Persist:
  - `trade_executions`
  - updated `trade_intents.status`
  - upserted `portfolio_positions`
- Sync account equity and cash back to `accounts` if the API makes it easy.
- Store `raw_response` for auditability.
- Handle rejected and partial fills explicitly.

---

## Order rules

- Phase 0 order type: `market` only
- Asset class: US equities only
- Paper endpoint only unless explicitly configured otherwise
- Respect quantity and stop/target values already computed upstream

---

## Acceptance criteria

- [ ] Approved pending intents are submitted to Alpaca paper trading
- [ ] `trade_executions` rows capture broker order id and status
- [ ] `portfolio_positions` is upserted after fills
- [ ] Failed broker responses are persisted and auditable
- [ ] Unit tests cover filled and rejected order paths
