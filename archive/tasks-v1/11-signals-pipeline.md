# Task 11 — Signals Pipeline

**Status:** ⬜ pending  
**Depends on:** 10  
**Estimated effort:** 3–4 hours  

---

## Goal
Create the pipeline that turns composite scores into pending signal rows, applying the confluence gate and the Phase 0 veto rules.

---

## Files to create

```text
engine-py/artisan/pipeline/__init__.py
engine-py/artisan/pipeline/signals.py
engine-py/tests/test_signals_pipeline.py
```

---

## Implementation notes

- Read latest `composite_scores`, `indicator_values`, and `fundamentals`.
- Apply the confluence gate from the spec:
  - signal passes only if at least 2 of 3 pillars exceed `strategy.threshold`
- Apply veto rules:
  - `earnings_blackout_veto`: block signals within `+-3` calendar days of `earnings_date`
  - `anomaly_placeholder`: always passes for Phase 0
- Infer signal direction:
  - Phase 0 only needs `long` or `flat`
  - only create a `signal_events` row for actionable `long` ideas
- Compute risk fields for each signal:
  - `atr_at_signal`
  - `stop_price = entry - 2 * ATR(14)`
  - `target_price = entry + 3 * ATR(14)`
- Persist pending rows to `signal_events`.
- Write audit rows for created and vetoed signals.

---

## Acceptance criteria

- [ ] Only symbols with at least 2 passing pillars become candidate signals
- [ ] Earnings blackout veto blocks symbols within `+-3` calendar days
- [ ] Signal rows persist stop, target, ATR, and score data
- [ ] Vetoed symbols are explainable through audit output
- [ ] Unit tests cover pass, veto, and flat/no-signal cases
