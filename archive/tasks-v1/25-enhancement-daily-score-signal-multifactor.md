# Task 25 — Daily Score + Signal Multi-Factor Orchestration

**Status:** ⬜ pending  
**Depends on:** 12 13 23 24  
**Estimated effort:** 3–5 hours  

---

## Goal

Wire the multi-factor model and shortlist timing flow into `daily_score_signal.py` without breaking the existing F/T/S scoring, signal generation, human approval, or thesis generation paths.

Full feature spec is in [specs.md §9.5–9.6](../specs.md#95-entry-timing-model).

---

## Files to modify

- `engine-py/artisan/jobs/daily_score_signal.py`
- `engine-py/tests/test_daily_score_signal.py`

---

## Orchestration requirements

After the existing F/T/S scoring path:

1. load the active universe
2. load DB-resident fundamentals history and price history
3. compute `factor_scores`
4. rank hard-filter survivors
5. select the shortlist where `rank <= strategy.max_positions`
6. compute `entry_signals` only for that shortlist
7. run thesis generation for `signal_events` as before

Preserve:

- `indicator_values`
- `composite_scores`
- `signal_events`
- thesis generation and queue flow

Do not:

- fetch live FMP history during daily scoring
- generate `entry_signals` for the whole screened universe

---

## Summary and audit requirements

The job summary should include at least:

- symbols processed
- factor score rows written
- shortlist size
- entry signals written
- thesis created / skipped / failed

Audit log output must make the new multi-factor stages visible.

---

## Acceptance criteria

- [ ] `daily_score_signal.py` preserves the legacy F/T/S signal path
- [ ] `factor_scores` are computed from DB-resident data
- [ ] `entry_signals` are generated only for the ranked shortlist
- [ ] job summary and audit rows include factor/timing counts
- [ ] tests verify shortlist-only timing evaluation
