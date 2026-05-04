from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings
from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class FmpFundamentalsAdapter:
    def __init__(
        self,
        db=None,
        http_client: httpx.Client | None = None,
        base_url: str = "https://financialmodelingprep.com/stable",
    ) -> None:
        self.db = db or get_client()
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = base_url.rstrip("/")

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _get(self, path: str, **params: str) -> list[dict[str, Any]]:
        query = {"apikey": settings.fmp_api_key, **params}
        response = self.http_client.get(f"{self.base_url}/{path.lstrip('/')}", params=query)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def fetch_profile(self, symbol: str) -> dict[str, Any]:
        rows = self._get("profile", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_key_metrics(self, symbol: str) -> dict[str, Any]:
        rows = self._get("key-metrics", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_ratios(self, symbol: str) -> dict[str, Any]:
        rows = self._get("ratios", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_income_statement(self, symbol: str) -> dict[str, Any]:
        rows = self._get("income-statement", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_earnings_calendar(self, symbol: str) -> dict[str, Any]:
        rows = self._get("earnings-calendar", symbol=symbol)
        return rows[0] if rows else {}

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _parse_period_end(*sources: dict[str, Any]) -> str:
        for source in sources:
            for key in ("date", "calendarYear"):
                value = source.get(key)
                if value:
                    return str(value)
        return datetime.now(timezone.utc).date().isoformat()

    def build_asset_row(self, symbol: str, profile: dict[str, Any]) -> dict:
        return {
            "symbol": symbol,
            "name": profile.get("companyName") or profile.get("name"),
            "exchange": profile.get("exchangeShortName") or profile.get("exchange"),
            "asset_class": "equity",
            "sector": profile.get("sector"),
            "industry": profile.get("industry"),
            "updated_at": self._now_iso(),
        }

    def build_fundamental_row(self, symbol: str) -> tuple[dict, dict]:
        profile = self.fetch_profile(symbol)
        key_metrics = self.fetch_key_metrics(symbol)
        ratios = self.fetch_ratios(symbol)
        income_statement = self.fetch_income_statement(symbol)
        earnings = self.fetch_earnings_calendar(symbol)

        period_end = self._parse_period_end(
            key_metrics, ratios, income_statement, earnings, profile
        )

        row = {
            "symbol": symbol,
            "period_end": period_end,
            "period_type": "annual",
            "pe_ratio": ratios.get("priceToEarningsRatio"),
            "pb_ratio": ratios.get("priceToBookRatio"),
            "roe": key_metrics.get("returnOnEquity"),
            "debt_equity": ratios.get("debtToEquityRatio"),
            "revenue": income_statement.get("revenue"),
            "net_income": income_statement.get("netIncome"),
            "eps": income_statement.get("eps"),
            "earnings_date": earnings.get("date"),
            "source": "fmp",
            "fetched_at": self._now_iso(),
        }

        return row, self.build_asset_row(symbol, profile)

    def save_asset_row(self, row: dict) -> None:
        self.db.table("assets").upsert(row, on_conflict="symbol").execute()

    def save_fundamental_row(self, row: dict) -> None:
        self.db.table("fundamentals").upsert(
            row,
            on_conflict="symbol,period_end,period_type",
        ).execute()

    def sync_symbol(self, symbol: str) -> dict:
        fundamental_row, asset_row = self.build_fundamental_row(symbol)
        self.save_asset_row(asset_row)
        self.save_fundamental_row(fundamental_row)
        logger.info("Upserted fundamentals for %s", symbol)
        return fundamental_row
