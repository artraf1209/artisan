from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from artisan.db.client import get_client


class StrategyParamsError(ValueError):
    """Raised when a strategies row's jsonb config is missing or malformed."""


@dataclass(frozen=True)
class StrategyParams:
    # risk_params
    risk_per_trade_pct: float
    max_position_pct: float
    max_concurrent_positions: int
    max_sector_exposure_pct: float
    max_portfolio_heat_pct: float
    daily_drawdown_kill_switch_pct: float
    max_drawdown_tolerance_pct: float
    # screening_params
    shortlist_size: int
    daily_recommendation_cap: int
    factor_weights: dict[str, float]
    # timing_params
    max_holding_period_days: int
    horizon_baseline_days: dict[str, int]
    regime_multipliers: dict[str, float]
    earnings_blackout_pre_days: int
    earnings_blackout_post_days: int
    # position_mgmt_params
    trailing_stop_atr_multiple: float
    breakeven_trigger_r: float
    auto_apply_stop_tightening: bool
    # performance_goals
    target_annual_return_pct: float
    benchmark_symbol: str
    llm_daily_cost_cap_usd: float


# Reused by app/src/app/api/settings/update/route.ts (mirrored in TS) and
# engine-py/tests/test_strategy_params.py. Keep in sync with artisan-v2-spec.md §13.
VALIDATION_BOUNDS: dict[str, tuple[float, float]] = {
    "risk_per_trade_pct": (0.001, 0.05),
    "max_position_pct": (0.02, 0.25),
    "max_concurrent_positions": (3, 30),
    "max_sector_exposure_pct": (0.10, 0.50),
    "max_drawdown_tolerance_pct": (0.05, 0.35),
    "shortlist_size": (10, 60),
    "daily_recommendation_cap": (1, 25),
    "max_holding_period_days": (5, 60),
}
FACTOR_WEIGHTS_SUM_TOLERANCE = 0.01

_REQUIRED_KEYS: dict[str, tuple[str, ...]] = {
    "risk_params": (
        "risk_per_trade_pct",
        "max_position_pct",
        "max_concurrent_positions",
        "max_sector_exposure_pct",
        "max_portfolio_heat_pct",
        "daily_drawdown_kill_switch_pct",
        "max_drawdown_tolerance_pct",
    ),
    "screening_params": ("shortlist_size", "daily_recommendation_cap", "factor_weights"),
    "timing_params": (
        "max_holding_period_days",
        "horizon_baseline_days",
        "regime_multipliers",
        "earnings_blackout_pre_days",
        "earnings_blackout_post_days",
    ),
    "position_mgmt_params": (
        "trailing_stop_atr_multiple",
        "breakeven_trigger_r",
        "auto_apply_stop_tightening",
    ),
    "performance_goals": ("target_annual_return_pct", "benchmark_symbol", "llm_daily_cost_cap_usd"),
}


def _get_blob(row: dict[str, Any], column: str) -> dict[str, Any]:
    blob = row.get(column)
    if not isinstance(blob, dict):
        raise StrategyParamsError(f"strategies.{column} is missing or not a JSON object (got {blob!r})")
    missing = [key for key in _REQUIRED_KEYS[column] if key not in blob]
    if missing:
        raise StrategyParamsError(f"strategies.{column} is missing required key(s): {', '.join(missing)}")
    return blob


def get_strategy_params(strategy_id: str, *, db: Any = None) -> StrategyParams:
    """Reads the strategies row and flattens its 5 jsonb columns into a typed dataclass.

    Every downstream engine module calls this once per job invocation and threads
    the result through — never re-reads hardcoded values.
    """
    client = db if db is not None else get_client()
    response = (
        client.table("strategies")
        .select("risk_params, screening_params, timing_params, position_mgmt_params, performance_goals")
        .eq("id", strategy_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise StrategyParamsError(f"No strategies row found for id={strategy_id!r}")
    row = response.data[0]

    risk = _get_blob(row, "risk_params")
    screening = _get_blob(row, "screening_params")
    timing = _get_blob(row, "timing_params")
    position_mgmt = _get_blob(row, "position_mgmt_params")
    goals = _get_blob(row, "performance_goals")

    return StrategyParams(
        risk_per_trade_pct=risk["risk_per_trade_pct"],
        max_position_pct=risk["max_position_pct"],
        max_concurrent_positions=risk["max_concurrent_positions"],
        max_sector_exposure_pct=risk["max_sector_exposure_pct"],
        max_portfolio_heat_pct=risk["max_portfolio_heat_pct"],
        daily_drawdown_kill_switch_pct=risk["daily_drawdown_kill_switch_pct"],
        max_drawdown_tolerance_pct=risk["max_drawdown_tolerance_pct"],
        shortlist_size=screening["shortlist_size"],
        daily_recommendation_cap=screening["daily_recommendation_cap"],
        factor_weights=screening["factor_weights"],
        max_holding_period_days=timing["max_holding_period_days"],
        horizon_baseline_days=timing["horizon_baseline_days"],
        regime_multipliers=timing["regime_multipliers"],
        earnings_blackout_pre_days=timing["earnings_blackout_pre_days"],
        earnings_blackout_post_days=timing["earnings_blackout_post_days"],
        trailing_stop_atr_multiple=position_mgmt["trailing_stop_atr_multiple"],
        breakeven_trigger_r=position_mgmt["breakeven_trigger_r"],
        auto_apply_stop_tightening=position_mgmt["auto_apply_stop_tightening"],
        target_annual_return_pct=goals["target_annual_return_pct"],
        benchmark_symbol=goals["benchmark_symbol"],
        llm_daily_cost_cap_usd=goals["llm_daily_cost_cap_usd"],
    )
