from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from artisan.adapters import (
    AlpacaPricesAdapter,
    FinnhubNewsAdapter,
    FmpFundamentalsAdapter,
)
from artisan.config import settings
from artisan.db.client import get_client

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def load_universe(db, strategy_id: str) -> list[str]:
    response = (
        db.table("universes")
        .select("symbol")
        .eq("strategy_id", strategy_id)
        .order("symbol")
        .execute()
    )
    return [row["symbol"] for row in response.data]


def write_audit_log(
    db,
    *,
    actor: str,
    action: str,
    entity: str,
    payload: dict[str, Any],
    entity_id: str | None = None,
) -> None:
    db.table("audit_log").insert(
        {
            "actor": actor,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "payload": payload,
        }
    ).execute()


def _news_lookback_start(today: date) -> date:
    return today - timedelta(days=3 if today.weekday() == 0 else 1)


def run_nightly_ingest(
    *,
    db=None,
    prices_adapter: AlpacaPricesAdapter | None = None,
    fundamentals_adapter: FmpFundamentalsAdapter | None = None,
    news_adapter: FinnhubNewsAdapter | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    db = db or get_client()
    prices_adapter = prices_adapter or AlpacaPricesAdapter(db=db)
    fundamentals_adapter = fundamentals_adapter or FmpFundamentalsAdapter(db=db)
    news_adapter = news_adapter or FinnhubNewsAdapter(db=db)
    now = now or datetime.now(UTC)

    symbols = load_universe(db, settings.strategy_id)
    if not symbols:
        raise RuntimeError("Universe is empty for configured strategy")

    summary: dict[str, Any] = {
        "symbols": len(symbols),
        "price_rows": 0,
        "fundamental_rows": 0,
        "news_rows": 0,
        "failures": [],
    }

    price_start = now.date() - timedelta(days=400)
    price_end = now.date()

    bars = prices_adapter.fetch_daily_bars(symbols, start=price_start, end=price_end)
    summary["price_rows"] = prices_adapter.save_bars(bars)
    write_audit_log(
        db,
        actor="github-actions",
        action="ingest_prices",
        entity="price_bars",
        payload={
            "symbols": symbols,
            "row_count": summary["price_rows"],
            "start": price_start.isoformat(),
            "end": price_end.isoformat(),
        },
    )

    fundamental_rows = 0
    for symbol in symbols:
        try:
            fundamentals_adapter.sync_symbol(symbol)
            fundamental_rows += 1
        except Exception as exc:  # pragma: no cover - exercised via job tests
            logger.exception("Fundamentals ingest failed for %s", symbol)
            summary["failures"].append({"stage": "fundamentals", "symbol": symbol, "error": str(exc)})

    summary["fundamental_rows"] = fundamental_rows
    write_audit_log(
        db,
        actor="github-actions",
        action="ingest_fundamentals",
        entity="fundamentals",
        payload={
            "row_count": fundamental_rows,
            "failures": [failure for failure in summary["failures"] if failure["stage"] == "fundamentals"],
        },
    )

    news_rows = 0
    news_start = _news_lookback_start(now.date())
    for symbol in symbols:
        try:
            articles = news_adapter.fetch_news(symbol, start=news_start, end=now.date())
            news_rows += news_adapter.save_articles(articles)
        except Exception as exc:  # pragma: no cover - exercised via job tests
            logger.exception("News ingest failed for %s", symbol)
            summary["failures"].append({"stage": "news", "symbol": symbol, "error": str(exc)})

    summary["news_rows"] = news_rows
    write_audit_log(
        db,
        actor="github-actions",
        action="ingest_news",
        entity="news_articles",
        payload={
            "row_count": news_rows,
            "from": news_start.isoformat(),
            "to": now.date().isoformat(),
            "failures": [failure for failure in summary["failures"] if failure["stage"] == "news"],
        },
    )

    if summary["fundamental_rows"] == 0:
        raise RuntimeError("Nightly ingest failed: no fundamentals were ingested")

    logger.info("Nightly ingest summary: %s", summary)
    return summary


def main() -> None:
    run_nightly_ingest()


if __name__ == "__main__":
    main()
