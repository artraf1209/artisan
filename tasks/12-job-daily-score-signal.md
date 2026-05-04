# Task 12 — Job: Daily Score + Signal

**Status:** ⬜ pending  
**Depends on:** 11  
**Estimated effort:** 2–4 hours  

---

## Goal
Create the scheduled job that computes indicators and scores, writes pending signals, and leaves them ready for human approval in the UI.

---

## Files to create

```text
engine-py/artisan/jobs/daily_score_signal.py
.github/workflows/daily-score-signal.yml
engine-py/tests/test_daily_score_signal.py
```

---

## Implementation notes

- Orchestrate the Phase 0 morning market-open workflow:
  1. load universe
  2. compute technical indicators
  3. compute fundamental, technical, and sentiment pillar scores
  4. compute composite scores
  5. apply confluence and veto logic
  6. write `signal_events` with `status='pending'`
- Add audit logging at each stage.
- Print a final summary including:
  - symbols processed
  - pending signals created
  - symbols vetoed
- Keep trade execution out of this task; execution is handled in Task 15.

---

## Workflow requirements

- Add `.github/workflows/daily-score-signal.yml`.
- Trigger:
  - `schedule` at `30 13 * * 1-5`
  - `workflow_dispatch`
- Run `uv run python -m artisan.jobs.daily_score_signal`.

---

## Acceptance criteria

- [ ] Workflow file matches the `1:30 PM UTC` schedule in the spec
- [ ] Job writes `indicator_values`, `composite_scores`, and `signal_events`
- [ ] Pending signals are visible in the database for frontend approval
- [ ] Audit rows exist for each major stage
