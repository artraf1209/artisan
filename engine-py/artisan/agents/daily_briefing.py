from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any, Callable

import httpx

from artisan.agents.base import (
    AGENT_MODELS,
    SUBMIT_BRIEFING_TOOL,
    compute_cost_usd,
    get_anthropic_client,
    load_prompt,
    prompt_version,
    run_agent,
    validate_required_fields,
)
from artisan.agents.orchestrator import write_agent_analysis
from artisan.config import settings
from artisan.db.client import get_client
from artisan.strategy_params import StrategyParams

logger = logging.getLogger(__name__)

AGENT_NAME = "daily_briefing"
AGENT_TYPE = "briefing"
REQUIRED_FIELDS = (
    "urgent_flags", "regime_line", "new_recommendations_summary",
    "position_actions_summary", "outcomes_note", "portfolio_state_line", "full_text",
)
DEFAULT_EXPIRED_COUNTS = {"recommendations_expired": 0, "position_reviews_expired": 0}


def _load_regime_context(db: Any, run_id: str) -> dict[str, Any]:
    current_rows = db.table("regime_snapshots").select("regime,date").eq("run_id", run_id).limit(1).execute().data
    current_regime = current_rows[0]["regime"] if current_rows else None

    recent_rows = (
        db.table("regime_snapshots").select("run_id,regime,date").order("date", desc=True).limit(5).execute().data
    )
    prior = next((r for r in recent_rows if r["run_id"] != run_id), None)
    prior_regime = prior["regime"] if prior else None

    return {
        "regime": current_regime,
        "prior_regime": prior_regime,
        "changed": bool(prior_regime and current_regime and prior_regime != current_regime),
    }


def _load_new_recommendations(db: Any, run_id: str) -> list[dict[str, Any]]:
    return (
        db.table("recommendations")
        .select("symbol,action,conviction,thesis")
        .eq("run_id", run_id)
        .eq("action", "enter")
        .execute()
        .data
    )


def _load_position_actions(db: Any, run_id: str) -> list[dict[str, Any]]:
    rows = db.table("position_reviews").select("symbol,recommended_action,reasoning").eq("run_id", run_id).execute().data
    return [r for r in rows if r.get("recommended_action") != "hold"]


def _load_resolved_outcomes_today(db: Any, run_date: str) -> list[dict[str, Any]]:
    rows = (
        db.table("decision_outcomes")
        .select("symbol,mode,resolution,r_multiple")
        .neq("resolution", "still_open")
        .gte("resolved_at", f"{run_date}T00:00:00")
        .execute()
        .data
    )
    return rows


def _load_portfolio_snapshot(db: Any) -> dict[str, Any]:
    rows = (
        db.table("portfolio_snapshots")
        .select("equity,drawdown_from_high_pct,trailing_return_pct,snapshot_date")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else {}


def assemble_context(db: Any, *, run_id: str, run_date: str, expired_counts: dict[str, int]) -> dict[str, Any]:
    return {
        "regime": _load_regime_context(db, run_id),
        "new_recommendations": _load_new_recommendations(db, run_id),
        "position_actions": _load_position_actions(db, run_id),
        "expired_counts": expired_counts,
        "resolved_outcomes": _load_resolved_outcomes_today(db, run_date),
        "portfolio_snapshot": _load_portfolio_snapshot(db),
    }


def build_user_content(context: dict[str, Any], strategy_params: StrategyParams) -> str:
    regime = context["regime"]
    lines = [
        f"Regime: {regime['regime']} (prior: {regime['prior_regime']}, changed_since_last_run: {regime['changed']})",
        "",
        f"New recommendations this run ({len(context['new_recommendations'])}):",
    ]
    for r in context["new_recommendations"]:
        lines.append(f"  - {r['symbol']} conviction={r.get('conviction')}: {r.get('thesis')}")
    if not context["new_recommendations"]:
        lines.append("  (none)")

    lines.append("")
    lines.append(f"Position review actions this run, non-hold only ({len(context['position_actions'])}):")
    for p in context["position_actions"]:
        lines.append(f"  - {p['symbol']} {p['recommended_action']}: {p.get('reasoning')}")
    if not context["position_actions"]:
        lines.append("  (none -- every open position held)")

    lines.append("")
    ec = context["expired_counts"]
    lines.append(
        f"Expired unreviewed from the prior run: {ec.get('recommendations_expired', 0)} recommendations, "
        f"{ec.get('position_reviews_expired', 0)} position reviews"
    )

    lines.append("")
    lines.append(f"Decision outcomes resolved today ({len(context['resolved_outcomes'])}), including shadow-tracked:")
    for o in context["resolved_outcomes"]:
        lines.append(f"  - {o['symbol']} ({o['mode']}): {o['resolution']} r_multiple={o.get('r_multiple')}")
    if not context["resolved_outcomes"]:
        lines.append("  (none)")

    lines.append("")
    ps = context["portfolio_snapshot"]
    lines.append(
        f"Portfolio: equity={ps.get('equity')} drawdown_from_high_pct={ps.get('drawdown_from_high_pct')} "
        f"(tolerance={strategy_params.max_drawdown_tolerance_pct}) "
        f"trailing_return_pct={ps.get('trailing_return_pct')} (target={strategy_params.target_annual_return_pct})"
    )
    return "\n".join(lines)


def _format_telegram_message(output: dict[str, Any]) -> str:
    lines: list[str] = []
    for flag in output.get("urgent_flags") or []:
        lines.append(f"⚠️ {flag}")
    if lines:
        lines.append("")
    lines.append(output.get("regime_line") or "")
    lines.append("")
    lines.append(output.get("new_recommendations_summary") or "")
    lines.append("")
    lines.append(output.get("portfolio_state_line") or "")
    lines.append("")
    lines.append("See /briefings for the full digest.")
    return "\n".join(lines)


def _send_telegram_notification(output: dict[str, Any]) -> None:
    """Pushes a condensed summary via the existing send-alert edge function
    (kept as-is). full_text is deliberately never sent verbatim -- the push is
    a summary that links back to /briefings (v2-23)."""
    url = f"{settings.supabase_url}/functions/v1/send-alert"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "apikey": settings.supabase_service_role_key,
        "Content-Type": "application/json",
    }
    try:
        response = httpx.post(
            url,
            headers=headers,
            json={
                "trigger": "daily_briefing",
                "message": _format_telegram_message(output),
                "briefing": {
                    "urgent_flags": output.get("urgent_flags") or [],
                    "regime_line": output.get("regime_line"),
                    "new_recommendations_summary": output.get("new_recommendations_summary"),
                    "portfolio_state_line": output.get("portfolio_state_line"),
                },
            },
            timeout=15.0,
        )
        response.raise_for_status()
    except Exception:
        # A failed push shouldn't fail the whole pipeline run -- the briefings
        # row is already written; this is best-effort notification delivery.
        logger.exception("Failed to push briefing notification via send-alert")


