from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _latest_price(db, symbol: str) -> float | None:
    rows = (
        db.table("price_bars")
        .select("close,bar_time")
        .eq("symbol", symbol)
        .order("bar_time", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return float(rows[0]["close"]) if rows else None


def _r_multiple(exit_price: float, entry_price: float | None, stop_price: float | None) -> float | None:
    if entry_price is None or stop_price is None:
        return None
    risk_per_share = entry_price - stop_price
    if risk_per_share == 0:
        return None
    return round((exit_price - entry_price) / risk_per_share, 4)


def _days_since(created_at: str, now: datetime) -> int:
    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    return (now.date() - created.date()).days


def _position_still_open(db, position_id: str) -> bool:
    rows = db.table("portfolio_positions").select("id").eq("id", position_id).limit(1).execute().data
    return bool(rows)


def _resolve_superseded(db, row: dict[str, Any]) -> bool:
    """A position_review-sourced decision_outcome is superseded once the linked
    position no longer exists in portfolio_positions (closed by a later review's
    CLOSE action, rather than by naturally hitting stop/target/time here)."""
    if row.get("source_type") != "position_review":
        return False
    reviews = (
        db.table("position_reviews")
        .select("position_id")
        .eq("id", row["source_id"])
        .limit(1)
        .execute()
        .data
    )
    if not reviews:
        return False
    position_id = reviews[0].get("position_id")
    return position_id is not None and not _position_still_open(db, position_id)


def _resolve_row(db, row: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    """Returns the decision_outcomes update dict to apply, or None if still open."""
    price = _latest_price(db, row["symbol"])
    if price is None:
        return None

    entry = row.get("entry_price_reference")
    target = row.get("target_price")
    stop = row.get("stop_price")
    horizon = row.get("effective_horizon_days")
    days_held = _days_since(row["created_at"], now)

    resolution: str | None = None
    if target is not None and price >= target:
        resolution = "hit_target"
    elif stop is not None and price <= stop:
        resolution = "hit_stop"
    elif horizon is not None and days_held > horizon:
        if entry is not None and price > entry:
            resolution = "time_expired_favorable"
        elif entry is not None and price < entry:
            resolution = "time_expired_unfavorable"
        else:
            resolution = "time_expired_flat"
    elif _resolve_superseded(db, row):
        resolution = "superseded"

    if resolution is None:
        return None

    return {
        "resolution": resolution,
        "resolved_at": now.isoformat(),
        "days_to_resolution": days_held,
        "r_multiple": _r_multiple(price, entry, stop),
        "updated_at": now.isoformat(),
    }


def run_track_outcomes(*, db=None, now: datetime | None = None) -> dict[str, Any]:
    """Pure code, no LLM call: resolves every still-open decision_outcomes row
    against the latest price, or marks it superseded if the underlying position
    was closed by a later action. See spec §12."""
    db = db or get_client()
    now = now or datetime.now(UTC)

    open_rows = (
        db.table("decision_outcomes")
        .select(
            "id,symbol,source_type,source_id,entry_price_reference,stop_price,"
            "target_price,effective_horizon_days,created_at"
        )
        .eq("resolution", "still_open")
        .execute()
        .data
    )

    resolved = 0
    for row in open_rows:
        update = _resolve_row(db, row, now)
        if update is not None:
            db.table("decision_outcomes").update(update).eq("id", row["id"]).execute()
            resolved += 1

    logger.info("track_outcomes: %d/%d decision_outcomes rows resolved", resolved, len(open_rows))
    return {"checked": len(open_rows), "resolved": resolved}


def main() -> None:
    run_track_outcomes()


if __name__ == "__main__":
    main()
