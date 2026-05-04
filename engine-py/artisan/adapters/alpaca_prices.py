from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from urllib.parse import urlparse

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings
from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class AlpacaPricesAdapter:
    def __init__(
        self,
        db=None,
        http_client: httpx.Client | None = None,
        base_url: str | None = None,
    ) -> None:
        self.db = db or get_client()
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = self._derive_data_base_url(base_url or settings.alpaca_base_url)
        self.headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
        }

    @staticmethod
    def _derive_data_base_url(base_url: str) -> str:
        parsed = urlparse(base_url)
        if "alpaca.markets" not in parsed.netloc:
            return base_url.rstrip("/")

        host = parsed.netloc.replace("paper-api.", "data.").replace("api.", "data.")
        scheme = parsed.scheme or "https"
        return f"{scheme}://{host}".rstrip("/")

    @staticmethod
    def _normalize_timestamp(value: str) -> str:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        return parsed.astimezone(timezone.utc).isoformat()

    @staticmethod
    def _transform_bar(symbol: str, raw_bar: dict) -> dict:
        return {
            "symbol": symbol,
            "bar_time": AlpacaPricesAdapter._normalize_timestamp(raw_bar["t"]),
            "open": raw_bar["o"],
            "high": raw_bar["h"],
            "low": raw_bar["l"],
            "close": raw_bar["c"],
            "volume": raw_bar["v"],
            "vwap": raw_bar.get("vw"),
            "source": "alpaca",
        }

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _request_bars(self, params: dict[str, str]) -> dict:
        response = self.http_client.get(
            f"{self.base_url}/v2/stocks/bars",
            params=params,
            headers=self.headers,
        )
        response.raise_for_status()
        return response.json()

    def fetch_daily_bars(self, symbols: list[str], start: date, end: date) -> list[dict]:
        if not symbols:
            return []

        rows: list[dict] = []
        page_token: str | None = None
        request_count = 0

        while True:
            params = {
                "symbols": ",".join(symbols),
                "timeframe": "1Day",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "adjustment": "raw",
            }
            if page_token:
                params["page_token"] = page_token

            payload = self._request_bars(params)
            request_count += 1

            for symbol, bars in payload.get("bars", {}).items():
                for bar in bars:
                    rows.append(self._transform_bar(symbol, bar))

            page_token = payload.get("next_page_token")
            if not page_token:
                break

        logger.info("Fetched %s bars across %s request(s)", len(rows), request_count)
        return rows

    def save_bars(self, rows: list[dict]) -> int:
        if not rows:
            return 0

        self.db.table("price_bars").upsert(rows, on_conflict="symbol,bar_time").execute()
        logger.info("Upserted %s price bars", len(rows))
        return len(rows)
