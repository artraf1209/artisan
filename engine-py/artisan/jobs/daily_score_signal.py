from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from artisan.config import settings
from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import load_universe, write_audit_log
from artisan.llm.thesis_analyst import ThesisAnalyst
from artisan.pipeline import SignalPipeline
from artisan.scorers import CompositeScorer, FundamentalScorer, SentimentScorer, TechnicalScorer
from artisan.scorers.factor_composite import score_universe
from artisan.timing.entry_gates import evaluate_entry

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)


def _load_price_df(db, symbols: list[str], days: int = 400) -> pd.DataFrame:
    """Load price bars for all symbols into a wide DataFrame (index=date, cols=symbol)."""
    from datetime import date, timedelta
    start = (datetime.now(UTC).date() - timedelta(days=days)).isoformat()
    rows = (
        db.table("price_bars")
        .select("symbol, bar_time, close")
        .in_("symbol", symbols + ["SPY"])
        .gte("bar_time", start)
        .order("bar_time", desc=False)
        .limit(len(symbols) * 500)
        .execute()
        .data
    )
    if not rows:
        return pd.DataFrame()

    frame = pd.DataFrame(rows)
    frame["bar_time"] = pd.to_datetime(frame["bar_time"]).dt.date
    wide = frame.pivot_table(index="bar_time", columns="symbol", values="close", aggfunc="last")
    wide.index = pd.to_datetime(wide.index)
    return wide


def _load_latest_fundamentals(db, symbols: list[str]) -> list[dict[str, Any]]:
    """Load the most recent fundamentals row per symbol."""
    rows = (
        db.table("fundamentals")
        .select("*")
        .in_("symbol", symbols)
        .order("fetched_at", desc=True)
        .limit(len(symbols) * 3)
        .execute()
        .data
    )
    seen: dict[str, dict] = {}
    for r in rows:
        sym = r["symbol"]
        if sym not in seen:
            seen[sym] = r
    return list(seen.values())


def _load_sectors(db, symbols: list[str]) -> dict[str, str]:
    rows = (
        db.table("assets")
        .select("symbol, sector")
        .in_("symbol", symbols)
        .execute()
        .data
    )
    return {r["symbol"]: (r["sector"] or "Unknown") for r in rows}


def _load_income_history(
    fundamentals_adapter: Any, symbols: list[str]
) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for sym in symbols:
        try:
            out[sym] = fundamentals_adapter.fetch_income_history_rows(sym)
        except Exception:
            out[sym] = []
    return out


def run_daily_score_signal(*, db=None, now: datetime | None = None) -> dict[str, Any]:
    db = db or get_client()
    now = now or datetime.now(UTC)
    run_at = now.isoformat()

    from artisan.adapters.fmp_fundamentals import FmpFundamentalsAdapter
    fundamentals_adapter = FmpFundamentalsAdapter(db=db)

    technical = TechnicalScorer(db=db)
    fundamental = FundamentalScorer(db=db)
    sentiment = SentimentScorer(db=db)
    composite = CompositeScorer(db=db)
    pipeline = SignalPipeline(db=db)

    strategy = composite.fetch_strategy(settings.strategy_id)
    symbols = load_universe(db, settings.strategy_id)

    summary: dict[str, Any] = {
        "symbols": len(symbols),
        "indicators": 0,
        "composite_scores": 0,
        "signals_created": 0,
        "signals_skipped": 0,
        "factor_scores": 0,
        "entry_signals": 0,
        "theses_created": 0,
    }

    # ── Existing 3-pillar scoring (F/T/S) ────────────────────────────────
    technical_results: dict[str, dict] = {}
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
        technical_results[symbol] = technical_result

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

    # ── New 5-factor scoring (cross-sectional) ────────────────────────────
    try:
        price_wide = _load_price_df(db, symbols)
        stock_price_df = price_wide.drop(columns=["SPY"], errors="ignore")
        spy_series = price_wide["SPY"] if "SPY" in price_wide.columns else pd.Series(dtype=float)

        fundamentals_list = _load_latest_fundamentals(db, symbols)
        sectors = _load_sectors(db, symbols)
        income_history = _load_income_history(fundamentals_adapter, symbols)

        factor_rows = score_universe(
            db=db,
            strategy_id=settings.strategy_id,
            fundamentals=fundamentals_list,
            income_history=income_history,
            price_df=stock_price_df,
            spy_series=spy_series,
            sectors=sectors,
            scored_at=run_at,
        )
        summary["factor_scores"] = len([r for r in factor_rows if r.get("hard_filter_pass")])
        logger.info("Factor scoring complete: %d rows", len(factor_rows))
    except Exception:
        logger.exception("Factor scoring failed")

    # ── Entry gate evaluation ─────────────────────────────────────────────
    try:
        account = (
            db.table("accounts")
            .select("equity")
            .eq("id", settings.__dict__.get("account_id", "00000000-0000-0000-0000-000000000002"))
            .limit(1)
            .execute()
            .data
        )
        capital = float((account[0]["equity"] if account else None) or 100_000)

        spy_df: pd.DataFrame | None = None
        if "SPY" in (price_wide.columns if not price_wide.empty else []):
            spy_df = price_wide[["SPY"]].rename(columns={"SPY": "close"}).reset_index().rename(columns={"index": "bar_time"})

        entry_rows = []
        for symbol in symbols:
            snapshot = (technical_results.get(symbol) or {}).get("_snapshot") or {}
            row = evaluate_entry(
                symbol=symbol,
                snapshot=snapshot,
                spy_df=spy_df,
                capital=capital,
                strategy_id=settings.strategy_id,
                evaluated_at=run_at,
            )
            entry_rows.append(row)

        if entry_rows:
            db.table("entry_signals").upsert(
                entry_rows, on_conflict="symbol,strategy_id,evaluated_at"
            ).execute()
            summary["entry_signals"] = len(entry_rows)
            actionable = sum(1 for r in entry_rows if r.get("actionable"))
            logger.info("Entry gates: %d evaluated, %d actionable", len(entry_rows), actionable)
    except Exception:
        logger.exception("Entry gate evaluation failed")

    # ── LLM thesis for new pending signals ────────────────────────────────
    try:
        thesis_summary = ThesisAnalyst(db=db).run(now=now)
        summary["theses_created"] = thesis_summary["theses_created"]
        summary["theses_failed"] = thesis_summary.get("theses_failed", 0)
        summary["thesis_signals_skipped"] = thesis_summary["signals_skipped"]
    except Exception:
        logger.exception("Thesis analyst failed")

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
