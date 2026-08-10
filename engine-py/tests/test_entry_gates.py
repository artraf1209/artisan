from __future__ import annotations

import itertools

import pandas as pd
import pytest

from artisan.strategy_params import StrategyParams
from artisan.timing.entry_gates import (
    compute_effective_horizon,
    compute_performance_multiplier,
    evaluate_entry,
)

TEST_STRATEGY_PARAMS = StrategyParams(
    risk_per_trade_pct=0.01,
    max_position_pct=0.10,
    max_concurrent_positions=15,
    max_sector_exposure_pct=0.25,
    max_portfolio_heat_pct=0.08,
    daily_drawdown_kill_switch_pct=-0.03,
    max_drawdown_tolerance_pct=0.18,
    shortlist_size=30,
    daily_recommendation_cap=10,
    factor_weights={"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15},
    max_holding_period_days=30,
    horizon_baseline_days={"pullback": 20, "breakout": 15, "squeeze": 10},
    regime_multipliers={"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
    earnings_blackout_pre_days=3,
    earnings_blackout_post_days=1,
    trailing_stop_atr_multiple=2,
    breakeven_trigger_r=1,
    auto_apply_stop_tightening=True,
    target_annual_return_pct=0.25,
    benchmark_symbol="SPY",
    llm_daily_cost_cap_usd=5.0,
)


def _snapshot(close_values: list[float]) -> dict:
    close_series = pd.Series(close_values, dtype=float)
    return {
        "close": float(close_series.iloc[-1]),
        "sma_50": float(close_series.rolling(50).mean().iloc[-1]),
        "sma_200": float(close_series.rolling(200).mean().iloc[-1]),
        "adx_14": 25.0,
        "rsi_14": 45.0,
        "macd_hist": 0.5,
        "vol_ratio": 1.6,
        "atr_14": 2.0,
        "bb_upper": float(close_series.iloc[-1] * 1.03),
        "bb_mid": float(close_series.iloc[-1]),
        "bb_lower": float(close_series.iloc[-1] * 0.97),
        "_close_series": close_series,
        "_high_series": close_series + 1,
        "_low_series": close_series - 1,
        "_obv_series": pd.Series([1000 + idx for idx in range(len(close_values))], dtype=float),
        "_macd_hist_series": pd.Series([0.1 + (idx / 1000) for idx in range(len(close_values))], dtype=float),
    }


def _spy_df(close_values: list[float]) -> pd.DataFrame:
    return pd.DataFrame({"close": close_values}, dtype=float)


def test_evaluate_entry_requires_positive_sma200_slope() -> None:
    downtrend = [200.0 - (idx * 0.4) for idx in range(220)]
    snapshot = _snapshot(downtrend)
    snapshot["close"] = 130.0
    snapshot["sma_50"] = 125.0
    snapshot["sma_200"] = 120.0

    row = evaluate_entry(
        symbol="AAPL",
        snapshot=snapshot,
        spy_df=_spy_df([90.0 + (idx * 0.2) for idx in range(220)]),
        capital=100_000,
        strategy_id="strategy-1",
        run_id="run-1",
        regime="risk_on",
        strategy_params=TEST_STRATEGY_PARAMS,
        evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row["gate_trend"] is False
    assert row["actionable"] is False
    assert row["run_id"] == "run-1"
    assert row["effective_horizon_days"] is None  # no setup_type detected


def test_evaluate_entry_requires_relative_strength_vs_spy() -> None:
    stock = [100.0 + (idx * 0.25) for idx in range(260)]
    spy = [100.0 + (idx * 0.45) for idx in range(260)]

    row = evaluate_entry(
        symbol="AAPL",
        snapshot=_snapshot(stock),
        spy_df=_spy_df(spy),
        capital=100_000,
        strategy_id="strategy-1",
        run_id="run-1",
        regime="risk_on",
        strategy_params=TEST_STRATEGY_PARAMS,
        evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row["gate_trend"] is True
    assert row["setup_type"] is not None
    assert row["gate_confirmed"] is False
    assert row["actionable"] is False


def test_evaluate_entry_risk_off_regime_does_not_hard_block_actionable() -> None:
    """Gate 0 is informational only: risk_off narrows what's ENTER-eligible later
    in Synthesis (via rank thresholds), it doesn't block actionable here."""
    stock = [100.0 + (idx * 0.25) for idx in range(260)]
    spy = [100.0 + (idx * 0.1) for idx in range(260)]  # stock outperforms SPY -> gate_confirmed True

    row_risk_on = evaluate_entry(
        symbol="AAPL", snapshot=_snapshot(stock), spy_df=_spy_df(spy), capital=100_000,
        strategy_id="strategy-1", run_id="run-1", regime="risk_on",
        strategy_params=TEST_STRATEGY_PARAMS, evaluated_at="2026-05-04T13:30:00+00:00",
    )
    row_risk_off = evaluate_entry(
        symbol="AAPL", snapshot=_snapshot(stock), spy_df=_spy_df(spy), capital=100_000,
        strategy_id="strategy-1", run_id="run-1", regime="risk_off",
        strategy_params=TEST_STRATEGY_PARAMS, evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row_risk_on["gate_market"] is True
    assert row_risk_off["gate_market"] is False
    # actionable (and effective_horizon_days) depend only on the trend/setup/confirmation
    # gates + sizing, not on gate_market
    assert row_risk_on["actionable"] == row_risk_off["actionable"]
    if row_risk_on["actionable"]:
        assert row_risk_off["effective_horizon_days"] is not None


def test_evaluate_entry_populates_effective_horizon_when_setup_detected() -> None:
    stock = [100.0 + (idx * 0.25) for idx in range(260)]
    spy = [100.0 + (idx * 0.1) for idx in range(260)]

    row = evaluate_entry(
        symbol="AAPL", snapshot=_snapshot(stock), spy_df=_spy_df(spy), capital=100_000,
        strategy_id="strategy-1", run_id="run-1", regime="neutral",
        strategy_params=TEST_STRATEGY_PARAMS, performance_multiplier=1.0,
        evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row["setup_type"] is not None
    expected = compute_effective_horizon(row["setup_type"], "neutral", 1.0, TEST_STRATEGY_PARAMS)
    assert row["effective_horizon_days"] == expected


class TestComputePerformanceMultiplier:
    def test_no_drawdown_data_defaults_to_full_multiplier(self) -> None:
        assert compute_performance_multiplier(None, TEST_STRATEGY_PARAMS) == 1.0

    def test_mild_drawdown_stays_at_full_multiplier(self) -> None:
        # tolerance is 18% -> half is 9%; 5% drawdown shouldn't trip it
        assert compute_performance_multiplier(-0.05, TEST_STRATEGY_PARAMS) == 1.0

    def test_drawdown_at_half_tolerance_drops_multiplier(self) -> None:
        assert compute_performance_multiplier(-0.09, TEST_STRATEGY_PARAMS) == 0.8

    def test_drawdown_past_half_tolerance_drops_multiplier(self) -> None:
        assert compute_performance_multiplier(-0.15, TEST_STRATEGY_PARAMS) == 0.8


SETUP_TYPES = ["pullback", "breakout", "squeeze"]
REGIMES = ["risk_on", "neutral", "risk_off"]
PERFORMANCE_MULTIPLIERS = [1.0, 0.8]

EXPECTED_BASELINES = {"pullback": 20, "breakout": 15, "squeeze": 10}
EXPECTED_REGIME_MULT = {"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65}


@pytest.mark.parametrize(
    "setup_type,regime,performance_multiplier",
    list(itertools.product(SETUP_TYPES, REGIMES, PERFORMANCE_MULTIPLIERS)),
)
def test_compute_effective_horizon_matrix(setup_type: str, regime: str, performance_multiplier: float) -> None:
    result = compute_effective_horizon(setup_type, regime, performance_multiplier, TEST_STRATEGY_PARAMS)

    expected_raw = int(
        EXPECTED_BASELINES[setup_type] * EXPECTED_REGIME_MULT[regime] * performance_multiplier
    )
    expected = min(expected_raw, TEST_STRATEGY_PARAMS.max_holding_period_days)

    assert result == expected
    assert result <= TEST_STRATEGY_PARAMS.max_holding_period_days


def test_compute_effective_horizon_pullback_risk_on_uncapped() -> None:
    assert compute_effective_horizon("pullback", "risk_on", 1.0, TEST_STRATEGY_PARAMS) == 20


def test_compute_effective_horizon_never_inflates_above_baseline_via_performance_multiplier() -> None:
    # performance_multiplier is clamped to <= 1.0 even if a caller passes something higher
    inflated = compute_effective_horizon("pullback", "risk_on", 1.5, TEST_STRATEGY_PARAMS)
    normal = compute_effective_horizon("pullback", "risk_on", 1.0, TEST_STRATEGY_PARAMS)
    assert inflated == normal == 20
