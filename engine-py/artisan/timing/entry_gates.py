from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from artisan.strategy_params import StrategyParams

logger = logging.getLogger(__name__)

RISK_PER_TRADE = 0.01      # 1% of capital per trade
MAX_POSITION_PCT = 0.10    # max 10% of capital in one name
K_STOP = 2.0               # ATR multiples for stop
K_TARGET = 3.0             # ATR multiples for target
ADX_TREND_THRESHOLD = 20.0

# performance_multiplier drops to this once drawdown reaches half of max_drawdown_tolerance_pct
PERFORMANCE_MULTIPLIER_DROP = 0.8


def _market_regime_ok(regime: str | None) -> bool | None:
    """Gate 0 (informational): reads the once-per-run regime from regime_snapshots
    (v2-04's classify_regime(), computed earlier in the same pipeline run) instead
    of doing its own live SPY check. risk_off does NOT hard-block this gate or
    `actionable` by itself — it only narrows ENTER-eligibility later in Synthesis
    (v2-11) via the regime-based rank thresholds.
    """
    if regime is None:
        return None
    return regime != "risk_off"


def compute_performance_multiplier(
    drawdown_from_high_pct: float | None, strategy_params: StrategyParams
) -> float:
    """1.0 by default; drops to 0.8 once portfolio drawdown (from the latest
    portfolio_snapshots row, written in v2-03) reaches or exceeds half of
    max_drawdown_tolerance_pct. Computed once per run (in score.py, v2-14) and
    passed into every compute_effective_horizon() call for that run.
    """
    if drawdown_from_high_pct is None:
        return 1.0
    threshold = -abs(strategy_params.max_drawdown_tolerance_pct) / 2
    return PERFORMANCE_MULTIPLIER_DROP if drawdown_from_high_pct <= threshold else 1.0


def compute_effective_horizon(
    setup_type: str,
    regime: str,
    performance_multiplier: float,
    strategy_params: StrategyParams,
) -> int:
    """Spec §5.2: how many days a position of this setup_type is expected to be
    held, scaled down in choppier regimes or after portfolio drawdown, capped by
    max_holding_period_days."""
    baseline = strategy_params.horizon_baseline_days[setup_type]
    regime_mult = strategy_params.regime_multipliers[regime]
    perf_mult = min(1.0, performance_multiplier)  # never inflates the horizon above baseline
    return min(int(baseline * regime_mult * perf_mult), strategy_params.max_holding_period_days)


def _trend_ok(snapshot: dict[str, Any]) -> bool:
    """Gate 1: stock in uptrend with sufficient trend strength."""
    close = snapshot.get("close")
    sma50 = snapshot.get("sma_50")
    sma200 = snapshot.get("sma_200")
    adx = snapshot.get("adx_14")
    close_series: pd.Series | None = snapshot.get("_close_series")

    if close is None or sma50 is None or sma200 is None:
        return False
    if close < sma200 or sma50 < sma200:
        return False
    if adx is not None and adx < ADX_TREND_THRESHOLD:
        return False
    if close_series is None or len(close_series) < 220:
        return False

    sma200_series = close_series.rolling(200).mean().dropna()
    if len(sma200_series) < 20:
        return False
    slope = sma200_series.iloc[-1] - sma200_series.iloc[-20]
    if slope <= 0:
        return False
    return True


def _detect_setup(snapshot: dict[str, Any]) -> str | None:
    """Gate 2: detect pullback, breakout, or squeeze setup."""
    close_series: pd.Series | None = snapshot.get("_close_series")
    high_series: pd.Series | None = snapshot.get("_high_series")
    low_series: pd.Series | None = snapshot.get("_low_series")
    volume_series: pd.Series | None = snapshot.get("_volume_series")

    if close_series is None or len(close_series) < 50:
        return None

    close = close_series.iloc[-1]
    sma20 = close_series.rolling(20).mean().iloc[-1]
    sma50 = close_series.rolling(50).mean().iloc[-1] if len(close_series) >= 50 else None
    rsi = snapshot.get("rsi_14")
    vol_ratio = snapshot.get("vol_ratio")

    # ── Pullback setup ────────────────────────────────────────────────────
    if rsi is not None and 30 <= rsi <= 50:
        low_5d = low_series.iloc[-5:].min() if low_series is not None else None
        if low_5d is not None:
            touched_20 = low_5d <= sma20 * 1.02 if sma20 else False
            touched_50 = (low_5d <= sma50 * 1.02 if sma50 else False)
            turning_up = len(close_series) >= 2 and close > close_series.iloc[-2]
            if (touched_20 or touched_50) and turning_up:
                return "pullback"

    # ── Breakout setup ────────────────────────────────────────────────────
    if high_series is not None and len(high_series) >= 21:
        high_20 = high_series.iloc[-21:-1].max()
        range_pct = (
            (high_series.iloc[-21:-1].max() - low_series.iloc[-21:-1].min()) / close
            if low_series is not None else 1.0
        )
        if close > high_20 and range_pct < 0.15 and vol_ratio is not None and vol_ratio > 1.5:
            return "breakout"

    # ── Squeeze setup ─────────────────────────────────────────────────────
    bb_mid = snapshot.get("bb_mid")
    bb_upper = snapshot.get("bb_upper")
    bb_lower = snapshot.get("bb_lower")
    if bb_mid and bb_upper and bb_lower and len(close_series) >= 120:
        # Use current bandwidth vs historical — simplified check
        current_bw = (bb_upper - bb_lower) / bb_mid if bb_mid else 1.0
        above_mid = close > bb_mid
        # Squeeze: bandwidth < 5% (tight consolidation)
        if current_bw < 0.05 and above_mid:
            return "squeeze"

    return None


