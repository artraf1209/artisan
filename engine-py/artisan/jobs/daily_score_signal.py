from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from artisan.config import settings
from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import load_universe, write_audit_log
from artisan.llm.thesis_analyst import ThesisAnalyst
from artisan.pipeline import SignalPipeline
from artisan.scorers import CompositeScorer, FundamentalScorer, SentimentScorer, TechnicalScorer

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def run_daily_score_signal(*, db=None, now: datetime | None = None) -> dict[str, Any]:
    db = db or get_client()
    now = now or datetime.now(UTC)
    run_at = now.isoformat()

    technical = TechnicalScorer(db=db)
    fundamental = FundamentalScorer(db=db)
    sentiment = SentimentScorer(db=db)
    composite = CompositeScorer(db=db)
    pipeline = SignalPipeline(db=db)

    strategy = composite.fetch_strategy(settings.strategy_id)
    symbols = load_universe(db, settings.strategy_id)

    summary = {
        "symbols": len(symbols),
        "indicators": 0,
        "composite_scores": 0,
        "signals_created": 0,
        "signals_skipped": 0,
    }

    for symbol in symbols:
        technical_result = technical.score_symbol(symbol, computed_at=run_at)
        fundamental_result = fundamental.score_symbol(symbol)
        sentiment_result = sentiment.score_symbol(symbol, now=now)
        composite_row = composite.score_symbol(
            symbol=symbol,
            strategy=strategy,
            f_score=fundamental_result["f_score"],
            t_score=technical_result["t_score"],
            s_score=sentiment_result["s_score"],
            scored_at=run_at,
        )

        summary["indicators"] += 1
        summary["composite_scores"] += 1

        signal = pipeline.process_symbol(
            strategy=strategy,
            composite_row=composite_row,
            indicator_row=technical_result,
            fundamental_row=fundamental_result["row"],
            now=now,
        )

        if signal:
            summary["signals_created"] += 1
        else:
            summary["signals_skipped"] += 1

    thesis_summary = ThesisAnalyst(db=db).run(now=now)
    summary["theses_created"] = thesis_summary["theses_created"]
    summary["theses_failed"] = thesis_summary["theses_failed"]
    summary["thesis_signals_skipped"] = thesis_summary["signals_skipped"]

    write_audit_log(
        db,
        actor="github-actions",
        action="score_and_signal",
        entity="signal_events",
        payload=summary,
    )
    logger.info("Daily score + signal summary: %s", summary)
    return summary


def main() -> None:
    run_daily_score_signal()


if __name__ == "__main__":
    main()
