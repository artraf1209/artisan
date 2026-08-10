from __future__ import annotations

import asyncio
import logging
from typing import Any

from artisan.agents.base import (
    GET_FUNDAMENTALS_DETAIL_TOOL,
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_FUNDAMENTAL_ANALYSIS_TOOL,
    compute_cost_usd,
    get_anthropic_client,
    load_prompt,
    model_for_agent,
    prompt_version,
    run_agent,
    validate_required_fields,
)
from artisan.agents.orchestrator import write_agent_analysis
from artisan.db.client import get_client

logger = logging.getLogger(__name__)

AGENT_NAME = "fundamental_analyst"
AGENT_TYPE = "fundamental"
REQUIRED_FIELDS = (
    "symbol", "summary", "key_drivers", "quality_assessment",
    "red_flags", "trend_vs_prior_run", "historical_precedent",
)

_FACTOR_SCORE_COLUMNS = (
    "value_z,quality_z,momentum_z,low_vol_z,growth_z,composite_z,rank,hard_filter_pass,"
    "value_prev,quality_prev,momentum_prev,low_vol_prev,growth_prev"
)
_FUNDAMENTALS_COLUMNS = (
    "period_end,period_type,pe_ratio,pb_ratio,roe,debt_equity,revenue,net_income,eps,"
    "fcf,operating_cash_flow,gross_profit,total_assets,total_debt,book_equity,cash,ebitda,market_cap"
)


def _load_context(db: Any, symbol: str, strategy_id: str) -> dict[str, Any]:
    factor_rows = (
        db.table("factor_scores")
        .select(_FACTOR_SCORE_COLUMNS)
        .eq("symbol", symbol)
        .eq("strategy_id", strategy_id)
        .order("scored_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    fundamentals_history = (
        db.table("fundamentals")
        .select(_FUNDAMENTALS_COLUMNS)
        .eq("symbol", symbol)
        .order("period_end", desc=True)
        .limit(5)
        .execute()
        .data
    )
    asset_rows = db.table("assets").select("sector,industry,exchange").eq("symbol", symbol).limit(1).execute().data

    return {
        "factor_score": factor_rows[0] if factor_rows else {},
        "fundamentals_history": fundamentals_history,
        "asset": asset_rows[0] if asset_rows else {},
    }


def _build_user_content(symbol: str, context: dict[str, Any]) -> str:
    factor_score = context["factor_score"]
    asset = context["asset"]
    lines = [
        f"Symbol: {symbol}",
        f"Sector: {asset.get('sector')}  Industry: {asset.get('industry')}  Exchange: {asset.get('exchange')}",
        "",
        "Factor scores (current run):",
        f"  value_z={factor_score.get('value_z')} quality_z={factor_score.get('quality_z')} "
        f"momentum_z={factor_score.get('momentum_z')} low_vol_z={factor_score.get('low_vol_z')} "
        f"growth_z={factor_score.get('growth_z')} composite_z={factor_score.get('composite_z')} "
        f"rank={factor_score.get('rank')} hard_filter_pass={factor_score.get('hard_filter_pass')}",
        "Previous run values (*_prev, for trend_vs_prior_run):",
        f"  value_prev={factor_score.get('value_prev')} quality_prev={factor_score.get('quality_prev')} "
        f"momentum_prev={factor_score.get('momentum_prev')} low_vol_prev={factor_score.get('low_vol_prev')} "
        f"growth_prev={factor_score.get('growth_prev')}",
        "",
        "Recent annual fundamentals history (most recent first):",
    ]
    for row in context["fundamentals_history"]:
        lines.append(f"  {row}")
    if not context["fundamentals_history"]:
        lines.append("  (none available)")
    return "\n".join(lines)


async def analyze(
    symbol: str,
    *,
    run_id: str,
    strategy_id: str,
    db: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    """Runs the Fundamental Analyst for one symbol and persists the result to
    agent_analyses. Wraps the sync run_agent() call in asyncio.to_thread so
    multiple symbols' analyst calls can run concurrently under asyncio.gather
    (see orchestrator.run_analysts_for_shortlist)."""
    db = db or get_client()
    client = client or get_anthropic_client()

    context = _load_context(db, symbol, strategy_id)
    system_prompt = load_prompt(AGENT_NAME, db=db)
    user_content = _build_user_content(symbol, context)
    model = model_for_agent(AGENT_NAME, db=db)

    result = await asyncio.to_thread(
        run_agent,
        client,
        model,
        system_prompt,
        user_content,
        [QUERY_DECISION_HISTORY_TOOL, GET_FUNDAMENTALS_DETAIL_TOOL, SUBMIT_FUNDAMENTAL_ANALYSIS_TOOL],
        "submit_fundamental_analysis",
    )

    output = result["output"]
    validate_required_fields(output, REQUIRED_FIELDS, AGENT_NAME)

    cost_usd = compute_cost_usd(model, result["prompt_tokens"], result["output_tokens"], result["cache_read_tokens"])
    write_agent_analysis(
        db,
        run_id=run_id,
        symbol=symbol,
        agent_type=AGENT_TYPE,
        output=output,
        prompt_version=prompt_version(AGENT_NAME, db=db),
        model=model,
        prompt_tokens=result["prompt_tokens"],
        output_tokens=result["output_tokens"],
        cache_read_tokens=result["cache_read_tokens"],
        cost_usd=cost_usd,
    )

    logger.info("fundamental_analyst: %s -> quality=%s", symbol, output.get("quality_assessment"))
    return output
