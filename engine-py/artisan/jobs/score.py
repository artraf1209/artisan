from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pandas as pd

from artisan.config import settings
from artisan.db.client import fetch_all_pages
from artisan.jobs.common import pipeline_job
from artisan.scorers.factor_composite import score_universe
from artisan.scorers.technical import TechnicalScorer
from artisan.scoring.regime import classify_regime
from artisan.strategy_params import StrategyParams, get_strategy_params
from artisan.timing.entry_gates import compute_performance_multiplier, evaluate_entry

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
logger = logging.getLogger(__name__)

REGIME_LOOKBACK_DAYS = 400  # >252 trading days with a buffer for weekends/holidays


def _parse_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def maybe_mark_paused_run(
    db: Any,
    *,
    run_id: str,
    strategy_id: str,
    now: datetime | None = None,
) -> str | None:
    now = now or datetime.now(UTC)
    rows = (
        db.table("strategies")
        .select("paused_until")
        .eq("id", strategy_id)
        .limit(1)
        .execute()
        .data
    )
    paused_until = _parse_timestamp(rows[0].get("paused_until")) if rows else None
    if paused_until is None or paused_until <= now:
        return None

    db.table("pipeline_runs").update(
        {"status": "paused", "completed_at": now.isoformat()}
    ).eq("id", run_id).execute()
    db.table("audit_log").insert(
        {
            "actor": "github-actions",
            "action": "score_paused",
            "entity": "pipeline_runs",
            "entity_id": run_id,
            "payload": {
                "run_id": run_id,
                "strategy_id": strategy_id,
                "paused_until": paused_until.isoformat(),
            },
        }
    ).execute()
    logger.info("score: strategy paused until %s, skipping run_id=%s", paused_until.isoformat(), run_id)
    return paused_until.isoformat()


def _end_of_day_exclusive(as_of_date: date) -> str:
    return datetime.combine(as_of_date + timedelta(days=1), datetime.min.time(), tzinfo=UTC).isoformat()


def _load_spy_bars(db: Any, *, as_of_date: date | None = None) -> pd.DataFrame:
    as_of_date = as_of_date or datetime.now(UTC).date()
    since = (as_of_date - timedelta(days=REGIME_LOOKBACK_DAYS)).isoformat()
    end_exclusive = _end_of_day_exclusive(as_of_date)
    rows = fetch_all_pages(
        lambda: db.table("price_bars")
        .select("symbol,bar_time,open,high,low,close,volume")
        .eq("symbol", "SPY")
        .gte("bar_time", since)
        .lt("bar_time", end_exclusive)
        .order("bar_time")
    )
    return pd.DataFrame(rows)


def _load_active_universe(db: Any, strategy_id: str) -> list[str]:
    rows = fetch_all_pages(
        lambda: db.table("universes")
        .select("symbol")
        .eq("strategy_id", strategy_id)
        .eq("active", True)
        .order("symbol")
    )
    return [r["symbol"] for r in rows]


def _load_price_wide_close(
    db: Any,
    symbols: list[str],
    *,
    as_of_date: date | None = None,
) -> tuple[pd.DataFrame, pd.Series]:
    as_of_date = as_of_date or datetime.now(UTC).date()
    since = (as_of_date - timedelta(days=settings.price_history_lookback_days)).isoformat()
    end_exclusive = _end_of_day_exclusive(as_of_date)
    rows = fetch_all_pages(
        lambda: db.table("price_bars")
        .select("symbol,bar_time,close")
        .in_("symbol", symbols + ["SPY"])
        .gte("bar_time", since)
        .lt("bar_time", end_exclusive)
        .order("bar_time")
    )
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(), pd.Series(dtype=float)
    df["bar_time"] = pd.to_datetime(df["bar_time"])
    wide = df.pivot_table(index="bar_time", columns="symbol", values="close").sort_index()
    spy_series = wide.pop("SPY") if "SPY" in wide.columns else pd.Series(dtype=float)
    return wide, spy_series


def _load_fundamentals(db: Any, symbols: list[str]) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    rows = fetch_all_pages(
        lambda: db.table("fundamentals").select("*").in_("symbol", symbols).order("period_end", desc=True)
    )
    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_symbol.setdefault(row["symbol"], []).append(row)
    fundamentals = [rows_[0] for rows_ in by_symbol.values() if rows_]
    income_history = {sym: rows_[1:5] for sym, rows_ in by_symbol.items()}
    return fundamentals, income_history


def _load_sectors(db: Any, symbols: list[str]) -> dict[str, str]:
    rows = fetch_all_pages(lambda: db.table("assets").select("symbol,sector").in_("symbol", symbols))
    sectors = {r["symbol"]: r["sector"] or "Unknown" for r in rows}
    for sym in symbols:
        sectors.setdefault(sym, "Unknown")
    return sectors


