from __future__ import annotations

from typing import Any

from artisan.db.client import get_client

THESIS_TRUNCATE_AT = 240


def query_decision_history(
    symbol: str | None = None,
    setup_type: str | None = None,
    regime: str | None = None,
    limit: int = 20,
    *,
    db: Any = None,
) -> dict[str, Any]:
    """The Python implementation backing the query_decision_history tool schema
    every agent calls via Anthropic tool use (schema defined in agents/base.py,
    v2-09). Filters decision_outcomes by any combination of symbol/setup_type/
    regime — omitting all three returns portfolio-wide aggregate stats.
    """
    db = db or get_client()

    query = db.table("decision_outcomes").select(
        "id,symbol,source_type,source_id,mode,resolution,r_multiple,"
        "days_to_resolution,setup_type,regime,resolved_at,created_at"
    )
    if symbol:
        query = query.eq("symbol", symbol)
    if setup_type:
        query = query.eq("setup_type", setup_type)
    if regime:
        query = query.eq("regime", regime)

    rows: list[dict[str, Any]] = query.order("created_at", desc=True).limit(500).execute().data

    resolved = [r for r in rows if r.get("resolution") not in (None, "still_open")]
    hit_target = sum(1 for r in resolved if r["resolution"] == "hit_target")
    hit_stop = sum(1 for r in resolved if r["resolution"] == "hit_stop")
    win_denominator = hit_target + hit_stop
    win_rate = (hit_target / win_denominator) if win_denominator else None

    r_multiples = [r["r_multiple"] for r in resolved if r.get("r_multiple") is not None]
    avg_r_multiple = (sum(r_multiples) / len(r_multiples)) if r_multiples else None

    days = [r["days_to_resolution"] for r in resolved if r.get("days_to_resolution") is not None]
    avg_days_to_resolution = (sum(days) / len(days)) if days else None

    real_count = sum(1 for r in rows if r.get("mode") == "real")
    shadow_count = sum(1 for r in rows if r.get("mode") == "shadow")

    recent_rows = rows[:limit]
    thesis_by_recommendation_id = _fetch_thesis_summaries(db, recent_rows)

    recent = [
        {
            "symbol": r["symbol"],
            "resolution": r.get("resolution"),
            "r_multiple": r.get("r_multiple"),
            "days_to_resolution": r.get("days_to_resolution"),
            "setup_type": r.get("setup_type"),
            "regime": r.get("regime"),
            "resolved_at": r.get("resolved_at"),
            "thesis_summary": (
                thesis_by_recommendation_id.get(r["source_id"])
                if r.get("source_type") == "recommendation"
                else None
            ),
        }
        for r in recent_rows
    ]

    return {
        "aggregate": {
            "win_rate": round(win_rate, 4) if win_rate is not None else None,
            "avg_r_multiple": round(avg_r_multiple, 4) if avg_r_multiple is not None else None,
            "avg_days_to_resolution": (
                round(avg_days_to_resolution, 2) if avg_days_to_resolution is not None else None
            ),
            "count": len(rows),
            "real_count": real_count,
            "shadow_count": shadow_count,
        },
        "recent": recent,
    }


def _fetch_thesis_summaries(db: Any, rows: list[dict[str, Any]]) -> dict[str, str]:
    recommendation_ids = [
        r["source_id"] for r in rows if r.get("source_type") == "recommendation" and r.get("source_id")
    ]
    if not recommendation_ids:
        return {}
    thesis_rows = (
        db.table("recommendations").select("id,thesis").in_("id", recommendation_ids).execute().data
    )
    summaries: dict[str, str] = {}
    for row in thesis_rows:
        thesis = row.get("thesis")
        if thesis:
            truncated = thesis[:THESIS_TRUNCATE_AT]
            summaries[row["id"]] = truncated + ("…" if len(thesis) > THESIS_TRUNCATE_AT else "")
    return summaries
