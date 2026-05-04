from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

RISK_PER_TRADE = 0.01      # 1% of capital per trade
MAX_POSITION_PCT = 0.10    # max 10% of capital in one name
K_STOP = 2.0               # ATR multiples for stop
K_TARGET = 3.0             # ATR multiples for target
ADX_TREND_THRESHOLD = 20.0


def _market_regime_ok(spy_df: pd.DataFrame) -> bool:
    """Gate 0: SPY above SMA200 and SMA50 > SMA200."""
    if spy_df is None or len(spy_df) < 200:
        return True  # can't assess → allow
    close = spy_df["close"].astype(float)
    sma50 = close.rolling(50).mean().iloc[-1]
    sma200 = close.rolling(200).mean().iloc[-1]
    return bool(close.iloc[-1] > sma200 and sma50 > sma200)


def _trend_ok(snapshot: dict[str, Any]) -> bool:
    """Gate 1: stock in uptrend with sufficient trend strength."""
    close = snapshot.get("close")
    sma50 = snapshot.get("sma_50")
    sma200 = snapshot.get("sma_200")
    adx = snapshot.get("adx_14")

    if close is None or sma50 is None or sma200 is None:
        return False
    if close < sma200 or sma50 < sma200:
        return False
    if adx is not None and adx < ADX_TREND_THRESHOLD:
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
        bw = pd.Series([(snapshot.get("bb_upper", 0) - snapshot.get("bb_lower", 0))
                        / snapshot.get("bb_mid", 1)])
        # Use current bandwidth vs historical — simplified check
        current_bw = (bb_upper - bb_lower) / bb_mid if bb_mid else 1.0
        above_mid = close > bb_mid
        # Squeeze: bandwidth < 5% (tight consolidation)
        if current_bw < 0.05 and above_mid:
            return "squeeze"

    return None


def _confirmed(snapshot: dict[str, Any], spy_close: float | None) -> bool:
    """Gate 3: multi-signal confirmation."""
    rsi = snapshot.get("rsi_14")
    macd_hist = snapshot.get("macd_hist")
    obv_series: pd.Series | None = snapshot.get("_obv_series")
    macd_hist_series: pd.Series | None = snapshot.get("_macd_hist_series")
    vol_ratio = snapshot.get("vol_ratio")
    close = snapshot.get("close")

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
    evaluated_at: str | None = None,
) -> dict[str, Any]:
    """Run all gates and return entry_signals row dict."""
    evaluated_at = evaluated_at or datetime.now(timezone.utc).isoformat()

    gate_market = _market_regime_ok(spy_df) if spy_df is not None else None
    gate_trend = _trend_ok(snapshot)
    setup_type = _detect_setup(snapshot) if gate_trend else None
    gate_confirmed = _confirmed(snapshot, None) if setup_type else False

    entry = snapshot.get("close") or 0.0
    atr = snapshot.get("atr_14") or 0.0
    stop = entry - K_STOP * atr if atr else entry * 0.95
    target = entry + K_TARGET * atr if atr else entry * 1.10
    r_multiple = round((target - entry) / (entry - stop), 2) if (entry - stop) > 0 else None

    shares = _position_size(capital, entry, stop) if gate_confirmed and setup_type else 0
    dollar_risk = round(shares * (entry - stop), 2) if shares else None

    all_gates_pass = bool(
        gate_market is not False
        and gate_trend
        and setup_type is not None
        and gate_confirmed
        and shares > 0
    )

    return {
        "symbol": symbol,
        "strategy_id": strategy_id,
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
        "actionable": all_gates_pass,
    }
