from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import write_audit_log

logger = logging.getLogger(__name__)


class SignalPipeline:
    def __init__(self, db=None) -> None:
        self.db = db or get_client()

    @staticmethod
    def passes_confluence(score_row: dict[str, Any], threshold: float) -> bool:
        return sum(
            score > threshold
            for score in (
                float(score_row["f_score"]),
                float(score_row["t_score"]),
                float(score_row["s_score"]),
            )
        ) >= 2

    @staticmethod
    def has_earnings_blackout(fundamental_row: dict[str, Any] | None, signal_date: datetime) -> bool:
        if not fundamental_row or not fundamental_row.get("earnings_date"):
            return False
        earnings_date = datetime.fromisoformat(f"{fundamental_row['earnings_date']}T00:00:00+00:00")
        return abs((earnings_date.date() - signal_date.date()).days) <= 3

    def fetch_latest_price(self, symbol: str) -> float | None:
        response = (
            self.db.table("price_bars")
            .select("close")
            .eq("symbol", symbol)
            .order("bar_time", desc=True)
            .limit(1)
            .execute()
        )
        if not response.data:
            return None
        return float(response.data[0]["close"])

    def save_signal_event(self, row: dict[str, Any]) -> dict[str, Any]:
        response = self.db.table("signal_events").insert(row).execute()
        return response.data[0] if response.data else row

    def process_symbol(
        self,
        *,
        strategy: dict[str, Any],
        composite_row: dict[str, Any],
        indicator_row: dict[str, Any],
        fundamental_row: dict[str, Any] | None,
        now: datetime | None = None,
    ) -> dict[str, Any] | None:
        now = now or datetime.now(UTC)
        threshold = float(strategy["threshold"])
        symbol = composite_row["symbol"]

        if not self.passes_confluence(composite_row, threshold):
            write_audit_log(
                self.db,
                actor="system",
                action="signal_skipped",
                entity="signal_events",
                payload={"symbol": symbol, "reason": "confluence_gate"},
            )
            return None

        earnings_blackout = self.has_earnings_blackout(fundamental_row, now)
        if earnings_blackout:
            write_audit_log(
                self.db,
                actor="system",
                action="signal_vetoed",
                entity="signal_events",
                payload={"symbol": symbol, "reason": "earnings_blackout_veto"},
            )
            return None

        close = indicator_row.get("close") or self.fetch_latest_price(symbol)
        atr = indicator_row.get("atr_14")
        stop_price = round(close - (2 * atr), 4) if close and atr else None
        target_price = round(close + (3 * atr), 4) if close and atr else None

        signal_row = {
            "id": str(uuid4()),
            "symbol": symbol,
            "strategy_id": strategy["id"],
            "score_id": composite_row["id"],
            "direction": "long",
            "composite_score": composite_row["composite"],
            "f_score": composite_row["f_score"],
            "t_score": composite_row["t_score"],
            "s_score": composite_row["s_score"],
            "pillars_passed": composite_row["pillars_passed"],
            "earnings_blackout": False,
            "stop_price": stop_price,
            "target_price": target_price,
            "atr_at_signal": atr,
            "status": "pending",
            "created_at": now.isoformat(),
        }
        saved = self.save_signal_event(signal_row)
        write_audit_log(
            self.db,
            actor="system",
            action="signal_create",
            entity="signal_events",
            entity_id=saved["id"],
            payload={"symbol": symbol, "composite": composite_row["composite"]},
        )
        logger.info("Created pending signal for %s", symbol)
        return saved
