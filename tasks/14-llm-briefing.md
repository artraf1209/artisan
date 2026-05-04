# Task 14 — LLM: Daily Briefing

**Status:** ⬜ pending  
**Depends on:** 12  
**Estimated effort:** 2–3 hours  

---

## Goal
Create the daily morning briefing generator that summarizes recent signals and notable news into one `llm_analyses` briefing row.

---

## Files to create

```text
engine-py/artisan/llm/daily_briefing.py
.github/workflows/daily-briefing.yml
engine-py/tests/test_daily_briefing.py
```

---

## Implementation notes

- Use model `claude-haiku-4-5-20251001`.
- Gather inputs from:
  - yesterday's `signal_events`
  - recent `trade_intents` / `trade_executions` if present
  - top positive and negative recent headlines
- Produce one account-level morning summary for the admin user.
- Store the result in `llm_analyses` with:
  - `analysis_type='briefing'`
  - `symbol=NULL`
  - `signal_id=NULL`
- Keep the briefing concise and operational:
  - recent activity
  - strongest watchlist names
  - important news context

---

## Workflow requirements

- Add `.github/workflows/daily-briefing.yml`.
- Trigger:
  - `schedule` at `30 11 * * 1-5`
  - `workflow_dispatch`
- Run `uv run python -m artisan.llm.daily_briefing`.

---

## Acceptance criteria

- [ ] Workflow file matches the `11:30 AM UTC` schedule
- [ ] One `briefing` row is inserted per run
- [ ] Briefing content summarizes actual database state from recent signals and news
- [ ] Briefing rows can be rendered later without extra transformation
