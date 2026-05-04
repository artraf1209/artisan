from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from artisan.adapters import (
    AlpacaPricesAdapter,
    FinnhubNewsAdapter,
    FmpFundamentalsAdapter,
)
from artisan.adapters.fmp_screener import FmpScreenerAdapter
from artisan.config import settings
from artisan.db.client import get_client

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def load_universe(db, strategy_id: str) -> list[str]:
    """Load active universe symbols for a strategy."""
    response = (
        db.table("universes")
        .select("symbol")
        .eq("strategy_id", strategy_id)
        .eq("active", True)
        .order("symbol")
        .execute()
    )
    return [row["symbol"] for row in response.data]


def refresh_universe(db, strategy_id: str, screener: FmpScreenerAdapter) -> list[str]:
    """
    Run FMP screener → upsert new symbols, deactivate removed ones.
    Returns the new active symbol list.
    """
    now_iso = datetime.now(UTC).isoformat()
    new_symbols = screener.screen()
    if not new_symbols:
        logger.warning("Screener returned 0 symbols; keeping existing universe")
        return load_universe(db, strategy_id)

    # Upsert new symbols as active
    rows = [
        {"strategy_id": strategy_id, "symbol": s, "active": True, "screened_at": now_iso}
        for s in new_symbols
    ]
    db.table("universes").upsert(rows, on_conflict="strategy_id,symbol").execute()

    # Deactivate symbols no longer in screener
    new_set = set(new_symbols)
    existing = (
        db.table("universes")
        .select("symbol")
        .eq("strategy_id", strategy_id)
        .execute()
        .data
    )
    to_deactivate = [r["symbol"] for r in existing if r["symbol"] not in new_set]
    for sym in to_deactivate:
        db.table("universes").update({"active": False}).eq("strategy_id", strategy_id).eq("symbol", sym).execute()

    logger.info(
        "Universe refreshed: %d active, %d deactivated",
        len(new_symbols), len(to_deactivate),
    )
    return new_symbols


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
    screener: FmpScreenerAdapter | None = None,
    now: datetime | None = None,
    refresh_universe_from_screener: bool = True,
) -> dict[str, Any]:
    db = db or get_client()
    prices_adapter = prices_adapter or AlpacaPricesAdapter(db=db)
    fundamentals_adapter = fundamentals_adapter or FmpFundamentalsAdapter(db=db)
    news_adapter = news_adapter or FinnhubNewsAdapter(db=db)
    screener = screener or FmpScreenerAdapter()
    now = now or datetime.now(UTC)

    # ── Universe refresh via FMP screener ─────────────────────────────────
    if refresh_universe_from_screener:
        symbols = refresh_universe(db, settings.strategy_id, screener)
    else:
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

    # ── Price bars (include SPY as benchmark) ─────────────────────────────
    price_start = now.date() - timedelta(days=400)
    price_end = now.date()
    all_price_symbols = list(dict.fromkeys(symbols + ["SPY"]))  # SPY for market regime + beta

    bars = prices_adapter.fetch_daily_bars(all_price_symbols, start=price_start, end=price_end)
    summary["price_rows"] = prices_adapter.save_bars(bars)
    write_audit_log(
        db,
        actor="github-actions",
        action="ingest_prices",
        entity="price_bars",
        payload={
            "symbols": all_price_symbols,
            "row_count": summary["price_rows"],
            "start": price_start.isoformat(),
            "end": price_end.isoformat(),
        },
    )

    # ── Fundamentals (extended: cash-flow + balance-sheet) ────────────────
    fundamental_rows = 0
    for symbol in symbols:
        try:
            fundamentals_adapter.sync_symbol(symbol)
            fundamental_rows += 1
        except Exception as exc:
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
            "failures": [f for f in summary["failures"] if f["stage"] == "fundamentals"],
        },
    )

    # ── News ──────────────────────────────────────────────────────────────
    news_rows = 0
    news_start = _news_lookback_start(now.date())
    for symbol in symbols:
        try:
            articles = news_adapter.fetch_news(symbol, start=news_start, end=now.date())
            news_rows += news_adapter.save_articles(articles)
        except Exception as exc:
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
            "failures": [f for f in summary["failures"] if f["stage"] == "news"],
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
