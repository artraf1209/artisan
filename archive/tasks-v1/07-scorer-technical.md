# Task 07 — Scorer: Technical

**Status:** ⬜ pending  
**Depends on:** 06  
**Estimated effort:** 2–3 hours  

---

## Goal
Compute the technical indicators described in `specs.md`, persist them to `indicator_values`, and expose a normalized technical pillar score in `[0, 1]`.

---

## Files to create

```text
engine-py/artisan/scorers/__init__.py
engine-py/artisan/scorers/technical.py
engine-py/tests/test_technical_scorer.py
```

---

## Implementation notes

- Read price history from `price_bars`.
- Compute at least:
  - RSI-14
  - MACD line / signal / histogram
  - ATR-14
  - Bollinger upper / mid / lower
  - SMA-50
  - SMA-200
- Save the latest computed row for each symbol into `indicator_values`.
- Add a scoring function that returns:
  - raw indicator snapshot
  - normalized `t_score`
- Use deterministic scoring rules so the same inputs produce the same output.

---

## Suggested scoring rubric

- RSI contribution:
  - reward `40-60` most
  - penalize extreme overbought or oversold
- MACD contribution:
  - reward bullish crossover and positive histogram
- Trend contribution:
  - reward price above `SMA-50` and `SMA-200`
- Volatility contribution:
  - use ATR and Bollinger width only as light modifiers

The exact formula can differ, but the final technical score must be bounded to `[0, 1]`.

---

## Acceptance criteria

- [ ] Indicator rows are written to `indicator_values`
- [ ] `t_score` is deterministic and normalized to `[0, 1]`
- [ ] The scorer handles symbols with insufficient history gracefully
- [ ] Unit tests cover at least one bullish and one weak setup
