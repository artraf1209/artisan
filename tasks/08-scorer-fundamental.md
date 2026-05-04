# Task 08 — Scorer: Fundamental

**Status:** ⬜ pending  
**Depends on:** 06  
**Estimated effort:** 2–3 hours  

---

## Goal
Create the fundamental pillar scorer that converts FMP ratios into a normalized `f_score` for each symbol.

---

## Files to create

```text
engine-py/artisan/scorers/fundamental.py
engine-py/tests/test_fundamental_scorer.py
```

---

## Implementation notes

- Read the latest `fundamentals` row per symbol.
- Score the Phase 0 metrics named in `specs.md`:
  - P/E ratio
  - P/B ratio
  - ROE
  - debt/equity
- If sector-relative scoring is feasible from current data, use it.
- If sector-relative scoring is not yet feasible, implement sensible fixed-band scoring and note that sector normalization is deferred.
- Return a normalized `f_score` in `[0, 1]`.
- Expose the score with a breakdown so later tasks can explain why the symbol passed or failed.

---

## Suggested rubric

- Lower P/E is better, but clamp extreme values.
- Lower P/B is better, but avoid over-rewarding distressed outliers.
- Higher ROE is better.
- Lower debt/equity is better.
- Average the metric sub-scores, ignoring null fields and tracking how many inputs were available.

---

## Acceptance criteria

- [ ] `f_score` is normalized to `[0, 1]`
- [ ] Missing ratio fields do not crash scoring
- [ ] Scorer exposes component-level reasoning for later audit and LLM tasks
- [ ] Unit tests cover strong, weak, and partial-data examples
