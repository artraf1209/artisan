# v2-12 — Position Review Agent

**Depends on:** v2-01, v2-04, v2-07, v2-09
**Touches:** `engine-py/artisan/agents/position_review.py` (new)

## Context

Position Review (Sonnet 5) runs over every currently open position once per pipeline run, deciding HOLD/TRIM/CLOSE/ADD/TIGHTEN_STOP. It runs *before* Synthesis in the daily pipeline (v2-14) specifically because its output determines `available_risk_budget` — how much risk capacity is left for new ENTER recommendations that day. The automatic trailing-stop ratchet (v2-07) is applied in code immediately before this agent runs, so the agent always evaluates the current, already-tightened stop rather than a stale one.

## Scope

Implement `engine-py/artisan/agents/position_review.py`, following `artisan-v2-agent-prompts.md` §5.

### Pre-step (code, not LLM)

For every row in `portfolio_positions`, call `apply_trailing_stop_ratchet()` (v2-07) with the current price; if it returns a new stop, `UPDATE portfolio_positions SET stop_price = ...` immediately, before building this agent's input.

### Input assembly per open position

- Entry details + original thesis, from the linked `recommendations` row (via `portfolio_positions.signal_id`, which now points at `recommendations` post v2-01's rename).
- Fresh `price_bars`/`indicator_values` for today.
- Unrealized P/L, R-multiple-to-date, days held, days remaining vs both `effective_horizon_days` (from the original recommendation) and the hard 30-day ceiling (`strategy_params.max_holding_period_days`).
- The already-ratcheted stop/target from the pre-step above.
- Portfolio context: sector exposure, current drawdown status (from `portfolio_snapshots`), current regime (from `regime_snapshots`).
- Any fundamentals refresh or upcoming-earnings proximity since entry (compare `fundamentals.fetched_at`/`earnings_date` against the position's `opened_at`).

### Required tool call

`query_decision_history(symbol=...)` before finalizing each position's verdict — same enforcement pattern as Synthesis (v2-11): verify at least one call happened in the transcript before accepting the forced `submit_position_review` output.

### Post-processing (code, not LLM)

- `CLOSE` / `TRIM` / `TIGHTEN_STOP`: write to `position_reviews`, and since these are risk-reducing, apply them immediately — `UPDATE portfolio_positions` accordingly (this does not go through the `/queue` approval flow; only `ADD` and stop-loosening actions require user approval per spec §10.2). Mark the corresponding `decision_outcomes` row `resolution='superseded'` if the position was closed before naturally resolving via price or time.
- `ADD` or any stop-loosening: does require validation against `check_portfolio_vetos()` (v2-07) before it's allowed to surface — if a veto fires, downgrade to `HOLD` in post-processing rather than presenting an invalid action to the user.
- **Day-30 override:** any position at or past `max_holding_period_days` — only `CLOSE` or `TRIM` are permitted outputs; if the model outputs `HOLD` or `ADD` for such a position, override it to `CLOSE` in code regardless of what the LLM said. This is a hard ceiling, not agent discretion.

### `available_risk_budget`

Computed immediately after this agent completes for all open positions: `equity * max_portfolio_heat_pct - sum(dollar_risk of all positions still open after this review's CLOSE/TRIM actions)`. This value feeds directly into Synthesis (v2-11).

## Verification
1. `engine-py/tests/test_position_review_agent.py` (new): mock `run_agent()`, verify the day-30 override forcibly converts HOLD/ADD to CLOSE, verify ADD gets downgraded to HOLD when a veto fires, verify CLOSE/TRIM/TIGHTEN_STOP apply immediately without going through `position_reviews.status='pending'`.
2. Run against a real open position (or a manually inserted `portfolio_positions` test row) end to end; confirm the trailing-stop pre-step ran before the agent call (check `portfolio_positions.stop_price` timestamp/value) and `position_reviews.historical_precedent` is populated.
3. Confirm `available_risk_budget` is computed and available to `synthesize.py` in the same pipeline run (v2-14 wiring).
