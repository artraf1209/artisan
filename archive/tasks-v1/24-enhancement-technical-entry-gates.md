# Task 24 — Technical Enrichments + Entry Gates

**Status:** ⬜ pending  
**Depends on:** 07 20 22  
**Estimated effort:** 4–6 hours  

---

## Goal

Expand the technical layer so the strategy can evaluate shortlist timing with explicit gate outputs and stored risk sizing.

Full feature spec is in [specs.md §9.5](../specs.md#95-entry-timing-model).

---

## Files to modify

- `engine-py/artisan/scorers/technical.py`

## Files to create

```text
engine-py/artisan/timing/entry_gates.py
engine-py/tests/test_entry_gates.py
```

---

## Technical scorer requirements

Add persisted indicator outputs for:

- `adx_14`
- `obv`
- `vol_ratio = volume / SMA50(volume)`

The existing technical scorer must continue to produce the legacy fields already used by the F/T/S path.

---

## Entry gate requirements

Implement `evaluate_entry()` with:

- **Gate 0: Market regime** — `SPY` above SMA200 and SMA50 above SMA200
- **Gate 1: Trend** — close > SMA200, SMA50 > SMA200, SMA200 slope positive, ADX > 20
- **Gate 2: Setup** — pullback, breakout, or squeeze
- **Gate 3: Confirmation** — RSI < 70, MACD histogram rising, `vol_ratio > 1.2`, OBV rising, relative strength vs SPY
- **Gate 4: Risk** — ATR-based stop and target
- **Gate 5: Position sizing** — shares and dollar risk from strategy rules

Return fields that map directly into `entry_signals`.

---

## Acceptance criteria

- [ ] `indicator_values` writes `adx_14`, `obv`, and `vol_ratio`
- [ ] entry-gate logic covers all gates from the spec
- [ ] relative strength vs `SPY` is part of confirmation
- [ ] tests cover trend-slope and relative-strength behavior at minimum
- [ ] entry-gate outputs map cleanly to `entry_signals`
