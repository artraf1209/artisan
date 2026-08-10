from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from artisan.agents.base import (
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_POSITION_REVIEWS_TOOL,
    compute_cost_usd,
    get_anthropic_client,
    load_prompt,
    model_for_agent,
    prompt_version,
    run_agent,
    validate_required_fields,
)
from artisan.agents.orchestrator import compute_available_risk_budget, write_agent_analysis
from artisan.db.client import get_client
from artisan.risk.sizing import check_portfolio_vetos
from artisan.risk.trailing_stop import apply_trailing_stop_ratchet
from artisan.strategy_params import StrategyParams

logger = logging.getLogger(__name__)

AGENT_NAME = "position_review"
AGENT_TYPE = "position_review"
REQUIRED_FIELDS = (
    "position_id", "symbol", "recommended_action", "reasoning",
    "suggested_new_stop", "suggested_new_target", "historical_precedent",
)
VALID_ACTIONS = ("hold", "trim", "add", "close", "tighten_stop", "widen_target")

# Auto-applied without going through /queue (spec §10.2): CLOSE/TRIM/TIGHTEN_STOP
# are risk-reducing; WIDEN_TARGET only moves the profit-taking point further away
# and doesn't touch risk. Only ADD (and any stop-loosening, guarded separately)
# requires human approval.
AUTO_APPLIED_ACTIONS = ("hold", "close", "trim", "tighten_stop", "widen_target")


def _latest_price(db: Any, symbol: str) -> float | None:
    rows = db.table("price_bars").select("close").eq("symbol", symbol).order("bar_time", desc=True).limit(1).execute().data
    return float(rows[0]["close"]) if rows else None


