from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


class SentimentScorer:
    def __init__(self, db=None, window_hours: int = 72) -> None:
        self.db = db or get_client()
        self.window_hours = window_hours

    def fetch_recent_articles(self, symbol: str, now: datetime | None = None) -> list[dict[str, Any]]:
        now = now or datetime.now(UTC)
        since = (now - timedelta(hours=self.window_hours)).isoformat()
        response = (
            self.db.table("news_articles")
            .select("headline, summary, vader_compound, published_at")
            .eq("symbol", symbol)
            .gte("published_at", since)
            .order("published_at", desc=True)
            .execute()
        )
        return response.data

    def score_articles(self, rows: list[dict[str, Any]], now: datetime | None = None) -> dict[str, Any]:
        if not rows:
            return {"s_score": 0.5, "headline_count": 0, "raw_average": 0.0}

        now = now or datetime.now(UTC)
        total_weight = 0.0
        weighted_sum = 0.0

        for row in rows:
            published_at = datetime.fromisoformat(row["published_at"].replace("Z", "+00:00"))
            hours_old = max((now - published_at).total_seconds() / 3600, 0.0)
            weight = 1 / (1 + (hours_old / 24))
            score = float(row.get("vader_compound") or 0.0)
            total_weight += weight
            weighted_sum += score * weight

        raw_average = weighted_sum / total_weight if total_weight else 0.0
        normalized = round(_clamp((raw_average + 1) / 2), 4)
        return {
            "s_score": normalized,
            "headline_count": len(rows),
            "raw_average": round(raw_average, 4),
        }

    def score_symbol(self, symbol: str, now: datetime | None = None) -> dict[str, Any]:
        rows = self.fetch_recent_articles(symbol, now=now)
        result = self.score_articles(rows, now=now)
        logger.info("Sentiment score for %s: %s", symbol, result["s_score"])
        return {"symbol": symbol, **result}
