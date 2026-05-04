from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from artisan.filters.hard_filters import passes_hard_filters
from artisan.scorers.growth_scorer import compute_growth_scores
from artisan.scorers.low_vol_scorer import compute_low_vol_scores
from artisan.scorers.momentum_scorer import compute_momentum_scores
from artisan.scorers.quality_scorer import compute_quality_scores
from artisan.scorers.value_scorer import compute_value_scores

logger = logging.getLogger(__name__)

FACTOR_WEIGHTS: dict[str, float] = {
    "value": 0.25,
    "quality": 0.25,
    "momentum": 0.25,
    "low_vol": 0.10,
    "growth": 0.15,
}


def score_universe(
    *,
    db: Any,
    strategy_id: str,
    fundamentals: list[dict[str, Any]],
    income_history: dict[str, list[dict[str, Any]]],
    price_df: pd.DataFrame,
    spy_series: pd.Series,
    sectors: dict[str, str],
    scored_at: str | None = None,
) -> list[dict[str, Any]]:
    """
    Run the full 5-factor model cross-sectionally across all symbols.
    Returns list of factor_score dicts upserted to DB.

    Only symbols passing hard_filters appear in factor_scores with hard_filter_pass=True.
    All others are stored with hard_filter_pass=False and null z-scores.
    """
    scored_at = scored_at or datetime.now(timezone.utc).isoformat()

    # ── Build DataFrames ──────────────────────────────────────────────────
    fund_df = pd.DataFrame(fundamentals).set_index("symbol") if fundamentals else pd.DataFrame()
    sectors_s = pd.Series(sectors)

    # ── Hard filter ───────────────────────────────────────────────────────
    passing: list[str] = []
    failing: dict[str, str] = {}
    for row in fundamentals:
        sym = row["symbol"]
        ok, reason = passes_hard_filters(row)
        if ok:
            passing.append(sym)
        else:
            failing[sym] = reason
            logger.debug("Hard filter fail %s: %s", sym, reason)

    logger.info("Hard filter: %d pass, %d fail", len(passing), len(failing))

    # Fetch previous run scores for delta computation
    prev_scores: dict[str, dict] = _fetch_prev_scores(db, strategy_id)
    # Previous top-N symbols (for is_new flag)
    prev_top_symbols: set[str] = {s for s, r in prev_scores.items() if r.get("rank") is not None}

    results: list[dict[str, Any]] = []

    if passing:
        pass_fund_df = fund_df.loc[fund_df.index.isin(passing)].copy()
        pass_sectors = sectors_s.loc[sectors_s.index.isin(passing)]

        # Compute factor z-scores cross-sectionally
        value_z = compute_value_scores(pass_fund_df, pass_sectors)
        quality_z = compute_quality_scores(pass_fund_df, pass_sectors)
        momentum_z = compute_momentum_scores(price_df[price_df.columns.intersection(passing)], pass_sectors)
        low_vol_z = compute_low_vol_scores(price_df[price_df.columns.intersection(passing)], spy_series, pass_sectors)
        growth_z = compute_growth_scores(pass_fund_df, {s: income_history.get(s, []) for s in passing}, pass_sectors)

        # Composite weighted score
        composite_z = (
            FACTOR_WEIGHTS["value"] * value_z.fillna(0)
            + FACTOR_WEIGHTS["quality"] * quality_z.fillna(0)
            + FACTOR_WEIGHTS["momentum"] * momentum_z.fillna(0)
            + FACTOR_WEIGHTS["low_vol"] * low_vol_z.fillna(0)
            + FACTOR_WEIGHTS["growth"] * growth_z.fillna(0)
        )

        # Rank (1 = best)
        ranks = composite_z.rank(ascending=False, method="min").astype("Int64")

        for sym in passing:
            prev = prev_scores.get(sym, {})
            row = {
                "symbol": sym,
                "strategy_id": strategy_id,
                "scored_at": scored_at,
                "hard_filter_pass": True,
                "sector": sectors.get(sym),
                "value_z": _safe(value_z.get(sym)),
                "quality_z": _safe(quality_z.get(sym)),
                "momentum_z": _safe(momentum_z.get(sym)),
                "low_vol_z": _safe(low_vol_z.get(sym)),
                "growth_z": _safe(growth_z.get(sym)),
                "composite_z": _safe(composite_z.get(sym)),
                "rank": int(ranks.get(sym)) if sym in ranks.index else None,
                "is_new": sym not in prev_top_symbols,
                "value_prev": prev.get("value_z"),
                "quality_prev": prev.get("quality_z"),
                "momentum_prev": prev.get("momentum_z"),
                "low_vol_prev": prev.get("low_vol_z"),
                "growth_prev": prev.get("growth_z"),
            }
            results.append(row)

    # Failing symbols — store with null scores
    for sym, reason in failing.items():
        results.append({
            "symbol": sym,
            "strategy_id": strategy_id,
            "scored_at": scored_at,
            "hard_filter_pass": False,
            "sector": sectors.get(sym),
            "value_z": None, "quality_z": None, "momentum_z": None,
            "low_vol_z": None, "growth_z": None, "composite_z": None,
            "rank": None, "is_new": False,
            "value_prev": None, "quality_prev": None, "momentum_prev": None,
            "low_vol_prev": None, "growth_prev": None,
        })

    if results:
        db.table("factor_scores").upsert(
            results, on_conflict="symbol,strategy_id,scored_at"
        ).execute()
        logger.info("Upserted %d factor_score rows (%d passing hard filter)", len(results), len(passing))

    return results


def _safe(v: Any) -> float | None:
    if v is None:
        return None
    import math
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


def _fetch_prev_scores(db: Any, strategy_id: str) -> dict[str, dict]:
    """Fetch the most recent factor_scores row per symbol for delta computation."""
    try:
        rows = (
            db.table("factor_scores")
            .select("symbol, value_z, quality_z, momentum_z, low_vol_z, growth_z, rank")
            .eq("strategy_id", strategy_id)
            .order("scored_at", desc=True)
            .limit(200)
            .execute()
            .data
        )
        seen: dict[str, dict] = {}
        for r in rows:
            sym = r["symbol"]
            if sym not in seen:
                seen[sym] = r
        return seen
    except Exception:
        return {}
