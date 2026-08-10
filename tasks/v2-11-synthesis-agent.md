# v2-11 — Synthesis Agent

**Depends on:** v2-04, v2-06, v2-07, v2-09, v2-10, v2-12 (needs `available_risk_budget` computed after Position Review)
**Touches:** `engine-py/artisan/agents/synthesis.py` (new)

## Context

Synthesis is the portfolio-manager agent (Sonnet 5) — it looks at the whole shortlist at once (not per-symbol like the three analyst agents) and decides which candidates become actual ENTER recommendations versus WATCH-only, subject to the day's risk budget. Its output populates `recommendations` (renamed from `signal_events` in v2-01) and immediately seeds `decision_outcomes` in shadow mode so every recommendation — approved or not — gets tracked for the knowledge base.

## Scope

Implement `engine-py/artisan/agents/synthesis.py`, following `artisan-v2-agent-prompts.md` §4.

### Input assembly

- **ENTER-eligible candidates:** shortlist members passing `hard_filter_pass` (v2-05) and `actionable` (v2-06), with no portfolio vetoes (`check_portfolio_vetos()` from v2-07 returns empty), ranked within the regime-based threshold from v2-04 (top decile in `risk_on`, top 5% in `neutral`, top 2–3 clean names in `risk_off`).
- **WATCH-eligible:** shortlisted but not ENTER-eligible (failed a gate, or ranked outside the regime threshold, or a veto fired).
- All three analyst outputs per candidate, read from `agent_analyses` for the current `run_id`.
- Market regime, from `regime_snapshots` for the current `run_id`.
- `available_risk_budget`, computed after Position Review completes (v2-12) — the daily pipeline runs `review_positions` before `synthesize` specifically so this number is known.
- Current open positions, from `portfolio_positions`.
- Performance context: trailing return from `portfolio_snapshots.trailing_return_pct` vs the 25% annual target, current drawdown vs the 18% tolerance.
- `daily_recommendation_cap` from `strategy_params.screening_params`.

### Required tool call

Before finalizing conviction on any ENTER-eligible candidate, Synthesis must call `query_decision_history(symbol=..., setup_type=..., regime=...)` — enforced by including the tool in the available set and validating (post-hoc, by checking the conversation transcript) that it was actually invoked at least once per ENTER candidate before the forced `submit_synthesis` tool call completes.

### Output

Writes rows to `recommendations`: `action` ('enter'|'watch'), `conviction`, `thesis`, `setup_type`, `regime`, `effective_horizon_days` (carried from the candidate's `entry_signals` row), `historical_precedent`, `entry_price`/`stop_price`/`target_price`/`atr_at_signal` (from `entry_signals`), `run_id`, `strategy_id`. For every `action='enter'` row, immediately insert a matching `decision_outcomes` row: `{source_type: 'recommendation', source_id: <recommendation.id>, symbol, mode: 'shadow', entry_price_reference: entry_price, stop_price, target_price, effective_horizon_days, setup_type, regime, resolution: 'still_open'}`.

### Hard caps enforced in code around the agent (not left to the LLM to self-police)

- If `available_risk_budget <= 0`, no `action='enter'` rows are permitted at all this run — Synthesis may still run for WATCH output, but any ENTER the model attempts to output gets rejected/downgraded to WATCH in post-processing.
- Total ENTER count this run cannot exceed `daily_recommendation_cap` — if the model outputs more, truncate to the top-conviction N in post-processing (do not silently let the API call fail).
- Synthesis cannot set `action='enter'` for a symbol that wasn't in the ENTER-eligible input set — post-processing validates every output row against the input eligibility list and downgrades any mismatch to `watch`.

## Verification
1. `engine-py/tests/test_synthesis_agent.py` (new): mock `run_agent()`, verify recommendations are written correctly, verify the three hard caps above are enforced even when the mocked LLM output tries to violate them (over-cap ENTER count, ENTER with zero risk budget, ENTER on a non-eligible symbol).
2. Run end to end against a real shortlist post v2-10; confirm `recommendations` rows have `historical_precedent` populated and `decision_outcomes` shadow rows exist 1:1 with `action='enter'` rows.
3. Confirm `query_decision_history` was actually called (check `agent_analyses.output` or request/response logs) for at least one ENTER candidate in a real run.
