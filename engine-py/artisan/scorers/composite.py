from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from artisan.config import settings
from artisan.db.client import get_client

logger = logging.getLogger(__name__)


class CompositeScorer:
    def __init__(self, db=None) -> None:
        self.db = db or get_client()

    def fetch_strategy(self, strategy_id: str | None = None) -> dict[str, Any]:
        response = (
            self.db.table("strategies")
            .select("*")
            .eq("id", strategy_id or settings.strategy_id)
            .limit(1)
            .execute()
        )
        if not response.data:
            raise RuntimeError("Configured strategy was not found")
        return response.data[0]

    def build_score_row(
        self,
        *,
        symbol: str,
        strategy: dict[str, Any],
        f_score: float,
        t_score: float,
        s_score: float,
        scored_at: str | None = None,
    ) -> dict[str, Any]:
        threshold = float(strategy["threshold"])
        pillars_passed = sum(score > threshold for score in (f_score, t_score, s_score))
        composite = (
            (f_score * float(strategy["f_weight"]))
            + (t_score * float(strategy["t_weight"]))
            + (s_score * float(strategy["s_weight"]))
        )
        return {
            "id": str(uuid4()),
            "symbol": symbol,
            "strategy_id": strategy["id"],
            "scored_at": scored_at or datetime.now(UTC).isoformat(),
            "f_score": round(float(f_score), 4),
            "t_score": round(float(t_score), 4),
            "s_score": round(float(s_score), 4),
            "composite": round(composite, 4),
            "pillars_passed": pillars_passed,
        }

    def save_composite_score(self, row: dict[str, Any]) -> dict[str, Any]:
        response = self.db.table("composite_scores").upsert(
            row,
            on_conflict="symbol,strategy_id,scored_at",
        ).execute()
        return response.data[0] if response.data else row

    def score_symbol(
        self,
        *,
        symbol: str,
        strategy: dict[str, Any],
        f_score: float,
        t_score: float,
        s_score: float,
        scored_at: str | None = None,
    ) -> dict[str, Any]:
        row = self.build_score_row(
            symbol=symbol,
            strategy=strategy,
            f_score=f_score,
            t_score=t_score,
            s_score=s_score,
            scored_at=scored_at,
        )
        saved = self.save_composite_score(row)
        logger.info("Composite score for %s: %s", symbol, saved["composite"])
        return saved
