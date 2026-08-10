from __future__ import annotations

import asyncio
import logging
from typing import Any

from artisan.agents.base import (
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_RECOMMENDATIONS_TOOL,
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
from artisan.risk.sizing import check_portfolio_vetos, compute_position_size
from artisan.scoring.regime import enter_eligible_rank_cutoff
from artisan.strategy_params import StrategyParams

logger = logging.getLogger(__name__)

AGENT_NAME = "synthesis"
AGENT_TYPE = "synthesis"
REQUIRED_FIELDS = (
    "symbol", "action", "conviction", "thesis",
    "invalidation_conditions", "redundancy_note", "historical_precedent",
)
VALID_ACTIONS = ("enter", "watch", "skip")
CONVICTION_RANK = {"high": 0, "medium": 1, "low": 2}

_FACTOR_SCORE_COLUMNS = "symbol,sector,composite_z,rank,hard_filter_pass"
_ENTRY_SIGNAL_COLUMNS = "symbol,setup_type,actionable,entry_price,stop_price,target_price,atr,effective_horizon_days"


def _load_regime(db: Any, run_id: str) -> str:
    rows = db.table("regime_snapshots").select("regime").eq("run_id", run_id).limit(1).execute().data
    return rows[0]["regime"] if rows else "neutral"


def _load_open_positions_for_portfolio_state(db: Any) -> list[dict[str, Any]]:
    rows = (
        db.table("portfolio_positions")
        .select("symbol,quantity,avg_entry_price,stop_price,target_price")
        .execute()
        .data
    )
    symbols = [r["symbol"] for r in rows]
    sector_by_symbol: dict[str, str] = {}
    if symbols:
        asset_rows = db.table("assets").select("symbol,sector").in_("symbol", symbols).execute().data
        sector_by_symbol = {a["symbol"]: a.get("sector") for a in asset_rows}

    positions = []
    for row in rows:
        quantity = row.get("quantity") or 0
        avg_entry = row.get("avg_entry_price") or 0.0
        stop = row.get("stop_price")
        dollar_risk = max((avg_entry - stop) * quantity, 0.0) if stop is not None else None
        positions.append(
            {
                "symbol": row["symbol"],
                "sector": sector_by_symbol.get(row["symbol"]),
                "dollar_risk": dollar_risk,
                "dollar_value": avg_entry * quantity,
            }
        )
    return positions


def _load_portfolio_snapshot(db: Any) -> dict[str, Any]:
    rows = (
        db.table("portfolio_snapshots")
        .select("equity,drawdown_from_high_pct,trailing_return_pct")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else {}


def _load_analyst_outputs(db: Any, run_id: str) -> dict[str, dict[str, Any]]:
    rows = (
        db.table("agent_analyses")
        .select("symbol,agent_type,output")
        .eq("run_id", run_id)
        .in_("agent_type", ["fundamental", "technical", "sentiment"])
        .execute()
        .data
    )
    by_symbol: dict[str, dict[str, Any]] = {}
    for row in rows:
        by_symbol.setdefault(row["symbol"], {})[row["agent_type"]] = row["output"]
    return by_symbol


def assemble_context(
    db: Any,
    *,
    run_id: str,
    strategy_id: str,
    strategy_params: StrategyParams,
    available_risk_budget: float,
) -> dict[str, Any]:
    regime = _load_regime(db, run_id)

    factor_rows = (
        db.table("factor_scores")
        .select(_FACTOR_SCORE_COLUMNS)
        .eq("strategy_id", strategy_id)
        .eq("run_id", run_id)
        .execute()
        .data
    )
    shortlisted = [r for r in factor_rows if r.get("hard_filter_pass") and r.get("rank") is not None]

    entry_signal_rows = (
        db.table("entry_signals")
        .select(_ENTRY_SIGNAL_COLUMNS)
        .eq("strategy_id", strategy_id)
        .eq("run_id", run_id)
        .execute()
        .data
    )
    entry_signals_by_symbol = {r["symbol"]: r for r in entry_signal_rows}

    analyst_by_symbol = _load_analyst_outputs(db, run_id)
    open_positions = _load_open_positions_for_portfolio_state(db)
    portfolio_snapshot = _load_portfolio_snapshot(db)
    portfolio_state = {
        "equity": portfolio_snapshot.get("equity") or 0.0,
        "drawdown_from_high_pct": portfolio_snapshot.get("drawdown_from_high_pct"),
        "open_positions": open_positions,
    }

    cutoff = enter_eligible_rank_cutoff(regime, len(shortlisted))

    enter_eligible: list[dict[str, Any]] = []
    watch_eligible: list[dict[str, Any]] = []

    for row in shortlisted:
        symbol = row["symbol"]
        entry_signal = entry_signals_by_symbol.get(symbol, {})
        candidate: dict[str, Any] = {
            "symbol": symbol,
            "sector": row.get("sector"),
            "composite_z": row.get("composite_z"),
            "rank": row.get("rank"),
            "entry_signal": entry_signal,
            "analyst_outputs": analyst_by_symbol.get(symbol, {}),
            "vetoes": [],
        }

        actionable = bool(entry_signal.get("actionable"))
        within_rank = row.get("rank") is not None and row["rank"] <= cutoff

        if actionable and within_rank:
            entry_price = entry_signal.get("entry_price")
            stop_price = entry_signal.get("stop_price")
            if entry_price and stop_price:
                sizing = compute_position_size(portfolio_state["equity"], entry_price, stop_price, strategy_params)
            else:
                sizing = {"shares": 0, "dollar_risk": 0.0}
            candidate["sizing"] = sizing

            veto_candidate = {
                "symbol": symbol,
                "sector": row.get("sector"),
                "dollar_risk": sizing["dollar_risk"],
                "dollar_value": (entry_price or 0.0) * sizing["shares"],
            }
            candidate["vetoes"] = check_portfolio_vetos(veto_candidate, portfolio_state, strategy_params)

        if actionable and within_rank and not candidate["vetoes"]:
            enter_eligible.append(candidate)
        else:
            watch_eligible.append(candidate)

    return {
        "regime": regime,
        "enter_eligible": enter_eligible,
        "watch_eligible": watch_eligible,
        "portfolio_state": portfolio_state,
        "portfolio_snapshot": portfolio_snapshot,
        "available_risk_budget": available_risk_budget,
        "candidates_by_symbol": {c["symbol"]: c for c in enter_eligible + watch_eligible},
    }


def _format_candidate(candidate: dict[str, Any]) -> str:
    entry_signal = candidate["entry_signal"]
    analyst = candidate["analyst_outputs"]
    lines = [
        f"- {candidate['symbol']} (sector={candidate['sector']}, rank={candidate['rank']}, "
        f"composite_z={candidate['composite_z']})",
        f"  setup_type={entry_signal.get('setup_type')} entry={entry_signal.get('entry_price')} "
        f"stop={entry_signal.get('stop_price')} target={entry_signal.get('target_price')} "
        f"effective_horizon_days={entry_signal.get('effective_horizon_days')}",
    ]
    if candidate.get("sizing"):
        lines.append(f"  code-computed sizing: shares={candidate['sizing']['shares']} dollar_risk={candidate['sizing']['dollar_risk']}")
    if candidate.get("vetoes"):
        lines.append(f"  vetoes triggered (why this is WATCH not ENTER): {candidate['vetoes']}")
    fundamental = analyst.get("fundamental")
    if fundamental:
        lines.append(
            f"  [Fundamental] {fundamental.get('summary')} "
            f"(quality={fundamental.get('quality_assessment')}, red_flags={fundamental.get('red_flags')})"
        )
    technical = analyst.get("technical")
    if technical:
        lines.append(f"  [Technical] {technical.get('summary')} (setup_quality={technical.get('setup_quality')})")
    sentiment = analyst.get("sentiment")
    if sentiment:
        lines.append(
            f"  [Sentiment] {sentiment.get('summary')} "
            f"(direction={sentiment.get('sentiment_direction')}, red_flags={sentiment.get('red_flags')})"
        )
    return "\n".join(lines)


def build_user_content(context: dict[str, Any], strategy_params: StrategyParams) -> str:
    ps = context["portfolio_snapshot"]
    lines = [
        f"Market regime: {context['regime']}",
        f"Available risk budget (post Position Review): ${context['available_risk_budget']:.2f}",
        f"Trailing return: {ps.get('trailing_return_pct')} vs target {strategy_params.target_annual_return_pct}",
        f"Current drawdown: {ps.get('drawdown_from_high_pct')} vs tolerance {strategy_params.max_drawdown_tolerance_pct}",
        f"daily_recommendation_cap: {strategy_params.daily_recommendation_cap}",
        "",
        "Current open positions:",
    ]
    if context["portfolio_state"]["open_positions"]:
        for p in context["portfolio_state"]["open_positions"]:
            lines.append(f"  {p['symbol']} ({p['sector']}): dollar_risk={p['dollar_risk']} dollar_value={p['dollar_value']}")
    else:
        lines.append("  (none)")

    lines.append("")
    lines.append("=== ENTER-ELIGIBLE CANDIDATES ===")
    if context["enter_eligible"]:
        for c in context["enter_eligible"]:
            lines.append(_format_candidate(c))
    else:
        lines.append("(none this run)")

    lines.append("")
    lines.append("=== WATCH-ELIGIBLE CANDIDATES ===")
    if context["watch_eligible"]:
        for c in context["watch_eligible"]:
            lines.append(_format_candidate(c))
    else:
        lines.append("(none this run)")

    return "\n".join(lines)


def _enforce_hard_caps(
    recommendations: list[dict[str, Any]],
    *,
    enter_eligible_symbols: set[str],
    available_risk_budget: float,
    daily_recommendation_cap: int,
) -> list[dict[str, Any]]:
    """Hard caps enforced in code, never left to the LLM to self-police."""
    adjusted: list[dict[str, Any]] = []
    for rec in recommendations:
        rec = dict(rec)
        if rec.get("action") == "enter":
            symbol = rec.get("symbol")
            if symbol not in enter_eligible_symbols:
                logger.warning("Synthesis attempted enter on non-eligible symbol %s; downgrading to watch", symbol)
                rec["action"] = "watch"
            elif available_risk_budget <= 0:
                logger.warning("available_risk_budget <= 0; downgrading enter on %s to watch", symbol)
                rec["action"] = "watch"
        adjusted.append(rec)

    enter_rows = [r for r in adjusted if r.get("action") == "enter"]
    if len(enter_rows) > daily_recommendation_cap:
        ranked = sorted(enter_rows, key=lambda r: CONVICTION_RANK.get(r.get("conviction"), 3))
        keep_symbols = {r["symbol"] for r in ranked[:daily_recommendation_cap]}
        for rec in adjusted:
            if rec.get("action") == "enter" and rec.get("symbol") not in keep_symbols:
                logger.warning(
                    "Truncating enter on %s: exceeds daily_recommendation_cap=%d",
                    rec.get("symbol"), daily_recommendation_cap,
                )
                rec["action"] = "watch"

    return adjusted


def _check_decision_history_compliance(tool_calls: list[dict[str, Any]], enter_eligible: list[dict[str, Any]]) -> list[str]:
    """Spec requirement: query_decision_history must be called at least once per
    ENTER-eligible candidate before Synthesis finalizes. Logged, not fatal — a
    missed lookup is a prompt-adherence quality issue (shallower
    historical_precedent), not a data-integrity or risk problem."""
    queried_symbols = {
        call["input"].get("symbol")
        for call in tool_calls
        if call.get("name") == "query_decision_history" and call.get("input", {}).get("symbol")
    }
    missing = [c["symbol"] for c in enter_eligible if c["symbol"] not in queried_symbols]
    if missing:
        logger.warning(
            "Synthesis did not call query_decision_history for %d ENTER-eligible candidate(s): %s",
            len(missing), missing,
        )
    return missing


def _write_recommendation(
    db: Any, *, run_id: str, strategy_id: str, rec: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    symbol = rec["symbol"]
    candidate = context["candidates_by_symbol"].get(symbol, {})
    entry_signal = candidate.get("entry_signal", {})
    sizing = candidate.get("sizing") if rec["action"] == "enter" else None

    row = {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "run_id": run_id,
        "action": rec["action"],
        "conviction": rec.get("conviction"),
        "thesis": rec.get("thesis"),
        "setup_type": entry_signal.get("setup_type"),
        "regime": context["regime"],
        "effective_horizon_days": entry_signal.get("effective_horizon_days"),
        "historical_precedent": rec.get("historical_precedent"),
        "entry_price": entry_signal.get("entry_price"),
        "stop_price": entry_signal.get("stop_price"),
        "target_price": entry_signal.get("target_price"),
        "atr_at_signal": entry_signal.get("atr"),
        "shares": sizing["shares"] if sizing else None,
        "dollar_risk": sizing["dollar_risk"] if sizing else None,
        "status": "pending",
    }
    inserted = db.table("recommendations").insert(row).execute().data[0]

    if rec["action"] == "enter":
        db.table("decision_outcomes").insert(
            {
                "source_type": "recommendation",
                "source_id": inserted["id"],
                "symbol": symbol,
                "mode": "shadow",
                "entry_price_reference": entry_signal.get("entry_price"),
                "stop_price": entry_signal.get("stop_price"),
                "target_price": entry_signal.get("target_price"),
                "effective_horizon_days": entry_signal.get("effective_horizon_days"),
                "setup_type": entry_signal.get("setup_type"),
                "regime": context["regime"],
                "resolution": "still_open",
            }
        ).execute()

    return inserted


async def synthesize(
    *,
    run_id: str,
    strategy_id: str,
    strategy_params: StrategyParams,
    available_risk_budget: float,
    db: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    """Runs the Synthesis agent for one pipeline run and persists recommendations
    (+ shadow decision_outcomes for every ENTER) to the DB. Hard caps (eligibility,
    risk budget, daily count) are enforced here in code, never left to the model."""
    db = db or get_client()
    client = client or get_anthropic_client()

    context = assemble_context(
        db, run_id=run_id, strategy_id=strategy_id, strategy_params=strategy_params,
        available_risk_budget=available_risk_budget,
    )
    system_prompt = load_prompt(AGENT_NAME, db=db)
    user_content = build_user_content(context, strategy_params)
    model = model_for_agent(AGENT_NAME, db=db)

    # Needs enough iterations for a query_decision_history call per ENTER candidate
    # plus the final forced submission.
    max_iterations = max(5, len(context["enter_eligible"]) + 3)

    result = await asyncio.to_thread(
        run_agent,
        client,
        model,
        system_prompt,
        user_content,
        [QUERY_DECISION_HISTORY_TOOL, SUBMIT_RECOMMENDATIONS_TOOL],
        "submit_recommendations",
        max_tool_iterations=max_iterations,
    )

    output = result["output"]
    raw_recommendations = output.get("recommendations", [])
    for rec in raw_recommendations:
        validate_required_fields(rec, REQUIRED_FIELDS, AGENT_NAME)

    missing_history_lookups = _check_decision_history_compliance(result["tool_calls"], context["enter_eligible"])

    enter_eligible_symbols = {c["symbol"] for c in context["enter_eligible"]}
    adjusted = _enforce_hard_caps(
        raw_recommendations,
        enter_eligible_symbols=enter_eligible_symbols,
        available_risk_budget=available_risk_budget,
        daily_recommendation_cap=strategy_params.daily_recommendation_cap,
    )

    # 'skip' isn't a valid recommendations.action (DB only allows enter|watch) —
    # a skip is simply not persisted, it's not a third queue state.
    persistable = [rec for rec in adjusted if rec.get("action") in ("enter", "watch")]

    written_rows = [
        _write_recommendation(db, run_id=run_id, strategy_id=strategy_id, rec=rec, context=context)
        for rec in persistable
    ]

    cost_usd = compute_cost_usd(model, result["prompt_tokens"], result["output_tokens"], result["cache_read_tokens"])
    write_agent_analysis(
        db,
        run_id=run_id,
        symbol=None,
        agent_type=AGENT_TYPE,
        output=output,
        prompt_version=prompt_version(AGENT_NAME, db=db),
        model=model,
        prompt_tokens=result["prompt_tokens"],
        output_tokens=result["output_tokens"],
        cache_read_tokens=result["cache_read_tokens"],
        cost_usd=cost_usd,
    )

    enter_count = sum(1 for r in written_rows if r["action"] == "enter")
    logger.info(
        "synthesis: %d recommendations written (%d enter, %d watch), %d decision_history compliance gaps",
        len(written_rows), enter_count, len(written_rows) - enter_count, len(missing_history_lookups),
    )

    return {
        "recommendations": written_rows,
        "missing_decision_history_lookups": missing_history_lookups,
    }
