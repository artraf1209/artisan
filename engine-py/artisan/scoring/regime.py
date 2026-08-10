from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np
import pandas as pd
import pandas_ta as ta

logger = logging.getLogger(__name__)

VOL_WINDOW_DAYS = 20
TRAILING_WINDOW_DAYS = 252
SMA200_SLOPE_WINDOW_DAYS = 20
TRADING_DAYS_PER_YEAR = 252

RISK_ON_ADX_MIN = 15.0
RISK_ON_VOL_PERCENTILE_MAX = 0.50  # "below the trailing 252d median"
RISK_ON_DRAWDOWN_MAX_PCT = 0.05  # "within 5% of the trailing 252d high"

RISK_OFF_VOL_PERCENTILE_MIN = 0.80  # "above the trailing 252d 80th percentile"
RISK_OFF_DRAWDOWN_MIN_PCT = 0.10  # "more than 10% below the trailing 252d high"

# ENTER-eligibility rank thresholds per regime (spec §5.1 + §9.2). Not consumed
# here — this is the shared home for the constant so both Synthesis (v2-11) and
# any future UI (e.g. /strategy, v2-21) apply the identical cutoff.
RISK_OFF_ENTER_ELIGIBLE_COUNT = 3


def _round_half_up(value: float) -> int:
    """Match the frontend's 2.5 -> 3 behavior instead of Python's bankers'
    rounding (where round(2.5) == 2). Inputs here are non-negative."""
    return math.floor(value + 0.5)


def enter_eligible_rank_cutoff(regime: str, shortlist_size: int) -> int:
    """The maximum factor_scores.rank still ENTER-eligible for this regime:
    top decile in risk_on, top 5% in neutral, a fixed top 2-3 names in risk_off
    (clean setups only, enforced by the actionable/veto checks around this)."""
    if regime == "risk_on":
        return max(1, _round_half_up(shortlist_size * 0.10))
    if regime == "risk_off":
        return RISK_OFF_ENTER_ELIGIBLE_COUNT
    # neutral, and any unrecognized regime value: the more conservative default
    return max(1, _round_half_up(shortlist_size * 0.05))


def classify_regime(spy_bars: pd.DataFrame) -> dict[str, Any]:
    """Classify the market regime (risk_on/neutral/risk_off) from SPY daily bars.

    Called once per pipeline run (from artisan/jobs/score.py); every other job
    reads the result back from regime_snapshots by run_id rather than calling
    this again.

    spy_bars: price_bars rows for SPY (symbol/bar_time/open/high/low/close/volume),
    any order — sorted internally by bar_time. Needs ~252+ trading days for the
    trailing-window indicators to be meaningful; with less history those come
    back as None and the classification falls through to "neutral".
    """
    if spy_bars is None or spy_bars.empty:
        raise ValueError("classify_regime requires non-empty SPY bars")

    bars = spy_bars.sort_values("bar_time").reset_index(drop=True)
    close = bars["close"].astype(float)
    high = bars["high"].astype(float)
    low = bars["low"].astype(float)

    spy_close = float(close.iloc[-1])

    spy_sma50 = _last_or_none(ta.sma(close, length=50))
    sma200_series = ta.sma(close, length=200)
    spy_sma200 = _last_or_none(sma200_series)

    adx_df = ta.adx(high, low, close, length=14)
    spy_adx14 = _last_or_none(adx_df["ADX_14"]) if adx_df is not None else None

    daily_returns = close.pct_change()
    vol_series = daily_returns.rolling(VOL_WINDOW_DAYS).std() * np.sqrt(TRADING_DAYS_PER_YEAR)
    spy_vol_20d_annualized = _last_or_none(vol_series)

    trailing_vol = vol_series.dropna().tail(TRAILING_WINDOW_DAYS)
    spy_vol_percentile_252d = (
        float((trailing_vol <= spy_vol_20d_annualized).mean())
        if spy_vol_20d_annualized is not None and len(trailing_vol) > 0
        else None
    )

    trailing_high = float(close.tail(TRAILING_WINDOW_DAYS).max())
    spy_drawdown_from_high_pct = (spy_close - trailing_high) / trailing_high if trailing_high else 0.0

    sma200_slope_positive = _sma200_slope_positive(sma200_series)

    regime = _classify(
        spy_close=spy_close,
        spy_sma50=spy_sma50,
        spy_sma200=spy_sma200,
        sma200_slope_positive=sma200_slope_positive,
        spy_adx14=spy_adx14,
        spy_vol_percentile_252d=spy_vol_percentile_252d,
        spy_drawdown_from_high_pct=spy_drawdown_from_high_pct,
    )

    return {
        "regime": regime,
        "spy_close": spy_close,
        "spy_sma50": spy_sma50,
        "spy_sma200": spy_sma200,
        "spy_adx14": spy_adx14,
        "spy_vol_20d_annualized": spy_vol_20d_annualized,
        "spy_vol_percentile_252d": spy_vol_percentile_252d,
        "spy_drawdown_from_high_pct": spy_drawdown_from_high_pct,
    }


def _last_or_none(series: pd.Series | None) -> float | None:
    if series is None or len(series) == 0:
        return None
    value = series.iloc[-1]
    return float(value) if pd.notna(value) else None


def _sma200_slope_positive(sma200_series: pd.Series | None) -> bool | None:
    if sma200_series is None:
        return None
    valid = sma200_series.dropna()
    if len(valid) < SMA200_SLOPE_WINDOW_DAYS + 1:
        return None
    slope = valid.iloc[-1] - valid.iloc[-(SMA200_SLOPE_WINDOW_DAYS + 1)]
    return bool(slope > 0)


def _classify(
    *,
    spy_close: float,
    spy_sma50: float | None,
    spy_sma200: float | None,
    sma200_slope_positive: bool | None,
    spy_adx14: float | None,
    spy_vol_percentile_252d: float | None,
    spy_drawdown_from_high_pct: float,
) -> str:
    # risk_off: any single condition trips it, independent of the risk_on checks
    if spy_sma200 is not None and spy_close < spy_sma200:
        return "risk_off"
    if spy_vol_percentile_252d is not None and spy_vol_percentile_252d > RISK_OFF_VOL_PERCENTILE_MIN:
        return "risk_off"
    if spy_drawdown_from_high_pct < -RISK_OFF_DRAWDOWN_MIN_PCT:
        return "risk_off"

    # risk_on: every condition must hold simultaneously
    if (
        spy_sma50 is not None
        and spy_sma200 is not None
        and spy_close > spy_sma50 > spy_sma200
        and sma200_slope_positive is True
        and spy_adx14 is not None
        and spy_adx14 > RISK_ON_ADX_MIN
        and spy_vol_percentile_252d is not None
        and spy_vol_percentile_252d <= RISK_ON_VOL_PERCENTILE_MAX
        and spy_drawdown_from_high_pct >= -RISK_ON_DRAWDOWN_MAX_PCT
    ):
        return "risk_on"

    return "neutral"
