# Task 10 — Scorer: Composite

**Status:** ⬜ pending  
**Depends on:** 07 08 09  
**Estimated effort:** 2–3 hours  

---

## Goal
Combine the three pillar scores into the weighted composite defined in `specs.md` and persist the result to `composite_scores`.

---

## Files to create

```text
engine-py/artisan/scorers/composite.py
engine-py/tests/test_composite_scorer.py
```

---

## Implementation notes

- Read active strategy weights from `strategies`:
  - `f_weight`
  - `t_weight`
  - `s_weight`
  - `threshold`
- Compute:
  - `composite = f_score * 0.50 + t_score * 0.25 + s_score * 0.25`
  - or use the weights stored on the active strategy row
- Count `pillars_passed` as the number of pillar scores above `strategy.threshold`.
- Save one row per symbol per scoring run to `composite_scores`.
- Return a result object that downstream signal logic can consume directly.

---

## Acceptance criteria

- [ ] Weights are read from `strategies`, not hard-coded only in Python
- [ ] `composite_scores` rows persist `f_score`, `t_score`, `s_score`, `composite`, and `pillars_passed`
- [ ] Composite scoring is deterministic
- [ ] Unit tests verify weight math and pass-count logic
