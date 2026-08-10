# v2-10 — Fundamental, Technical, Sentiment Agents

**Depends on:** v2-09
**Touches:** `engine-py/artisan/agents/fundamental_analyst.py`, `technical_analyst.py`, `sentiment_analyst.py` (all new)

## Context

These are the three per-symbol, per-shortlisted-candidate analyst agents. Each takes one symbol's data and produces a structured opinion consumed later by Synthesis (v2-11). They all follow the same shape — load prompt, build symbol-specific context, force the submit tool, persist to `agent_analyses` — using the shared `run_agent()` from v2-09's `base.py`.

## Scope

Implement three modules, each following the corresponding prompt section in `artisan-v2-agent-prompts.md`:

- **`fundamental_analyst.py`** (§1) — input: `fundamentals` row(s) for the symbol (income/balance/ratios history), `factor_scores` value/quality/growth sub-scores. Tools available: `query_decision_history`, `get_fundamentals_detail` (a tool that fetches deeper historical fundamentals on demand, defined in `agents/tools.py`). Forces `submit_fundamental_analysis`.
- **`technical_analyst.py`** (§2) — input: recent `price_bars`, `indicator_values` (RSI/MACD/Bollinger/ATR/SMA/ADX/OBV), the symbol's `entry_signals` row (setup_type, gates, effective_horizon_days) from v2-06. Tools available: `query_decision_history`. Forces `submit_technical_analysis`.
- **`sentiment_analyst.py`** (§3) — input: recent `news_articles` (headline, summary, VADER `vader_compound`) for the symbol. Tools available: `query_decision_history`. Forces `submit_sentiment_analysis`.

### Shared pattern (each module)

1. `load_prompt("<name>")` from v2-09.
2. Build the user content block: static/cacheable prefix (little to none per-agent since most context is symbol-specific), then per-symbol data appended last.
3. Call `run_agent(..., forced_tool_name="submit_<x>_analysis")`.
4. Validate the returned dict has all required fields, especially `historical_precedent` (mandatory per spec on every agent's output — if missing, treat as an error, not a silently-accepted partial result).
5. Insert one `agent_analyses` row: `{run_id, symbol, agent_type: "fundamental"|"technical"|"sentiment", output: <full dict as jsonb>, prompt_version, model, prompt_tokens, output_tokens, cache_read_tokens, cost_usd}`.

### Orchestration

Called from `orchestrator.py` (v2-09) or directly from `synthesize.py` (v2-14) — for each symbol in the shortlist that is either ENTER-eligible or WATCH-eligible (from v2-05/v2-06), run all three analysts concurrently via `asyncio.gather`. At a 30-symbol shortlist that's up to 90 concurrent API calls — guard with an `asyncio.Semaphore(10)` to stay within Anthropic rate limits.

## Verification
1. `engine-py/tests/test_analyst_agents.py` (new, one test class per agent): mock `run_agent()` to return a valid/invalid payload, assert the module correctly writes to `agent_analyses` on valid output and raises/logs clearly on missing `historical_precedent` or other required fields.
2. Run against one real symbol from a live shortlist (e.g. the top-ranked `factor_scores` row) end to end, confirm three `agent_analyses` rows appear (`agent_type` = fundamental/technical/sentiment) with populated `cost_usd`.
3. Time a full 30-symbol shortlist run with the semaphore in place; confirm no 429 rate-limit errors from the Anthropic API.
