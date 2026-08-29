from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Callable
from zoneinfo import ZoneInfo

import httpx

from artisan.adapters import (
    AlpacaAccountAdapter,
    AlpacaPricesAdapter,
    FinnhubNewsAdapter,
    FmpFundamentalsAdapter,
)
from artisan.adapters.fmp_screener import FmpScreenerAdapter, FmpScreenerUnavailableError
from artisan.config import settings
from artisan.db.client import get_client
from artisan.strategy_params import get_strategy_params

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

TRAILING_RETURN_WINDOW_DAYS = 252
MARKET_CALENDAR_LOOKBACK_DAYS = 14
US_MARKET_TIMEZONE = ZoneInfo("America/New_York")


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
    refresh_limit: int | None,
) -> list[str]:
    if not symbols:
        return []

    if refresh_limit is None or refresh_limit <= 0:
        return list(symbols)

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


def _load_market_calendar(
    start: date,
    end: date,
    *,
    http_client: httpx.Client | None = None,
    base_url: str | None = None,
) -> list[dict[str, Any]]:
    client = http_client or httpx.Client(timeout=30.0)
    try:
        response = client.get(
            f"{(base_url or settings.alpaca_base_url).rstrip('/')}/v2/calendar",
            params={
                "start": start.isoformat(),
                "end": end.isoformat(),
                "date_type": "TRADING",
            },
            headers={
                "APCA-API-KEY-ID": settings.alpaca_api_key,
                "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
            },
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []
    finally:
        if http_client is None:
            client.close()


def _parse_market_close(session: dict[str, Any]) -> datetime:
    session_date = date.fromisoformat(str(session["date"]))
    raw_close = str(session.get("close") or "")

    if "T" in raw_close:
        normalized = raw_close.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).astimezone(US_MARKET_TIMEZONE)

    close_parts = [int(part) for part in raw_close.split(":") if part]
    if len(close_parts) == 2:
        close_parts.append(0)
    if len(close_parts) != 3:
        raise RuntimeError(f"Unexpected Alpaca market calendar close value: {raw_close!r}")

    return datetime.combine(
        session_date,
        time(close_parts[0], close_parts[1], close_parts[2]),
        tzinfo=US_MARKET_TIMEZONE,
    )


def resolve_run_date(
    now: datetime,
    *,
    market_calendar_loader: Callable[[date, date], list[dict[str, Any]]] | None = None,
) -> date:
    market_now = now.astimezone(US_MARKET_TIMEZONE)
    calendar_loader = market_calendar_loader or _load_market_calendar
    calendar_rows = calendar_loader(
        market_now.date() - timedelta(days=MARKET_CALENDAR_LOOKBACK_DAYS),
        market_now.date(),
    )
    if not calendar_rows:
        raise RuntimeError("Alpaca market calendar returned no sessions for run-date resolution")

    last_completed_session: date | None = None
    for session in sorted(calendar_rows, key=lambda row: str(row.get("date") or "")):
        session_date = date.fromisoformat(str(session["date"]))
        if market_now >= _parse_market_close(session):
            last_completed_session = session_date

    if last_completed_session is None:
        raise RuntimeError("Unable to resolve a completed US trading session for nightly ingest")

    return last_completed_session


def _create_pipeline_run(db, run_date: date) -> str:
    response = (
        db.table("pipeline_runs")
        .insert({"run_date": run_date.isoformat(), "status": "running"})
        .execute()
    )
    return response.data[0]["id"]


def _update_pipeline_run(db, run_id: str, **fields: Any) -> None:
    db.table("pipeline_runs").update(fields).eq("id", run_id).execute()


