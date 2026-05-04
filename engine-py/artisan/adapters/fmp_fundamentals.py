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
    def _get(self, path: str, **params: Any) -> list[dict[str, Any]]:
        query = {"apikey": settings.fmp_api_key, **{k: v for k, v in params.items() if v is not None}}
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

    def fetch_income_history(self, symbol: str, limit: int = 4) -> list[dict[str, Any]]:
        """Fetch last N annual income statements for growth calculations."""
        return self._get("income-statement", symbol=symbol, limit=limit)

    def fetch_cash_flow(self, symbol: str) -> dict[str, Any]:
        rows = self._get("cash-flow-statement", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_balance_sheet(self, symbol: str) -> dict[str, Any]:
        rows = self._get("balance-sheet-statement", symbol=symbol)
        return rows[0] if rows else {}

    def fetch_earnings_calendar(self, symbol: str) -> dict[str, Any]:
        from datetime import date as _date
        rows = self._get("earnings-calendar", symbol=symbol)
        symbol_rows = [r for r in rows if r.get("symbol") == symbol]
        if not symbol_rows:
            return {}
        today = _date.today().isoformat()
        upcoming = [r for r in symbol_rows if r.get("date", "") >= today]
        return min(upcoming, key=lambda r: r["date"]) if upcoming else symbol_rows[0]

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

    @staticmethod
    def _safe_float(value: Any) -> float | None:
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

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
        income = self.fetch_income_statement(symbol)
        cash_flow = self.fetch_cash_flow(symbol)
        balance = self.fetch_balance_sheet(symbol)
        earnings = self.fetch_earnings_calendar(symbol)

        period_end = self._parse_period_end(key_metrics, ratios, income, earnings, profile)

        # Derived: EBITDA = operating income + D&A if not directly available
        ebitda = self._safe_float(income.get("ebitda"))
        if ebitda is None:
            op_income = self._safe_float(income.get("operatingIncome"))
            da = self._safe_float(income.get("depreciationAndAmortization"))
            if op_income is not None and da is not None:
                ebitda = op_income + da

        row = {
            "symbol": symbol,
            "period_end": period_end,
            "period_type": "annual",
            # existing fields
            "pe_ratio": ratios.get("priceToEarningsRatio"),
            "pb_ratio": ratios.get("priceToBookRatio"),
            "roe": key_metrics.get("returnOnEquity"),
            "debt_equity": ratios.get("debtToEquityRatio"),
            "revenue": income.get("revenue"),
            "net_income": income.get("netIncome"),
            "eps": income.get("eps"),
            "earnings_date": earnings.get("date"),
            # new extended fields
            "gross_profit": income.get("grossProfit"),
            "ebitda": ebitda,
            "interest_expense": income.get("interestExpense"),
            "fcf": cash_flow.get("freeCashFlow"),
            "operating_cash_flow": cash_flow.get("operatingCashFlow"),
            "total_assets": balance.get("totalAssets"),
            "total_debt": balance.get("totalDebt"),
            "book_equity": balance.get("totalStockholdersEquity"),
            "cash": balance.get("cashAndCashEquivalents"),
            "market_cap": self._safe_float(profile.get("mktCap")),
            "source": "fmp",
            "fetched_at": self._now_iso(),
        }

        return row, self.build_asset_row(symbol, profile)

    def fetch_income_history_rows(self, symbol: str) -> list[dict[str, Any]]:
        """Return up to 4 annual income rows for growth calculations."""
        return self.fetch_income_history(symbol, limit=4)

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
