from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, Iterator

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def resolve_current_run_id(db: Any) -> str:
    """Every daily_pipeline.yml job (score -> track_outcomes -> expire_stale ->
    review_positions -> synthesize -> briefing) shares the single pipeline_runs
    row nightly_ingest.py created, rather than creating its own."""
    rows = db.table("pipeline_runs").select("id,status").order("started_at", desc=True).limit(1).execute().data
    if not rows:
        raise RuntimeError("No pipeline_runs row found; nightly_ingest must run first")
    return rows[0]["id"]


def resolve_latest_completed_run_id(db: Any) -> str:
    """Returns stable market context for work triggered outside the daily pipeline."""
    rows = (
        db.table("pipeline_runs")
        .select("id")
        .eq("status", "completed")
        .order("started_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise RuntimeError("No completed pipeline_runs row found for position review context")
    return rows[0]["id"]


@contextmanager
def pipeline_job(job_name: str, db: Any = None) -> Iterator[tuple[Any, str]]:
    """Wraps a daily_pipeline.yml job entry point: resolves the shared run_id
    and, on any exception, marks pipeline_runs 'failed' before re-raising (so
    the GitHub Actions step fails and the needs: chain blocks every downstream
    job) rather than leaving the row stuck at its current status."""
    db = db or get_client()
    run_id = resolve_current_run_id(db)
    try:
        yield db, run_id
    except Exception:
        logger.exception("%s failed for run_id=%s", job_name, run_id)
        db.table("pipeline_runs").update(
            {"status": "failed", "completed_at": datetime.now(UTC).isoformat()}
        ).eq("id", run_id).execute()
        raise
