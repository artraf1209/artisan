from __future__ import annotations

import pandas as pd

from artisan.timing.entry_gates import evaluate_entry


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
        evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row["gate_trend"] is False
    assert row["actionable"] is False


def test_evaluate_entry_requires_relative_strength_vs_spy() -> None:
    stock = [100.0 + (idx * 0.25) for idx in range(260)]
    spy = [100.0 + (idx * 0.45) for idx in range(260)]

    row = evaluate_entry(
        symbol="AAPL",
        snapshot=_snapshot(stock),
        spy_df=_spy_df(spy),
        capital=100_000,
        strategy_id="strategy-1",
        evaluated_at="2026-05-04T13:30:00+00:00",
    )

    assert row["gate_trend"] is True
    assert row["setup_type"] is not None
    assert row["gate_confirmed"] is False
    assert row["actionable"] is False
