from __future__ import annotations

import logging
import sys
from typing import Any

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _expire_table(db, table_name: str, current_run_id: str) -> int:
    rows = db.table(table_name).select("id,run_id").eq("status", "pending").execute().data
    # Compare in Python (not a `.neq()` REST filter) so NULL run_id rows — which a
    # SQL `!=` would silently exclude — are correctly treated as stale too.
    stale_ids = [row["id"] for row in rows if row.get("run_id") != current_run_id]
    for row_id in stale_ids:
        db.table(table_name).update({"status": "expired"}).eq("id", row_id).execute()
    return len(stale_ids)


def run_expire_stale(*, db=None, current_run_id: str) -> dict[str, Any]:
    """Queue hygiene only — never touches decision_outcomes. A recommendation or
    position_review that expires unactioned still has its decision_outcomes row
    tracked in shadow mode by track_outcomes.py regardless of queue status."""
    db = db or get_client()

    recommendations_expired = _expire_table(db, "recommendations", current_run_id)
    position_reviews_expired = _expire_table(db, "position_reviews", current_run_id)

    logger.info(
        "expire_stale: %d recommendations, %d position_reviews expired (run_id=%s)",
        recommendations_expired,
        position_reviews_expired,
        current_run_id,
    )
    return {
        "recommendations_expired": recommendations_expired,
        "position_reviews_expired": position_reviews_expired,
    }


def _resolve_current_run_id(db) -> str:
    rows = (
        db.table("pipeline_runs")
        .select("id")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise RuntimeError("No pipeline_runs row found; cannot determine current run_id")
    return rows[0]["id"]


def main() -> None:
    db = get_client()
    run_id = sys.argv[1] if len(sys.argv) > 1 else _resolve_current_run_id(db)
    run_expire_stale(db=db, current_run_id=run_id)


if __name__ == "__main__":
    main()
