from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from artisan.db.client import get_client
from artisan.strategy_params import StrategyParams

logger = logging.getLogger(__name__)

MAX_CONCURRENT_ANALYST_CALLS = 10

# v2-10 through v2-13 supply the actual per-agent callables that plug into the
# generic runners below (analyze_fundamental/technical/sentiment, synthesize,
# review_positions, write_briefing) — this module provides the shared
# orchestration plumbing (agent_analyses writes, concurrency, risk-budget math)
# so each of those tasks only implements its agent-specific input assembly and
# output handling, not the wiring around it.


def write_agent_analysis(
    db: Any,
    *,
    run_id: str,
    symbol: str | None,
    agent_type: str,
    output: dict[str, Any],
    prompt_version: str,
    model: str,
    prompt_tokens: int,
    output_tokens: int,
    cache_read_tokens: int,
    cost_usd: float | None,
) -> None:
    """The single agent_analyses row writer every agent call site uses."""
    db.table("agent_analyses").insert(
        {
            "run_id": run_id,
            "symbol": symbol,
            "agent_type": agent_type,
            "output": output,
            "prompt_version": prompt_version,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cost_usd": cost_usd,
        }
    ).execute()


AnalystFn = Callable[[str], Awaitable[dict[str, Any]]]


async def run_analysts_for_shortlist(
    symbols: list[str],
    analyst_fns: dict[str, AnalystFn],
    *,
    max_concurrency: int = MAX_CONCURRENT_ANALYST_CALLS,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Runs the given analyst coroutines (keyed by agent_type, e.g.
    {"fundamental": fundamental_analyst.analyze, "technical": ..., "sentiment": ...})
    across every shortlisted symbol concurrently, bounded by a semaphore so we
    never exceed max_concurrency simultaneous Anthropic calls (up to 3 analysts x
    a ~30-symbol shortlist = up to 90 calls per run).

    Returns {symbol: {agent_type: <that agent's parsed output dict>}}.
    """
    semaphore = asyncio.Semaphore(max_concurrency)

    async def _run_one(symbol: str, agent_type: str, fn: AnalystFn) -> tuple[str, str, dict[str, Any]]:
        async with semaphore:
            result = await fn(symbol)
        return symbol, agent_type, result

    tasks = [
        _run_one(symbol, agent_type, fn)
        for symbol in symbols
        for agent_type, fn in analyst_fns.items()
    ]
    results = await asyncio.gather(*tasks)

    by_symbol: dict[str, dict[str, dict[str, Any]]] = {symbol: {} for symbol in symbols}
    for symbol, agent_type, output in results:
        by_symbol[symbol][agent_type] = output
    return by_symbol


def compute_available_risk_budget(strategy_params: StrategyParams, portfolio_state: dict[str, Any]) -> float:
    """The risk budget Synthesis is given, computed *after* Position Review's
    trailing-stop/close/trim actions have already updated portfolio_state for
    the run (v2-14 calls review_positions before synthesize for this reason).

    equity * max_portfolio_heat_pct, minus the dollar_risk already committed to
    open positions. Never negative.
    """
    equity = portfolio_state.get("equity") or 0.0
    open_positions: list[dict[str, Any]] = portfolio_state.get("open_positions") or []
    committed_risk = sum(float(p.get("dollar_risk") or 0.0) for p in open_positions)
    budget = equity * strategy_params.max_portfolio_heat_pct - committed_risk
    return max(budget, 0.0)


def load_portfolio_state_for_risk(db: Any) -> dict[str, Any]:
    """Fresh portfolio_state (equity + open positions' dollar_risk/dollar_value)
    for compute_available_risk_budget(), read directly from the DB. Since
    review_positions.py (v2-12) persists its trailing-stop/tighten_stop updates
    to portfolio_positions.stop_price before this is called, a fresh query here
    naturally reflects the post-review state without needing any cross-process
    handoff between the two daily_pipeline.yml jobs."""
    positions = db.table("portfolio_positions").select("symbol,quantity,avg_entry_price,stop_price").execute().data
    open_positions = []
    for p in positions:
        stop = p.get("stop_price")
        dollar_risk = max((p["avg_entry_price"] - stop) * p["quantity"], 0.0) if stop is not None else None
        open_positions.append(
            {"symbol": p["symbol"], "dollar_risk": dollar_risk, "dollar_value": p["avg_entry_price"] * p["quantity"]}
        )

    snapshot_rows = db.table("portfolio_snapshots").select("equity").order("snapshot_date", desc=True).limit(1).execute().data
    equity = snapshot_rows[0]["equity"] if snapshot_rows else 0.0

    return {"equity": equity, "open_positions": open_positions}


def get_db(db: Any = None) -> Any:
    return db or get_client()
