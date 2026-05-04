from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


class TechnicalScorer:
    def __init__(self, db=None) -> None:
        self.db = db or get_client()

    def fetch_price_history(self, symbol: str, limit: int = 260) -> list[dict[str, Any]]:
        response = (
            self.db.table("price_bars")
            .select("symbol, bar_time, open, high, low, close, volume, vwap")
            .eq("symbol", symbol)
            .order("bar_time", desc=False)
            .limit(limit)
            .execute()
        )
        return response.data

    @staticmethod
    def compute_indicator_snapshot(price_rows: list[dict[str, Any]]) -> dict[str, float | None]:
        if len(price_rows) < 30:
            close = float(price_rows[-1]["close"]) if price_rows else None
            return {
                "rsi_14": None,
                "macd_line": None,
                "macd_signal": None,
                "macd_hist": None,
                "bb_upper": None,
                "bb_mid": None,
                "bb_lower": None,
                "atr_14": None,
                "sma_50": None,
                "sma_200": None,
                "adx_14": None,
                "obv": None,
                "vol_ratio": None,
                "close": close,
            }

        frame = pd.DataFrame(price_rows).sort_values("bar_time")
        close = frame["close"].astype(float)
        high = frame["high"].astype(float)
        low = frame["low"].astype(float)

        delta = close.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(window=14, min_periods=14).mean()
        avg_loss = loss.rolling(window=14, min_periods=14).mean()
        avg_loss_safe = avg_loss.replace(0, 1e-10)
        rs = avg_gain / avg_loss_safe
        rsi = 100 - (100 / (1 + rs))

        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd_line = ema12 - ema26
        macd_signal = macd_line.ewm(span=9, adjust=False).mean()
        macd_hist = macd_line - macd_signal

        bb_mid = close.rolling(window=20, min_periods=20).mean()
        bb_std = close.rolling(window=20, min_periods=20).std()
        bb_upper = bb_mid + (2 * bb_std)
        bb_lower = bb_mid - (2 * bb_std)

        previous_close = close.shift(1)
        true_range = pd.concat(
            [
                high - low,
                (high - previous_close).abs(),
                (low - previous_close).abs(),
            ],
            axis=1,
        ).max(axis=1)
        atr_14 = true_range.rolling(window=14, min_periods=14).mean()

        # ── ADX-14 ──────────────────────────────────────────────────────────
        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
        minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
        tr14 = true_range.ewm(alpha=1 / 14, adjust=False).mean()
        plus_di = 100 * plus_dm.ewm(alpha=1 / 14, adjust=False).mean() / tr14.replace(0, float("nan"))
        minus_di = 100 * minus_dm.ewm(alpha=1 / 14, adjust=False).mean() / tr14.replace(0, float("nan"))
        di_sum = (plus_di + minus_di).replace(0, float("nan"))
        dx = 100 * (plus_di - minus_di).abs() / di_sum
        adx_14 = dx.ewm(alpha=1 / 14, adjust=False).mean()

        # ── OBV ─────────────────────────────────────────────────────────────
        volume = frame["volume"].astype(float)
        direction = close.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
        obv = (direction * volume).cumsum()

        # ── Volume ratio ─────────────────────────────────────────────────────
        vol_sma50 = volume.rolling(window=50, min_periods=10).mean()
        vol_ratio = volume / vol_sma50.replace(0, float("nan"))

        snapshot = {
            "rsi_14": _to_float(rsi.iloc[-1]),
            "macd_line": _to_float(macd_line.iloc[-1]),
            "macd_signal": _to_float(macd_signal.iloc[-1]),
            "macd_hist": _to_float(macd_hist.iloc[-1]),
            "bb_upper": _to_float(bb_upper.iloc[-1]),
            "bb_mid": _to_float(bb_mid.iloc[-1]),
            "bb_lower": _to_float(bb_lower.iloc[-1]),
            "atr_14": _to_float(atr_14.iloc[-1]),
            "sma_50": _to_float(close.rolling(window=50, min_periods=50).mean().iloc[-1]),
            "sma_200": _to_float(close.rolling(window=200, min_periods=200).mean().iloc[-1]),
            "close": _to_float(close.iloc[-1]),
            "adx_14": _to_float(adx_14.iloc[-1]),
            "obv": _to_float(obv.iloc[-1]),
            "vol_ratio": _to_float(vol_ratio.iloc[-1]),
            # keep series for entry gate logic
            "_close_series": close,
            "_high_series": high,
            "_low_series": low,
            "_volume_series": volume,
            "_obv_series": obv,
            "_macd_hist_series": macd_hist,
        }
        return snapshot

    @staticmethod
    def score_indicators(snapshot: dict[str, float | None]) -> float:
        close = snapshot.get("close")
        if close is None:
            return 0.0

        rsi = snapshot.get("rsi_14")
        if rsi is None:
            return 0.5

        rsi_score = _clamp(1 - (abs(rsi - 50) / 50))

        macd_line = snapshot.get("macd_line") or 0.0
        macd_signal = snapshot.get("macd_signal") or 0.0
        macd_hist = snapshot.get("macd_hist") or 0.0
        macd_score = 1.0 if macd_line > macd_signal and macd_hist > 0 else 0.35

        sma_50 = snapshot.get("sma_50")
        sma_200 = snapshot.get("sma_200")
        trend_components = [
            1.0 if sma_50 and close > sma_50 else 0.0,
            1.0 if sma_200 and close > sma_200 else 0.0,
        ]
        trend_score = sum(trend_components) / len(trend_components)

        atr = snapshot.get("atr_14") or 0.0
        atr_pct = (atr / close) if close else 0.0
        if 0.01 <= atr_pct <= 0.05:
            volatility_score = 0.6
        elif atr_pct == 0:
            volatility_score = 0.5
        else:
            volatility_score = 0.4

        score = (rsi_score * 0.35) + (macd_score * 0.30) + (trend_score * 0.25) + (volatility_score * 0.10)
        return round(_clamp(score), 4)

    def save_indicator_values(self, row: dict[str, Any]) -> dict[str, Any]:
        response = self.db.table("indicator_values").upsert(row, on_conflict="symbol,computed_at").execute()
        return response.data[0] if response.data else row

    def score_symbol(self, symbol: str, computed_at: str | None = None) -> dict[str, Any]:
        price_rows = self.fetch_price_history(symbol)
        snapshot = self.compute_indicator_snapshot(price_rows)
        result = {
            "symbol": symbol,
            "computed_at": computed_at or datetime.now(UTC).isoformat(),
            "rsi_14": snapshot["rsi_14"],
            "macd_line": snapshot["macd_line"],
            "macd_signal": snapshot["macd_signal"],
            "macd_hist": snapshot["macd_hist"],
            "bb_upper": snapshot["bb_upper"],
            "bb_mid": snapshot["bb_mid"],
            "bb_lower": snapshot["bb_lower"],
            "atr_14": snapshot["atr_14"],
            "sma_50": snapshot["sma_50"],
            "sma_200": snapshot["sma_200"],
            "adx_14": snapshot["adx_14"],
            "obv": snapshot["obv"],
            "vol_ratio": snapshot["vol_ratio"],
            "close": snapshot["close"],
            "t_score": self.score_indicators(snapshot),
            # pass-through series for entry gates (not saved to DB)
            "_snapshot": snapshot,
        }
        db_row = {k: v for k, v in result.items()
                  if k not in ("close", "t_score", "_snapshot") and not k.startswith("_")}
        self.save_indicator_values(db_row)
        logger.info("Technical score for %s: %s", symbol, result["t_score"])
        return result


def _to_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)
