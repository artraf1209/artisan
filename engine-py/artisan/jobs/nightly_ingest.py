from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from artisan.adapters import (
    AlpacaPricesAdapter,
    FinnhubNewsAdapter,
    FmpFundamentalsAdapter,
)
from artisan.adapters.fmp_screener import FmpScreenerAdapter, FmpScreenerUnavailableError
from artisan.config import settings
from artisan.db.client import get_client

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def is_within_fmp_quota_window(now: datetime | None = None) -> bool:
    """
    Check if current UTC time is within the allowed FMP quota window.
    
    FMP quota resets at configured hour (default: 8pm UTC / 3pm EST).
    Buffer period (default: 60min) creates the allowed window start
    (default: 9pm UTC / 4pm EST).
    
    Returns True if within window, False if before window (pre-reset).
    """
    now = now or datetime.now(UTC)
    
    reset_hour = settings.fmp_quota_reset_hour_utc
    reset_minute = settings.fmp_quota_reset_minute_utc
    buffer_minutes = settings.fmp_quota_buffer_minutes
    
    # Calculate earliest allowed time (reset time + buffer)
    allowed_hour = reset_hour + (reset_minute + buffer_minutes) // 60
    allowed_minute = (reset_minute + buffer_minutes) % 60
    
    # Handle hour overflow past midnight
    allowed_hour = allowed_hour % 24
    
    current_minutes = now.hour * 60 + now.minute
    allowed_minutes = allowed_hour * 60 + allowed_minute
    
    return current_minutes >= allowed_minutes


def check_fmp_quota_guard(
    now: datetime | None = None,
    force_override: bool = False,
) -> tuple[bool, str]:
    """
    Evaluate whether to proceed with FMP API calls or skip as pre-reset.
    
    Args:
        now: Optional datetime for testing (defaults to now UTC)
        force_override: If True, bypasses the guard (for manual operator runs)
    
    Returns:
        Tuple of (should_proceed: bool, reason: str)
    """
    now = now or datetime.now(UTC)
    
    # Force override takes priority - operator explicitly requested run
    if force_override or settings.force_pre_reset_ingest:
        return True, "forced_pre_reset=true"
    
    # Check if within allowed window
    if is_within_fmp_quota_window(now):
        return True, "within_quota_window"
    
    # Pre-reset - return skip status
    reset_time = f"{settings.fmp_quota_reset_hour_utc:02d}:{settings.fmp_quota_reset_minute_utc:02d} UTC"
    allowed_time = (
        settings.fmp_quota_reset_hour_utc 
        + (settings.fmp_quota_reset_minute_utc + settings.fmp_quota_buffer_minutes) // 60
    ) % 24
    allowed_time_str = f"{allowed_time:02d}:{(settings.fmp_quota_reset_minute_utc + settings.fmp_quota_buffer_minutes) % 60:02d} UTC"
    
    logger.info(
        "FMP quota guard blocked run: current_time=%s, reset_time=%s, allowed_time=%s, buffer=%dm",
        now.strftime("%H:%M UTC"),
        reset_time,
        allowed_time_str,
        settings.fmp_quota_buffer_minutes,
    )
    
    return False, "skipped_pre_reset_window"


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


def refresh_universe(db, strategy_id: str, screener: FmpScreenerAdapter) -> dict[str, Any]:
    """
    Run FMP screener → upsert new symbols, deactivate removed ones.
    Returns active symbols plus refresh status for auditing.
    """
    now_iso = datetime.now(UTC).isoformat()
    try:
        new_symbols = screener.screen(top_n=settings.screener_top_n)
    except FmpScreenerUnavailableError as exc:
        existing = load_universe(db, strategy_id)
        logger.warning("Universe screener degraded: %s", exc)
        return {
            "symbols": existing,
            "status": "degraded_existing_universe",
            "requested_top_n": settings.screener_top_n,
            "screened_count": len(existing),
            "error": str(exc),
        }

    if not new_symbols:
        existing = load_universe(db, strategy_id)
        logger.warning("Screener returned 0 symbols; keeping existing universe")
        return {
            "symbols": existing,
            "status": "degraded_existing_universe",
            "requested_top_n": settings.screener_top_n,
            "screened_count": len(existing),
            "error": "screener_returned_zero_symbols",
        }

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
    return {
        "symbols": new_symbols,
        "status": "refreshed",
        "requested_top_n": settings.screener_top_n,
        "screened_count": len(new_symbols),
        "deactivated_count": len(to_deactivate),
    }


