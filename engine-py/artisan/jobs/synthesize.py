from __future__ import annotations

import asyncio
import functools
import logging
from typing import Any

from artisan.actionable_shortlist import select_actionable_shortlist_rows
from artisan.agents import fundamental_analyst, sentiment_analyst, synthesis, technical_analyst
from artisan.agents.orchestrator import (
    compute_available_risk_budget,
    load_portfolio_state_for_risk,
    run_analysts_for_shortlist,
)
from artisan.config import settings
from artisan.jobs.common import pipeline_job
from artisan.strategy_params import StrategyParams, get_strategy_params

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def _load_actionable_shortlist_symbols(db: Any, run_id: str, strategy_id: str, shortlist_size: int) -> list[str]:
    factor_rows = (
        db.table("factor_scores")
        .select("symbol,rank,composite_z,hard_filter_pass")
        .eq("run_id", run_id)
        .eq("strategy_id", strategy_id)
        .execute()
        .data
    )
    entry_signal_rows = (
        db.table("entry_signals")
        .select("symbol,actionable")
        .eq("run_id", run_id)
        .eq("strategy_id", strategy_id)
        .execute()
        .data
    )
    shortlisted = select_actionable_shortlist_rows(
        factor_rows=factor_rows,
        entry_signal_rows=entry_signal_rows,
        shortlist_size=shortlist_size,
    )
    return [row["symbol"] for row in shortlisted]


async def run_synthesize(*, db: Any, run_id: str, strategy_id: str, strategy_params: StrategyParams) -> dict[str, Any]:
    symbols = _load_actionable_shortlist_symbols(db, run_id, strategy_id, strategy_params.shortlist_size)
    if not symbols:
        logger.warning("synthesize: empty actionable shortlist for run_id=%s; skipping analysts and synthesis", run_id)
        return {"symbols": 0, "recommendations": []}

    analyst_fns = {
        "fundamental": functools.partial(fundamental_analyst.analyze, run_id=run_id, strategy_id=strategy_id, db=db),
        "technical": functools.partial(technical_analyst.analyze, run_id=run_id, strategy_id=strategy_id, db=db),
        "sentiment": functools.partial(sentiment_analyst.analyze, run_id=run_id, db=db),
    }
    await run_analysts_for_shortlist(symbols, analyst_fns)

    portfolio_state = load_portfolio_state_for_risk(db)
    available_risk_budget = compute_available_risk_budget(strategy_params, portfolio_state)

    result = await synthesis.synthesize(
        run_id=run_id, strategy_id=strategy_id, strategy_params=strategy_params,
        available_risk_budget=available_risk_budget, db=db,
    )
    return {"symbols": len(symbols), "available_risk_budget": available_risk_budget, **result}


def main() -> None:
    with pipeline_job("synthesize") as (db, run_id):
        strategy_id = settings.strategy_id
        strategy_params = get_strategy_params(strategy_id, db=db)
        result = asyncio.run(run_synthesize(db=db, run_id=run_id, strategy_id=strategy_id, strategy_params=strategy_params))
        logger.info("synthesize: %s", result)


if __name__ == "__main__":
    main()