def _fetch_latest_portfolio_snapshot(db, account_id: str) -> dict | None:
    rows = (
        db.table("portfolio_snapshots")
        .select("equity, high_water_mark, snapshot_date")
        .eq("account_id", account_id)
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _fetch_trailing_baseline_snapshot(db, account_id: str, since: date) -> dict | None:
    rows = (
        db.table("portfolio_snapshots")
        .select("equity, snapshot_date")
        .eq("account_id", account_id)
        .gte("snapshot_date", since.isoformat())
        .order("snapshot_date")
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _fetch_open_positions_state(db, account_id: str) -> tuple[int, float]:
    rows = (
        db.table("portfolio_positions")
        .select("unrealized_pnl")
        .eq("account_id", account_id)
        .execute()
        .data
    )
    total_unrealized = sum(float(row.get("unrealized_pnl") or 0) for row in rows)
    return len(rows), total_unrealized


def _write_portfolio_snapshot(db, *, run_id: str, run_date: date, account: dict[str, float]) -> dict[str, Any]:
    """Insert one portfolio_snapshots row. This is the only place in the system
    that writes this table — no other job touches it."""
    account_id = settings.account_id
    equity = account["equity"]
    cash = account["cash"]

    prior = _fetch_latest_portfolio_snapshot(db, account_id)
    prior_hwm = (
        float(prior["high_water_mark"])
        if prior and prior.get("high_water_mark") is not None
        else None
    )
    high_water_mark = max(prior_hwm, equity) if prior_hwm is not None else equity
    drawdown_from_high_pct = (equity - high_water_mark) / high_water_mark if high_water_mark else 0.0

    baseline = _fetch_trailing_baseline_snapshot(
        db, account_id, run_date - timedelta(days=TRAILING_RETURN_WINDOW_DAYS)
    )
    if baseline and baseline.get("equity"):
        baseline_equity = float(baseline["equity"])
        trailing_return_pct = (equity - baseline_equity) / baseline_equity if baseline_equity else 0.0
    else:
        trailing_return_pct = 0.0

    open_positions_count, unrealized_pnl = _fetch_open_positions_state(db, account_id)

    row = {
        "account_id": account_id,
        "run_id": run_id,
        "snapshot_date": run_date.isoformat(),
        "equity": equity,
        "cash": cash,
        "open_positions_count": open_positions_count,
        "unrealized_pnl": unrealized_pnl,
        "high_water_mark": high_water_mark,
        "drawdown_from_high_pct": drawdown_from_high_pct,
        "trailing_return_pct": trailing_return_pct,
    }
    db.table("portfolio_snapshots").insert(row).execute()
    return row


def run_nightly_ingest(
    *,
    db=None,
    prices_adapter: AlpacaPricesAdapter | None = None,
    fundamentals_adapter: FmpFundamentalsAdapter | None = None,
    news_adapter: FinnhubNewsAdapter | None = None,
    screener: FmpScreenerAdapter | None = None,
    account_adapter: AlpacaAccountAdapter | None = None,
    now: datetime | None = None,
    refresh_universe_from_screener: bool = True,
    force_pre_reset: bool = False,
    market_calendar_loader: Callable[[date, date], list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    db = db or get_client()
    now = now or datetime.now(UTC)
    run_date = resolve_run_date(now, market_calendar_loader=market_calendar_loader)

    run_id = _create_pipeline_run(db, run_date)

    # ── FMP Quota Guard ────────────────────────────────────────────────
    should_proceed, guard_reason = check_fmp_quota_guard(now=now, force_override=force_pre_reset)

    if not should_proceed:
        # Pre-reset: return clean no-op instead of making API calls
        logger.info("FMP quota guard: exiting early, reason=%s", guard_reason)
        _update_pipeline_run(db, run_id, status="skipped", completed_at=now.isoformat())
        write_audit_log(
            db,
            actor="github-actions",
            action="nightly_ingest_skipped",
            entity="pipeline_runs",
            entity_id=run_id,
            payload={"run_id": run_id, "run_date": run_date.isoformat(), "reason": guard_reason},
        )
        return {
            "status": guard_reason,
            "run_id": run_id,
            "run_date": run_date.isoformat(),
            "symbols": 0,
            "screened_symbols": 0,
            "universe_refresh_status": "skipped_pre_reset_window",
            "fundamental_targets": 0,
            "price_rows": 0,
            "fundamental_rows": 0,
            "news_rows": 0,
            "skipped_invalid_symbols": [],
            "failures": [],
        }

    try:
        # ── Load strategy config from DB (no hardcoded thresholds) ────────
        strategy_params = get_strategy_params(settings.strategy_id, db=db)
        write_audit_log(
            db,
            actor="github-actions",
            action="run_started",
            entity="pipeline_runs",
            entity_id=run_id,
            payload={
                "run_id": run_id,
                "run_date": run_date.isoformat(),
                "strategy_id": settings.strategy_id,
                "shortlist_size": strategy_params.shortlist_size,
                "max_concurrent_positions": strategy_params.max_concurrent_positions,
            },
        )

        prices_adapter = prices_adapter or AlpacaPricesAdapter(db=db)
        fundamentals_adapter = fundamentals_adapter or FmpFundamentalsAdapter(db=db)
        news_adapter = news_adapter or FinnhubNewsAdapter(db=db)
        screener = screener or FmpScreenerAdapter()
        account_adapter = account_adapter or AlpacaAccountAdapter()

        # ── Universe refresh via FMP screener ─────────────────────────────
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
            "run_id": run_id,
            "run_date": run_date.isoformat(),
            "symbols": len(symbols),
            "screened_symbols": universe_refresh.get("screened_count", len(symbols)),
            "universe_refresh_status": universe_refresh.get("status"),
            "fundamental_targets": len(refresh_symbols),
            "price_rows": 0,
            "fundamental_rows": 0,
            "news_rows": 0,
            "skipped_invalid_symbols": [],
            "failures": [],
        }

        # ── Price bars (include SPY as benchmark) ─────────────────────────
        price_start = run_date - timedelta(days=settings.price_history_lookback_days)
        price_end = run_date
        all_price_symbols = list(dict.fromkeys(symbols + ["SPY"]))  # SPY for market regime + beta

        bars = prices_adapter.fetch_daily_bars(all_price_symbols, start=price_start, end=price_end)
        summary["skipped_invalid_symbols"] = list(
            getattr(prices_adapter, "last_skipped_invalid_symbols", [])
        )
        summary["price_rows"] = prices_adapter.save_bars(bars)
        write_audit_log(
            db,
            actor="github-actions",
            action="ingest_prices",
            entity="price_bars",
            payload={
                "run_id": run_id,
                "symbols": all_price_symbols,
                "row_count": summary["price_rows"],
                "start": price_start.isoformat(),
                "end": price_end.isoformat(),
                "run_date": run_date.isoformat(),
                "skipped_invalid_symbols": summary["skipped_invalid_symbols"],
            },
        )

        # ── Fundamentals (extended: cash-flow + balance-sheet) ────────────
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
                "run_id": run_id,
                "run_date": run_date.isoformat(),
                "row_count": fundamental_rows,
                "refresh_targets": refresh_symbols,
                "failures": [f for f in summary["failures"] if f["stage"] == "fundamentals"],
            },
        )

        # ── News ──────────────────────────────────────────────────────────
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
                "run_id": run_id,
                "run_date": run_date.isoformat(),
                "row_count": news_rows,
                "from": news_start.isoformat(),
                "to": now.date().isoformat(),
                "failures": [f for f in summary["failures"] if f["stage"] == "news"],
            },
        )

        if refresh_symbols and summary["fundamental_rows"] == 0:
            raise RuntimeError("Nightly ingest failed: no fundamentals were ingested")

        # ── Portfolio snapshot (equity/drawdown time series) ───────────────
        account = account_adapter.get_account()
        summary["portfolio_snapshot"] = _write_portfolio_snapshot(
            db, run_id=run_id, run_date=run_date, account=account
        )

        logger.info("Nightly ingest summary: %s", summary)
        write_audit_log(
            db,
            actor="github-actions",
            action="nightly_ingest_summary",
            entity="pipeline_runs",
            entity_id=run_id,
            payload={**summary, "run_id": run_id},
        )

        # "ingested", not "completed": the daily_pipeline.yml chain (v2-14) reuses
        # this same pipeline_runs row through score -> ... -> briefing, so only
        # briefing.py's success sets the terminal "completed" status.
        _update_pipeline_run(db, run_id, status="ingested")
        summary["status"] = guard_reason
        return summary

    except Exception as exc:
        logger.exception("Nightly ingest failed, marking pipeline_runs as failed")
        _update_pipeline_run(db, run_id, status="failed", completed_at=now.isoformat())
        write_audit_log(
            db,
            actor="github-actions",
            action="nightly_ingest_failed",
            entity="pipeline_runs",
            entity_id=run_id,
            payload={"run_id": run_id, "run_date": run_date.isoformat(), "error": str(exc)},
        )
        raise


def main() -> None:
    run_nightly_ingest()


if __name__ == "__main__":
    main()