def _load_latest_drawdown(db: Any) -> float | None:
    rows = (
        db.table("portfolio_snapshots")
        .select("drawdown_from_high_pct")
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["drawdown_from_high_pct"] if rows else None


def run_regime_step(db: Any, run_id: str, *, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    spy_bars = _load_spy_bars(db, as_of_date=now.date())
    result = classify_regime(spy_bars)
    db.table("regime_snapshots").insert(
        {
            "run_id": run_id,
            "date": now.date().isoformat(),
            "regime": result["regime"],
            "spy_close": result["spy_close"],
            "spy_sma50": result["spy_sma50"],
            "spy_sma200": result["spy_sma200"],
            "spy_adx14": result["spy_adx14"],
            "spy_vol_20d_annualized": result["spy_vol_20d_annualized"],
            "spy_vol_percentile_252d": result["spy_vol_percentile_252d"],
            "spy_drawdown_from_high_pct": result["spy_drawdown_from_high_pct"],
        }
    ).execute()
    db.table("pipeline_runs").update({"market_regime": result["regime"]}).eq("id", run_id).execute()
    logger.info("score: regime=%s", result["regime"])
    return result["regime"]


def run_factor_scoring_step(
    db: Any,
    *,
    run_id: str,
    strategy_id: str,
    strategy_params: StrategyParams,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    symbols = _load_active_universe(db, strategy_id)
    if not symbols:
        raise RuntimeError("score: active universe is empty for configured strategy")

    price_df, spy_series = _load_price_wide_close(db, symbols, as_of_date=now.date())
    fundamentals, income_history = _load_fundamentals(db, symbols)
    sectors = _load_sectors(db, symbols)

    results = score_universe(
        db=db,
        strategy_id=strategy_id,
        strategy_params=strategy_params,
        run_id=run_id,
        fundamentals=fundamentals,
        income_history=income_history,
        price_df=price_df,
        spy_series=spy_series,
        sectors=sectors,
        scored_at=now.isoformat(),
    )
    logger.info("score: factor_scores written for %d symbols", len(results))
    return results


def run_entry_gates_step(
    db: Any,
    *,
    run_id: str,
    strategy_id: str,
    strategy_params: StrategyParams,
    regime: str,
    factor_results: list[dict[str, Any]],
    spy_df: pd.DataFrame,
    capital: float,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Only the shortlist (top shortlist_size by rank) gets gate-evaluated and
    an indicator_values snapshot -- the rest of the universe stops at factor_scores."""
    now = now or datetime.now(UTC)
    shortlist = sorted(
        (r for r in factor_results if r.get("rank") is not None),
        key=lambda r: r["rank"],
    )[: strategy_params.shortlist_size]

    drawdown = _load_latest_drawdown(db)
    performance_multiplier = compute_performance_multiplier(drawdown, strategy_params)

    technical_scorer = TechnicalScorer(db=db)
    rows: list[dict[str, Any]] = []
    for candidate in shortlist:
        symbol = candidate["symbol"]
        indicator_result = technical_scorer.score_symbol(symbol)
        snapshot = indicator_result["_snapshot"]
        snapshot.setdefault("close", indicator_result.get("close"))

        row = evaluate_entry(
            symbol=symbol,
            snapshot=snapshot,
            spy_df=spy_df,
            capital=capital,
            strategy_id=strategy_id,
            run_id=run_id,
            regime=regime,
            strategy_params=strategy_params,
            performance_multiplier=performance_multiplier,
            evaluated_at=now.isoformat(),
        )
        db.table("entry_signals").insert(row).execute()
        rows.append(row)

    logger.info(
        "score: entry_signals written for %d shortlisted symbols (%d actionable)",
        len(rows), sum(1 for r in rows if r["actionable"]),
    )
    return rows


def run_score(*, db: Any, run_id: str, strategy_id: str, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    paused_until = maybe_mark_paused_run(db, run_id=run_id, strategy_id=strategy_id, now=now)
    if paused_until is not None:
        return {"paused": True, "paused_until": paused_until, "factor_scores": 0, "entry_signals": 0}

    strategy_params = get_strategy_params(strategy_id, db=db)

    regime = run_regime_step(db, run_id, now=now)
    spy_df = _load_spy_bars(db, as_of_date=now.date())
    factor_results = run_factor_scoring_step(
        db,
        run_id=run_id,
        strategy_id=strategy_id,
        strategy_params=strategy_params,
        now=now,
    )

    equity_rows = db.table("portfolio_snapshots").select("equity").order("snapshot_date", desc=True).limit(1).execute().data
    capital = equity_rows[0]["equity"] if equity_rows else 0.0

    entry_rows = run_entry_gates_step(
        db, run_id=run_id, strategy_id=strategy_id, strategy_params=strategy_params,
        regime=regime, factor_results=factor_results, spy_df=spy_df, capital=capital, now=now,
    )

    return {"regime": regime, "factor_scores": len(factor_results), "entry_signals": len(entry_rows)}


def main() -> None:
    with pipeline_job("score") as (db, run_id):
        run_score(db=db, run_id=run_id, strategy_id=settings.strategy_id)


if __name__ == "__main__":
    main()