def _confirmed(snapshot: dict[str, Any], spy_df: pd.DataFrame | None) -> bool:
    """Gate 3: multi-signal confirmation."""
    rsi = snapshot.get("rsi_14")
    macd_hist = snapshot.get("macd_hist")
    obv_series: pd.Series | None = snapshot.get("_obv_series")
    macd_hist_series: pd.Series | None = snapshot.get("_macd_hist_series")
    close_series: pd.Series | None = snapshot.get("_close_series")
    vol_ratio = snapshot.get("vol_ratio")

    # RSI not overbought
    if rsi is None or rsi >= 70:
        return False

    # MACD histogram positive and rising
    if macd_hist is None or macd_hist <= 0:
        return False
    if macd_hist_series is not None and len(macd_hist_series) >= 2:
        if macd_hist <= macd_hist_series.iloc[-2]:
            return False

    # Volume confirmation
    if vol_ratio is None or vol_ratio < 1.2:
        return False

    # OBV rising over last month
    if obv_series is not None and len(obv_series) >= 21:
        if obv_series.iloc[-1] <= obv_series.iloc[-21]:
            return False

    # Relative strength vs SPY over the last quarter.
    if close_series is None or len(close_series) < 64 or spy_df is None or len(spy_df) < 64:
        return False
    spy_close = spy_df["close"].astype(float)
    stock_return = (close_series.iloc[-1] / close_series.iloc[-64]) - 1
    spy_return = (spy_close.iloc[-1] / spy_close.iloc[-64]) - 1
    if stock_return <= spy_return:
        return False

    return True


def _position_size(capital: float, entry: float, stop: float) -> int:
    if entry <= stop or entry <= 0:
        return 0
    risk_amount = capital * RISK_PER_TRADE
    stop_distance = entry - stop
    shares_by_risk = risk_amount / stop_distance
    shares_by_capital = (capital * MAX_POSITION_PCT) / entry
    return max(0, int(min(shares_by_risk, shares_by_capital)))


def evaluate_entry(
    symbol: str,
    snapshot: dict[str, Any],
    spy_df: pd.DataFrame | None,
    capital: float,
    strategy_id: str,
    run_id: str,
    regime: str | None,
    strategy_params: StrategyParams,
    performance_multiplier: float = 1.0,
    evaluated_at: str | None = None,
) -> dict[str, Any]:
    """Run all gates and return an entry_signals row dict.

    regime is read from this run's regime_snapshots row (v2-04's classify_regime(),
    computed once at the start of the pipeline run) — Gate 0 no longer does its own
    live SPY check. spy_df is still used for Gate 3's relative-strength-vs-SPY check.
    """
    evaluated_at = evaluated_at or datetime.now(timezone.utc).isoformat()

    gate_market = _market_regime_ok(regime)
    gate_trend = _trend_ok(snapshot)
    setup_type = _detect_setup(snapshot) if gate_trend else None
    gate_confirmed = _confirmed(snapshot, spy_df) if setup_type else False

    entry = snapshot.get("close") or 0.0
    atr = snapshot.get("atr_14") or 0.0
    stop = entry - K_STOP * atr if atr else entry * 0.95
    target = entry + K_TARGET * atr if atr else entry * 1.10
    r_multiple = round((target - entry) / (entry - stop), 2) if (entry - stop) > 0 else None

    shares = _position_size(capital, entry, stop) if gate_confirmed and setup_type else 0
    dollar_risk = round(shares * (entry - stop), 2) if shares else None

    # risk_off doesn't hard-block here (Synthesis enforces the regime-based rank
    # thresholds) — gate_market is stored for display only, not required to pass.
    all_gates_pass = bool(
        gate_trend
        and setup_type is not None
        and gate_confirmed
        and shares > 0
    )

    effective_horizon_days = (
        compute_effective_horizon(setup_type, regime, performance_multiplier, strategy_params)
        if setup_type is not None and regime is not None
        else None
    )

    return {
        "symbol": symbol,
        "strategy_id": strategy_id,
        "run_id": run_id,
        "evaluated_at": evaluated_at,
        "gate_market": gate_market,
        "gate_trend": gate_trend,
        "setup_type": setup_type,
        "gate_confirmed": gate_confirmed,
        "entry_price": round(entry, 4) if entry else None,
        "stop_price": round(stop, 4) if stop else None,
        "target_price": round(target, 4) if target else None,
        "atr": round(atr, 4) if atr else None,
        "r_multiple": r_multiple,
        "shares": shares if shares else None,
        "dollar_risk": dollar_risk,
        "effective_horizon_days": effective_horizon_days,
        "actionable": all_gates_pass,
    }
