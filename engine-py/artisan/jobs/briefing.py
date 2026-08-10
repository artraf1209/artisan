from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from artisan.agents.daily_briefing import DEFAULT_EXPIRED_COUNTS, write_briefing
from artisan.config import settings
from artisan.jobs.common import pipeline_job
from artisan.strategy_params import get_strategy_params

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def _load_expired_counts(db: Any, run_id: str) -> dict[str, int]:
    rows = (
        db.table("audit_log")
        .select("payload")
        .eq("entity_id", run_id)
        .eq("action", "expire_stale")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return DEFAULT_EXPIRED_COUNTS
    payload = rows[0].get("payload") or {}
    return {
        "recommendations_expired": payload.get("recommendations_expired", 0),
        "position_reviews_expired": payload.get("position_reviews_expired", 0),
    }


def _load_run_date(db: Any, run_id: str) -> str | None:
    rows = db.table("pipeline_runs").select("run_date").eq("id", run_id).limit(1).execute().data
    return rows[0]["run_date"] if rows else None


def main() -> None:
    with pipeline_job("briefing") as (db, run_id):
        strategy_id = settings.strategy_id
        strategy_params = get_strategy_params(strategy_id, db=db)
        run_date = _load_run_date(db, run_id)
        expired_counts = _load_expired_counts(db, run_id)

        result = asyncio.run(
            write_briefing(
                run_id=run_id,
                strategy_id=strategy_id,
                strategy_params=strategy_params,
                run_date=run_date,
                expired_counts=expired_counts,
                db=db,
            )
        )
        logger.info("briefing: written id=%s", result["id"])

        # Last step in the chain -- this is the only job that sets the terminal
        # 'completed' status (nightly_ingest sets 'ingested', not 'completed').
        db.table("pipeline_runs").update(
            {"status": "completed", "completed_at": datetime.now(UTC).isoformat()}
        ).eq("id", run_id).execute()


if __name__ == "__main__":
    main()
