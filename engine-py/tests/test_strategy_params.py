from __future__ import annotations

import pytest

from artisan.strategy_params import StrategyParamsError, get_strategy_params

VALID_ROW = {
    "risk_params": {
        "risk_per_trade_pct": 0.01,
        "max_position_pct": 0.10,
        "max_concurrent_positions": 15,
        "max_sector_exposure_pct": 0.25,
        "max_portfolio_heat_pct": 0.08,
        "daily_drawdown_kill_switch_pct": -0.03,
        "max_drawdown_tolerance_pct": 0.18,
    },
    "screening_params": {
        "shortlist_size": 50,
        "daily_recommendation_cap": 10,
        "factor_weights": {"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15},
    },
    "timing_params": {
        "max_holding_period_days": 30,
        "horizon_baseline_days": {"pullback": 20, "breakout": 15, "squeeze": 10},
        "regime_multipliers": {"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
        "earnings_blackout_pre_days": 3,
        "earnings_blackout_post_days": 1,
    },
    "position_mgmt_params": {
        "trailing_stop_atr_multiple": 2,
        "breakeven_trigger_r": 1,
        "auto_apply_stop_tightening": True,
    },
    "performance_goals": {
        "target_annual_return_pct": 0.25,
        "benchmark_symbol": "SPY",
        "llm_daily_cost_cap_usd": 5.0,
    },
}


class _FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _FakeQuery:
    def __init__(self, data: list[dict]) -> None:
        self._data = data

    def select(self, *_args, **_kwargs) -> "_FakeQuery":
        return self

    def eq(self, *_args, **_kwargs) -> "_FakeQuery":
        return self

    def limit(self, *_args, **_kwargs) -> "_FakeQuery":
        return self

    def execute(self) -> _FakeResponse:
        return _FakeResponse(self._data)


class _FakeClient:
    def __init__(self, row: dict | None) -> None:
        self._row = row

    def table(self, _name: str) -> _FakeQuery:
        return _FakeQuery([self._row] if self._row is not None else [])


def test_happy_path() -> None:
    params = get_strategy_params("strategy-1", db=_FakeClient(VALID_ROW))
    assert params.risk_per_trade_pct == 0.01
    assert params.factor_weights["momentum"] == 0.25
    assert params.benchmark_symbol == "SPY"
    assert params.auto_apply_stop_tightening is True


def test_missing_jsonb_key_raises_clearly() -> None:
    bad_risk = {k: v for k, v in VALID_ROW["risk_params"].items() if k != "max_position_pct"}
    bad_row = {**VALID_ROW, "risk_params": bad_risk}
    with pytest.raises(StrategyParamsError, match="max_position_pct"):
        get_strategy_params("strategy-1", db=_FakeClient(bad_row))


def test_malformed_jsonb_raises_clearly() -> None:
    bad_row = {**VALID_ROW, "screening_params": "not-a-dict"}
    with pytest.raises(StrategyParamsError, match="screening_params"):
        get_strategy_params("strategy-1", db=_FakeClient(bad_row))


def test_missing_row_raises_clearly() -> None:
    with pytest.raises(StrategyParamsError, match="No strategies row"):
        get_strategy_params("missing-id", db=_FakeClient(None))