async def write_briefing(
    *,
    run_id: str,
    strategy_id: str,
    strategy_params: StrategyParams,
    run_date: str | None = None,
    expired_counts: dict[str, int] | None = None,
    db: Any = None,
    client: Any = None,
    send_telegram: bool = True,
    telegram_sender: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Runs the Briefing agent for one pipeline run, writes one briefings row,
    and (unless disabled) pushes a condensed Telegram notification. Last step
    in the daily pipeline (v2-14)."""
    db = db or get_client()
    client = client or get_anthropic_client()
    run_date = run_date or datetime.now(UTC).date().isoformat()
    expired_counts = expired_counts or DEFAULT_EXPIRED_COUNTS
    sender = telegram_sender or _send_telegram_notification

    context = assemble_context(db, run_id=run_id, run_date=run_date, expired_counts=expired_counts)
    system_prompt = load_prompt(AGENT_NAME)
    user_content = build_user_content(context, strategy_params)
    model = AGENT_MODELS[AGENT_NAME]

    # daily_briefing has no <tools> section in its prompt (verified in v2-09) --
    # it only ever calls the forced submit_briefing tool, no query_decision_history.
    result = await asyncio.to_thread(
        run_agent, client, model, system_prompt, user_content, [SUBMIT_BRIEFING_TOOL], "submit_briefing",
    )

    output = result["output"]
    validate_required_fields(output, REQUIRED_FIELDS, AGENT_NAME)

    cost_usd = compute_cost_usd(model, result["prompt_tokens"], result["output_tokens"], result["cache_read_tokens"])

    row = {
        "run_id": run_id,
        "briefing_date": run_date,
        "regime_line": output["regime_line"],
        "urgent_flags": output["urgent_flags"],
        "new_recommendations_summary": output["new_recommendations_summary"],
        "position_actions_summary": output["position_actions_summary"],
        "outcomes_note": output["outcomes_note"],
        "portfolio_state_line": output["portfolio_state_line"],
        "full_text": output["full_text"],
        "model": model,
        "cost_usd": cost_usd,
    }
    inserted = db.table("briefings").insert(row).execute().data[0]

    write_agent_analysis(
        db,
        run_id=run_id,
        symbol=None,
        agent_type=AGENT_TYPE,
        output=output,
        prompt_version=prompt_version(AGENT_NAME),
        model=model,
        prompt_tokens=result["prompt_tokens"],
        output_tokens=result["output_tokens"],
        cache_read_tokens=result["cache_read_tokens"],
        cost_usd=cost_usd,
    )

    if send_telegram:
        sender(output)

    logger.info("daily_briefing: written for run_id=%s, urgent_flags=%d", run_id, len(output.get("urgent_flags") or []))
    return inserted