def _latest_indicators(db: Any, symbol: str) -> dict[str, Any]:
    rows = (
        db.table("indicator_values")
        .select("rsi_14,macd_hist,adx_14,atr_14,sma_50,sma_200")
        .eq("symbol", symbol)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else {}


def _load_recommendation(db: Any, recommendation_id: str | None) -> dict[str, Any] | None:
    if not recommendation_id:
        return None
    rows = (
        db.table("recommendations")
        .select("id,thesis,entry_price,stop_price,target_price,effective_horizon_days,setup_type,created_at")
        .eq("id", recommendation_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _load_fundamentals_freshness(db: Any, symbol: str, opened_at: str | None) -> dict[str, Any]:
    rows = db.table("fundamentals").select("fetched_at,earnings_date").eq("symbol", symbol).order("fetched_at", desc=True).limit(1).execute().data
    if not rows:
        return {"refreshed_since_entry": False, "earnings_date": None}
    latest = rows[0]
    refreshed_since_entry = bool(opened_at and latest.get("fetched_at") and latest["fetched_at"] > opened_at)
    return {"refreshed_since_entry": refreshed_since_entry, "earnings_date": latest.get("earnings_date")}


def load_positions_with_ratchet(db: Any, strategy_params: StrategyParams, now: datetime) -> list[dict[str, Any]]:
    """Pre-step (code, not LLM): ratchets every open position's stop via
    apply_trailing_stop_ratchet() BEFORE the agent is called, so it always
    evaluates the current, already-tightened stop rather than a stale one."""
    positions = (
        db.table("portfolio_positions")
        .select("id,account_id,symbol,quantity,avg_entry_price,stop_price,target_price,signal_id,opened_at")
        .execute()
        .data
    )

    for position in positions:
        price = _latest_price(db, position["symbol"])
        position["current_price"] = price
        indicators = _latest_indicators(db, position["symbol"])
        position["_indicators"] = indicators
        recommendation = _load_recommendation(db, position.get("signal_id"))
        position["_recommendation"] = recommendation
        position["_fundamentals_freshness"] = _load_fundamentals_freshness(db, position["symbol"], position.get("opened_at"))
        position["_stop_ratcheted"] = False

        if price is None:
            continue

        r_dollars = None
        if recommendation and recommendation.get("entry_price") is not None and recommendation.get("stop_price") is not None:
            r_dollars = recommendation["entry_price"] - recommendation["stop_price"]

        ratchet_result = apply_trailing_stop_ratchet(
            {
                "entry_price": position["avg_entry_price"],
                "current_stop_price": position["stop_price"],
                "r_dollars": r_dollars,
                "atr_14": indicators.get("atr_14"),
            },
            price,
            strategy_params,
        )
        if ratchet_result is not None:
            db.table("portfolio_positions").update({"stop_price": ratchet_result["new_stop_price"]}).eq("id", position["id"]).execute()
            position["stop_price"] = ratchet_result["new_stop_price"]
            position["_stop_ratcheted"] = True

    return positions


def _load_shared_context(db: Any, run_id: str) -> dict[str, Any]:
    regime_rows = db.table("regime_snapshots").select("regime").eq("run_id", run_id).limit(1).execute().data
    snapshot_rows = (
        db.table("portfolio_snapshots")
        .select("equity,drawdown_from_high_pct")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    snapshot = snapshot_rows[0] if snapshot_rows else {}
    return {
        "regime": regime_rows[0]["regime"] if regime_rows else None,
        "equity": snapshot.get("equity") or 0.0,
        "drawdown_from_high_pct": snapshot.get("drawdown_from_high_pct"),
    }


def _days_held(opened_at: str | None, now: datetime) -> int | None:
    if not opened_at:
        return None
    opened = datetime.fromisoformat(opened_at.replace("Z", "+00:00"))
    return (now.date() - opened.date()).days


def _r_multiple(current_price: float | None, recommendation: dict[str, Any] | None) -> float | None:
    if not current_price or not recommendation:
        return None
    entry = recommendation.get("entry_price")
    stop = recommendation.get("stop_price")
    if entry is None or stop is None or entry == stop:
        return None
    return round((current_price - entry) / (entry - stop), 4)


def _format_position(position: dict[str, Any], strategy_params: StrategyParams, now: datetime) -> str:
    recommendation = position.get("_recommendation") or {}
    entry_price = position["avg_entry_price"]
    current_price = position.get("current_price")
    quantity = position["quantity"]
    unrealized_pnl = (current_price - entry_price) * quantity if current_price is not None else None
    days_held = _days_held(position.get("opened_at"), now)
    horizon = recommendation.get("effective_horizon_days")
    days_remaining_horizon = (horizon - days_held) if (horizon is not None and days_held is not None) else None
    days_remaining_ceiling = (
        strategy_params.max_holding_period_days - days_held if days_held is not None else None
    )
    freshness = position.get("_fundamentals_freshness", {})

    return "\n".join(
        [
            f"- position_id={position['id']} symbol={position['symbol']} quantity={quantity}",
            f"  entry_price={entry_price} current_price={current_price} "
            f"stop_price={position['stop_price']}{' (already ratcheted this run)' if position.get('_stop_ratcheted') else ''} "
            f"target_price={position['target_price']}",
            f"  unrealized_pnl=${unrealized_pnl} r_multiple={_r_multiple(current_price, recommendation)}",
            f"  days_held={days_held} effective_horizon_days={horizon} "
            f"days_remaining_vs_horizon={days_remaining_horizon} days_remaining_vs_30day_ceiling={days_remaining_ceiling}",
            f"  original thesis: {recommendation.get('thesis')}",
            f"  original setup_type: {recommendation.get('setup_type')}",
            f"  indicators: {position.get('_indicators')}",
            f"  fundamentals refreshed since entry: {freshness.get('refreshed_since_entry')}, "
            f"earnings_date: {freshness.get('earnings_date')}",
        ]
    )


def build_user_content(positions: list[dict[str, Any]], shared_context: dict[str, Any], strategy_params: StrategyParams, now: datetime) -> str:
    lines = [
        f"Current market regime: {shared_context['regime']}",
        f"Current drawdown: {shared_context['drawdown_from_high_pct']} vs tolerance {strategy_params.max_drawdown_tolerance_pct}",
        f"Portfolio equity: {shared_context['equity']}",
        "",
        "=== OPEN POSITIONS ===",
    ]
    if positions:
        for p in positions:
            lines.append(_format_position(p, strategy_params, now))
    else:
        lines.append("(no open positions)")
    return "\n".join(lines)


def _apply_day30_override(review: dict[str, Any], position: dict[str, Any], strategy_params: StrategyParams, now: datetime) -> dict[str, Any]:
    days_held = _days_held(position.get("opened_at"), now)
    if days_held is None or days_held < strategy_params.max_holding_period_days:
        return review
    if review.get("recommended_action") not in ("close", "trim"):
        logger.warning(
            "Position %s at/past the %d-day ceiling (days_held=%d); overriding %s -> close",
            position["symbol"], strategy_params.max_holding_period_days, days_held, review.get("recommended_action"),
        )
        review = dict(review)
        review["recommended_action"] = "close"
    return review


def _create_sell_trade_intent(db: Any, position: dict[str, Any]) -> dict[str, Any]:
    """CLOSE/TRIM are risk-reducing and auto-approved (spec §10.2) -- creates the
    trade_intent directly rather than routing through /queue. Actual broker
    execution (and updating portfolio_positions/decision_outcomes on fill) is
    execute-trade's job (v2-15), which is extended to pick up engine-created
    sell intents alongside user-approved ones."""
    recommendation = position.get("_recommendation") or {}
    row = {
        "signal_id": recommendation.get("id"),
        "account_id": position["account_id"],
        "symbol": position["symbol"],
        "side": "sell",
        "quantity": position["quantity"],
        "dollar_value": (position.get("current_price") or position["avg_entry_price"]) * position["quantity"],
        "order_type": "market",
        "status": "pending",
    }
    return db.table("trade_intents").insert(row).execute().data[0]


def _post_process_review(
    db: Any,
    review: dict[str, Any],
    position: dict[str, Any],
    strategy_params: StrategyParams,
    portfolio_state: dict[str, Any],
) -> dict[str, Any]:
    """Post-processing (code, not LLM). Returns the review dict (possibly with
    recommended_action overridden) that gets persisted to position_reviews."""
    action = review.get("recommended_action")
    review_note: str | None = None

    if action == "add":
        candidate = {
            "symbol": position["symbol"],
            "sector": position.get("sector"),
            "dollar_risk": None,
            "dollar_value": position["avg_entry_price"] * position["quantity"],
        }
        vetoes = check_portfolio_vetos(candidate, portfolio_state, strategy_params)
        if vetoes:
            logger.warning("ADD on %s vetoed (%s); downgrading to hold", position["symbol"], vetoes)
            review = {**review, "recommended_action": "hold"}
            review_note = f"add downgraded to hold: vetoes triggered ({', '.join(vetoes)})"
            action = "hold"
        else:
            review_note = "proposed ADD -- awaiting human approval via /queue"

    elif action == "tighten_stop":
        new_stop = review.get("suggested_new_stop")
        if new_stop is not None and new_stop > position["stop_price"]:
            db.table("portfolio_positions").update({"stop_price": new_stop}).eq("id", position["id"]).execute()
            position["stop_price"] = new_stop
            review_note = f"stop tightened to {new_stop}"
        else:
            logger.warning(
                "tighten_stop on %s had no valid (tighter) suggested_new_stop (%s vs current %s); no-op",
                position["symbol"], new_stop, position["stop_price"],
            )
            review_note = "tighten_stop requested but no valid tighter stop provided; no change applied"

    elif action == "widen_target":
        new_target = review.get("suggested_new_target")
        if new_target is not None and position.get("target_price") is not None and new_target > position["target_price"]:
            db.table("portfolio_positions").update({"target_price": new_target}).eq("id", position["id"]).execute()
            position["target_price"] = new_target
            review_note = f"target widened to {new_target}"
        else:
            review_note = "widen_target requested but no valid wider target provided; no change applied"

    elif action in ("close", "trim"):
        if action == "close":
            intent = _create_sell_trade_intent(db, position)
            review_note = f"close auto-approved; trade_intent {intent['id']} created for execution"
        else:
            review_note = "trim auto-approved (risk-reducing); share count not specified by the agent, no trade_intent created"

    status = "pending" if action == "add" else "executed"

    return {
        "position_id": position["id"],
        "symbol": position["symbol"],
        "recommended_action": action,
        "reasoning": review.get("reasoning"),
        "historical_precedent": review.get("historical_precedent"),
        "new_stop_price": review.get("suggested_new_stop") if action == "tighten_stop" else None,
        "new_target_price": review.get("suggested_new_target") if action == "widen_target" else None,
        "trim_shares": None,
        "status": status,
        "reviewed_at": datetime.now(UTC).isoformat(),
        "review_note": review_note,
    }


def _committed_risk_after_review(positions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    open_positions = []
    for p in positions:
        stop = p.get("stop_price")
        dollar_risk = max((p["avg_entry_price"] - stop) * p["quantity"], 0.0) if stop is not None else None
        open_positions.append({"symbol": p["symbol"], "sector": p.get("sector"), "dollar_risk": dollar_risk, "dollar_value": p["avg_entry_price"] * p["quantity"]})
    return open_positions


async def review_positions(
    *,
    run_id: str,
    strategy_params: StrategyParams,
    db: Any = None,
    client: Any = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Runs Position Review for every open position in one batch call, applies
    the trailing-stop pre-step, enforces the day-30 override and ADD-veto/
    stop-loosening gating in post-processing, and returns available_risk_budget
    for Synthesis (v2-11) to consume."""
    db = db or get_client()
    client = client or get_anthropic_client()
    now = now or datetime.now(UTC)

    positions = load_positions_with_ratchet(db, strategy_params, now)

    if not positions:
        logger.info("review_positions: no open positions, nothing to review")
        available_risk_budget = compute_available_risk_budget(strategy_params, {"equity": (_load_shared_context(db, run_id))["equity"], "open_positions": []})
        return {"reviews": [], "available_risk_budget": available_risk_budget}

    shared_context = _load_shared_context(db, run_id)
    system_prompt = load_prompt(AGENT_NAME, db=db)
    user_content = build_user_content(positions, shared_context, strategy_params, now)
    model = model_for_agent(AGENT_NAME, db=db)
    max_iterations = max(5, len(positions) + 3)

    result = await asyncio.to_thread(
        run_agent,
        client,
        model,
        system_prompt,
        user_content,
        [QUERY_DECISION_HISTORY_TOOL, SUBMIT_POSITION_REVIEWS_TOOL],
        "submit_position_reviews",
        max_tool_iterations=max_iterations,
    )

    output = result["output"]
    raw_reviews = output.get("position_reviews", [])
    for review in raw_reviews:
        validate_required_fields(review, REQUIRED_FIELDS, AGENT_NAME)

    positions_by_id = {p["id"]: p for p in positions}
    queried_symbols = {
        call["input"].get("symbol")
        for call in result["tool_calls"]
        if call.get("name") == "query_decision_history" and call.get("input", {}).get("symbol")
    }
    missing_history_lookups = [p["symbol"] for p in positions if p["symbol"] not in queried_symbols]
    if missing_history_lookups:
        logger.warning("Position Review did not call query_decision_history for: %s", missing_history_lookups)

    portfolio_state = {"equity": shared_context["equity"], "drawdown_from_high_pct": shared_context["drawdown_from_high_pct"], "open_positions": _committed_risk_after_review(positions)}

    written_rows = []
    for review in raw_reviews:
        position = positions_by_id.get(review.get("position_id"))
        if position is None:
            logger.warning("Position Review referenced unknown position_id=%s; skipping", review.get("position_id"))
            continue
        review = _apply_day30_override(review, position, strategy_params, now)
        row = _post_process_review(db, review, position, strategy_params, portfolio_state)
        inserted = db.table("position_reviews").insert({**row, "run_id": run_id}).execute().data[0]
        written_rows.append(inserted)

    available_risk_budget = compute_available_risk_budget(
        strategy_params, {"equity": shared_context["equity"], "open_positions": _committed_risk_after_review(positions)}
    )

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

    logger.info(
        "review_positions: %d reviews written, available_risk_budget=%.2f, %d decision_history compliance gaps",
        len(written_rows), available_risk_budget, len(missing_history_lookups),
    )

    return {
        "reviews": written_rows,
        "available_risk_budget": available_risk_budget,
        "missing_decision_history_lookups": missing_history_lookups,
    }
