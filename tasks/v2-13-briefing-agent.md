# v2-13 — Briefing Agent

**Depends on:** v2-08, v2-09, v2-11, v2-12
**Touches:** `engine-py/artisan/agents/daily_briefing.py` (new)

## Context

The Briefing agent (Haiku 4.5 — cheap, runs last, summarizes rather than reasons) turns the completed pipeline run into a human-readable daily summary, written to the new `briefings` table and pushed to Telegram via the existing `send-alert` edge function. It's the last step in the daily pipeline (v2-14).

## Scope

Implement `engine-py/artisan/agents/daily_briefing.py`, following `artisan-v2-agent-prompts.md` §6.

### Input assembly — everything from the just-completed pipeline run

- Market regime + whether it changed from the prior run (compare `regime_snapshots` for this `run_id` vs the immediately preceding one).
- New recommendations summary — count and highlights from this run's `recommendations` where `action='enter'`.
- Position review actions summary — from this run's `position_reviews`.
- Expired items — from this run's `expire_stale` step (v2-08) output/count.
- Resolved `decision_outcomes` from this run's `track_outcomes` step (v2-08), both `mode='real'` and `mode='shadow'`.
- Current `portfolio_snapshots` row (equity, `drawdown_from_high_pct`, `trailing_return_pct`) written during ingest (v2-03).

### Output

One `briefings` row: `run_id`, `briefing_date`, `regime_line`, `urgent_flags` (jsonb array — populate when e.g. a position is within days of the 30-day ceiling, or drawdown is approaching the tolerance limit, or a stop was hit), `new_recommendations_summary`, `position_actions_summary`, `outcomes_note`, `portfolio_state_line`, `full_text` (the complete formatted briefing), `model`, `cost_usd`.

### Telegram notification

After writing the `briefings` row, call the `send-alert` edge function (kept as-is, unchanged in this rebuild) with a condensed payload: `urgent_flags` (if any, prefixed with a warning marker per v2-24's bot formatting), `regime_line`, `new_recommendations_summary`, `portfolio_state_line`. Do not push `full_text` verbatim to Telegram — that's what the `/briefings` page (v2-23) is for; the push notification is a summary that links back.

## Verification
1. `engine-py/tests/test_briefing_agent.py` (new): mock `run_agent()`, verify a `briefings` row is written with all fields populated, verify `send-alert` is called with the condensed (not full) payload.
2. Run end to end after a full pipeline run (v2-11/v2-12 completed); confirm the Telegram message actually arrives via the bot and that `urgent_flags` correctly triggers when a test position is manually set near the 30-day ceiling.
3. Confirm `full_text` reads as coherent prose, not a raw data dump — check against the tone/format described in `artisan-v2-agent-prompts.md` §6.
