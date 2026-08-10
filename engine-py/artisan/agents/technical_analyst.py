from __future__ import annotations

import asyncio
import logging
from typing import Any

from artisan.agents.base import (
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_TECHNICAL_ANALYSIS_TOOL,
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

AGENT_NAME = "technical_analyst"
AGENT_TYPE = "technical"
REQUIRED_FIELDS = (
    "symbol", "summary", "setup_quality", "confirmation_strength",
    "technical_invalidation_note", "regime_fit", "historical_precedent",
)

_ENTRY_SIGNAL_COLUMNS = (
    "gate_market,gate_trend,setup_type,gate_confirmed,actionable,entry_price,stop_price,"
    "target_price,atr,r_multiple,effective_horizon_days,evaluated_at"
)
_INDICATOR_COLUMNS = (
    "rsi_14,macd_line,macd_signal,macd_hist,bb_upper,bb_mid,bb_lower,atr_14,"
    "sma_50,sma_200,adx_14,obv,vol_ratio,computed_at"
)


def _load_context(db: Any, symbol: str, strategy_id: str, run_id: str) -> dict[str, Any]:
    entry_signal_rows = (
        db.table("entry_signals")
        .select(_ENTRY_SIGNAL_COLUMNS)
        .eq("symbol", symbol)
        .eq("strategy_id", strategy_id)
        .eq("run_id", run_id)
        .order("evaluated_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    indicator_rows = (
        db.table("indicator_values")
        .select(_INDICATOR_COLUMNS)
        .eq("symbol", symbol)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    regime_rows = db.table("regime_snapshots").select("regime").eq("run_id", run_id).limit(1).execute().data

    return {
        "entry_signal": entry_signal_rows[0] if entry_signal_rows else {},
        "indicators": indicator_rows[0] if indicator_rows else {},
        "regime": regime_rows[0]["regime"] if regime_rows else None,
    }


def _build_user_content(symbol: str, context: dict[str, Any]) -> str:
    entry_signal = context["entry_signal"]
    indicators = context["indicators"]
    lines = [
        f"Symbol: {symbol}",
        f"Current market regime: {context['regime']}",
        "",
        "Entry gates / setup (from entry_signals):",
        f"  gate_market={entry_signal.get('gate_market')} gate_trend={entry_signal.get('gate_trend')} "
        f"setup_type={entry_signal.get('setup_type')} gate_confirmed={entry_signal.get('gate_confirmed')} "
        f"actionable={entry_signal.get('actionable')}",
        f"  entry_price={entry_signal.get('entry_price')} stop_price={entry_signal.get('stop_price')} "
        f"target_price={entry_signal.get('target_price')} atr={entry_signal.get('atr')} "
        f"r_multiple={entry_signal.get('r_multiple')} effective_horizon_days={entry_signal.get('effective_horizon_days')}",
        "",
        "Recent indicator values:",
        f"  rsi_14={indicators.get('rsi_14')} macd_hist={indicators.get('macd_hist')} "
        f"adx_14={indicators.get('adx_14')} obv={indicators.get('obv')} vol_ratio={indicators.get('vol_ratio')}",
        f"  bb_upper={indicators.get('bb_upper')} bb_mid={indicators.get('bb_mid')} bb_lower={indicators.get('bb_lower')} "
        f"sma_50={indicators.get('sma_50')} sma_200={indicators.get('sma_200')}",
    ]
    return "\n".join(lines)


async def analyze(
    symbol: str,
    *,
    run_id: str,
    strategy_id: str,
    db: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    """Runs the Technical Analyst for one symbol and persists the result to
    agent_analyses. See fundamental_analyst.analyze for the concurrency pattern."""
    db = db or get_client()
    client = client or get_anthropic_client()

    context = _load_context(db, symbol, strategy_id, run_id)
    system_prompt = load_prompt(AGENT_NAME, db=db)
    user_content = _build_user_content(symbol, context)
    model = model_for_agent(AGENT_NAME, db=db)

    result = await asyncio.to_thread(
        run_agent,
        client,
        model,
        system_prompt,
        user_content,
        [QUERY_DECISION_HISTORY_TOOL, SUBMIT_TECHNICAL_ANALYSIS_TOOL],
        "submit_technical_analysis",
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

    logger.info("technical_analyst: %s -> setup_quality=%s", symbol, output.get("setup_quality"))
    return output
