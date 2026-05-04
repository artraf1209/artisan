from __future__ import annotations

import logging
from typing import Any

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _score_lower_better(value: float | None, ideal: float, worst: float) -> float | None:
    if value is None:
        return None
    return round(_clamp((worst - value) / (worst - ideal)), 4)


def _score_higher_better(value: float | None, floor: float, target: float) -> float | None:
    if value is None:
        return None
    return round(_clamp((value - floor) / (target - floor)), 4)


class FundamentalScorer:
    def __init__(self, db=None) -> None:
        self.db = db or get_client()

    def fetch_latest_fundamentals(self, symbol: str) -> dict[str, Any] | None:
        response = (
            self.db.table("fundamentals")
            .select("*")
            .eq("symbol", symbol)
            .order("period_end", desc=True)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def score_row(self, row: dict[str, Any] | None) -> dict[str, Any]:
        if not row:
            return {"f_score": 0.5, "breakdown": {}, "input_count": 0, "row": None}

        breakdown = {
            "pe_ratio": _score_lower_better(_to_float(row.get("pe_ratio")), ideal=15.0, worst=40.0),
            "pb_ratio": _score_lower_better(_to_float(row.get("pb_ratio")), ideal=3.0, worst=10.0),
            "roe": _score_higher_better(_to_float(row.get("roe")), floor=0.0, target=0.20),
            "debt_equity": _score_lower_better(_to_float(row.get("debt_equity")), ideal=0.5, worst=2.5),
        }
        values = [value for value in breakdown.values() if value is not None]
        score = round(sum(values) / len(values), 4) if values else 0.5
        return {
            "f_score": score,
            "breakdown": breakdown,
            "input_count": len(values),
            "row": row,
        }

    def score_symbol(self, symbol: str) -> dict[str, Any]:
        result = self.score_row(self.fetch_latest_fundamentals(symbol))
        logger.info("Fundamental score for %s: %s", symbol, result["f_score"])
        return {"symbol": symbol, **result}


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)