def _select_fundamental_refresh_symbols(
    db,
    symbols: list[str],
    refresh_limit: int,
) -> list[str]:
    if not symbols or refresh_limit <= 0:
        return []

    rows = (
        db.table("fundamentals")
        .select("symbol, fetched_at")
        .in_("symbol", symbols)
        .order("fetched_at", desc=True)
        .limit(max(len(symbols) * 6, refresh_limit))
        .execute()
        .data
    )

    latest_by_symbol: dict[str, str] = {}
    for row in rows:
        symbol = row.get("symbol")
        fetched_at = row.get("fetched_at")
        if symbol and fetched_at and symbol not in latest_by_symbol:
            latest_by_symbol[symbol] = fetched_at

    missing = [symbol for symbol in symbols if symbol not in latest_by_symbol]
    stale = sorted(
        latest_by_symbol.items(),
        key=lambda item: item[1],
    )
    stale_symbols = [symbol for symbol, _ in stale if symbol not in missing]
    ordered = missing + stale_symbols
    return ordered[:refresh_limit]


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
    force_pre_reset: bool = False,
) -> dict[str, Any]:
    db = db or get_client()
    now = now or datetime.now(UTC)
    
    # ── FMP Quota Guard ────────────────────────────────────────────────
    should_proceed, guard_reason = check_fmp_quota_guard(now=now, force_override=force_pre_reset)
    
    if not should_proceed:
        # Pre-reset: return clean no-op instead of making API calls
        logger.info("FMP quota guard: exiting early, reason=%s", guard_reason)
        return {
            "status": guard_reason,
            "symbols": 0,
            "screened_symbols": 0,
            "universe_refresh_status": "skipped_pre_reset_window",
            "fundamental_targets": 0,
            "price_rows": 0,
            "fundamental_rows": 0,
            "news_rows": 0,
            "failures": [],
        }
    
    prices_adapter = prices_adapter or AlpacaPricesAdapter(db=db)
    fundamentals_adapter = fundamentals_adapter or FmpFundamentalsAdapter(db=db)
    news_adapter = news_adapter or FinnhubNewsAdapter(db=db)
    screener = screener or FmpScreenerAdapter()

    # ── Universe refresh via FMP screener ─────────────────────────────────
    if refresh_universe_from_screener:
        universe_refresh = refresh_universe(db, settings.strategy_id, screener)
        symbols = universe_refresh["symbols"]
    else:
        existing_symbols = load_universe(db, settings.strategy_id)
        universe_refresh = {
            "symbols": existing_symbols,
            "status": "existing_universe_only",
            "requested_top_n": settings.screener_top_n,
            "screened_count": len(existing_symbols),
        }
        symbols = existing_symbols

    if not symbols:
        raise RuntimeError("Universe is empty for configured strategy")

    refresh_symbols = _select_fundamental_refresh_symbols(
        db,
        symbols,
        settings.fundamentals_refresh_limit,
    )

    summary: dict[str, Any] = {
        "status": guard_reason,
        "symbols": len(symbols),
        "screened_symbols": universe_refresh.get("screened_count", len(symbols)),
        "universe_refresh_status": universe_refresh.get("status"),
        "fundamental_targets": len(refresh_symbols),
        "price_rows": 0,
        "fundamental_rows": 0,
        "news_rows": 0,
        "failures": [],
    }

    # ── Price bars (include SPY as benchmark) ─────────────────────────────
    price_start = now.date() - timedelta(days=settings.price_history_lookback_days)
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
    for symbol in refresh_symbols:
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
            "refresh_targets": refresh_symbols,
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

    if refresh_symbols and summary["fundamental_rows"] == 0:
        raise RuntimeError("Nightly ingest failed: no fundamentals were ingested")

    logger.info("Nightly ingest summary: %s", summary)
    summary["status"] = guard_reason
    return summary


def main() -> None:
    run_nightly_ingest()


if __name__ == "__main__":
    main()
