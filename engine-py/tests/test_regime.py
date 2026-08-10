from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from artisan.scoring.regime import classify_regime, enter_eligible_rank_cutoff


def _make_bars(closes: np.ndarray) -> pd.DataFrame:
    n = len(closes)
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {
            "bar_time": dates,
            "open": closes,
            "high": closes * 1.003,
            "low": closes * 0.997,
            "close": closes,
            "volume": 1_000_000,
        }
    )


def _risk_on_bars() -> pd.DataFrame:
    # Deterministic uptrend throughout (SMA200 slope positive, ADX trending);
    # last 60 days steepen with low noise -> low recent vol, at/near 252d highs.
    rng = np.random.default_rng(7)
    n1, n2 = 240, 60
    t1 = np.arange(n1)
    seg1 = 100 * (1 + 0.0006) ** t1 * (1 + rng.normal(0, 0.012, n1))
    t2 = np.arange(n2)
    seg2 = seg1[-1] * (1 + 0.0018) ** t2 * (1 + rng.normal(0, 0.002, n2))
    return _make_bars(np.concatenate([seg1, seg2]))


def _risk_off_bars() -> pd.DataFrame:
    # Clean downtrend -> close well below SMA200, large drawdown from the trailing high.
    rng = np.random.default_rng(3)
    n = 300
    t = np.arange(n)
    closes = 150 * (1 - 0.0012) ** t * (1 + rng.normal(0, 0.01, n))
    return _make_bars(closes)


def _neutral_bars() -> pd.DataFrame:
    # Slow sine-wave chop around a nearly-flat base: mild drift, no deep drawdown,
    # but current 20d vol sits above the trailing median -> fails risk_on, doesn't
    # trip any risk_off condition either.
    rng = np.random.default_rng(11)
    n = 300
    t = np.arange(n)
    base = 100 * (1 + 0.00015) ** t
    cycle = 1 + 0.07 * np.sin(2 * np.pi * t / 130)
    closes = base * cycle * (1 + rng.normal(0, 0.006, n))
    return _make_bars(closes)


def test_classify_regime_risk_on() -> None:
    result = classify_regime(_risk_on_bars())
    assert result["regime"] == "risk_on"
    assert result["spy_close"] > result["spy_sma50"] > result["spy_sma200"]
    assert result["spy_adx14"] > 15
    assert result["spy_vol_percentile_252d"] <= 0.5
    assert result["spy_drawdown_from_high_pct"] >= -0.05


def test_classify_regime_risk_off_downtrend() -> None:
    result = classify_regime(_risk_off_bars())
    assert result["regime"] == "risk_off"
    assert result["spy_close"] < result["spy_sma200"]


def test_classify_regime_neutral() -> None:
    result = classify_regime(_neutral_bars())
    assert result["regime"] == "neutral"
    # doesn't trip any risk_off condition
    assert result["spy_close"] >= result["spy_sma200"]
    assert result["spy_vol_percentile_252d"] <= 0.80
    assert result["spy_drawdown_from_high_pct"] >= -0.10
    # fails risk_on specifically on the vol-percentile check
    assert result["spy_vol_percentile_252d"] > 0.5


def test_classify_regime_all_fields_present_and_plausible() -> None:
    result = classify_regime(_risk_on_bars())
    for key in (
        "regime",
        "spy_close",
        "spy_sma50",
        "spy_sma200",
        "spy_adx14",
        "spy_vol_20d_annualized",
        "spy_vol_percentile_252d",
        "spy_drawdown_from_high_pct",
    ):
        assert key in result
    assert result["spy_close"] > 0
    assert 0.0 <= result["spy_vol_percentile_252d"] <= 1.0
    assert result["spy_drawdown_from_high_pct"] <= 0.0


def test_classify_regime_insufficient_history_falls_back_to_neutral() -> None:
    # Too little history for SMA200/slope -> risk_on's required fields are None,
    # so classification safely falls through to neutral rather than erroring.
    closes = 100 * (1 + 0.001) ** np.arange(30)
    result = classify_regime(_make_bars(closes))
    assert result["regime"] == "neutral"
    assert result["spy_sma200"] is None


def test_classify_regime_rejects_empty_bars() -> None:
    with pytest.raises(ValueError):
        classify_regime(pd.DataFrame(columns=["bar_time", "open", "high", "low", "close", "volume"]))


def test_classify_regime_sorts_unsorted_input() -> None:
    bars = _risk_on_bars()
    shuffled = bars.sample(frac=1.0, random_state=42).reset_index(drop=True)
    assert classify_regime(shuffled) == classify_regime(bars)


def test_enter_eligible_rank_cutoff_uses_half_up_rounding_for_neutral() -> None:
    assert enter_eligible_rank_cutoff("neutral", 50) == 3


def test_enter_eligible_rank_cutoff_uses_half_up_rounding_for_risk_on() -> None:
    assert enter_eligible_rank_cutoff("risk_on", 25) == 3
