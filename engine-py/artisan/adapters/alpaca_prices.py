from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from postgrest.exceptions import APIError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings
from artisan.db.client import get_client

logger = logging.getLogger(__name__)

MARKET_DATA_SYMBOL_BATCH_SIZE = 50
PRICE_BARS_UPSERT_BATCH_SIZE = 2_000


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


def _is_retryable_write_error(exc: BaseException) -> bool:
    if isinstance(exc, APIError):
        code = str(getattr(exc, "code", "") or "")
        message = str(getattr(exc, "message", "") or "").lower()
        return code == "57014" or "timeout" in message or "temporar" in message
    return _is_retryable_error(exc)


def _is_invalid_symbol_error(exc: BaseException) -> bool:
    if not isinstance(exc, httpx.HTTPStatusError) or exc.response.status_code != 400:
        return False
    try:
        payload = exc.response.json()
    except ValueError:
        return False
    message = str(payload.get("message") or "").lower()
    return "invalid symbol" in message


def _chunk_list(items: list[Any], batch_size: int) -> list[list[Any]]:
    return [items[index:index + batch_size] for index in range(0, len(items), batch_size)]


class AlpacaPricesAdapter:
    def __init__(
        self,
        db=None,
        http_client: httpx.Client | None = None,
        base_url: str | None = None,
        symbol_batch_size: int = MARKET_DATA_SYMBOL_BATCH_SIZE,
    ) -> None:
        self.db = db or get_client()
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = self._derive_data_base_url(base_url or settings.alpaca_base_url)
        self.symbol_batch_size = symbol_batch_size
        self.last_request_count = 0
        self.last_skipped_invalid_symbols: list[str] = []
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

    @staticmethod
    def _canonicalize_market_data_symbol(symbol: str) -> str:
        return symbol.replace("-", ".")

    @staticmethod
    def _build_symbol_pairs(symbols: list[str]) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        seen_market_symbols: set[str] = set()
        for symbol in symbols:
            market_symbol = AlpacaPricesAdapter._canonicalize_market_data_symbol(symbol)
            if market_symbol in seen_market_symbols:
                continue
            seen_market_symbols.add(market_symbol)
            pairs.append((symbol, market_symbol))
        return pairs

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

    @retry(
        retry=retry_if_exception(_is_retryable_write_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _upsert_bars_batch(self, rows: list[dict]) -> None:
        self.db.table("price_bars").upsert(rows, on_conflict="symbol,bar_time").execute()

    def _fetch_batch_pages(self, symbol_pairs: list[tuple[str, str]], start: date, end: date) -> list[dict]:
        rows: list[dict] = []
        original_by_market_symbol = {market_symbol: original for original, market_symbol in symbol_pairs}
        page_token: str | None = None

        while True:
            params = {
                "symbols": ",".join(market_symbol for _, market_symbol in symbol_pairs),
                "timeframe": "1Day",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "adjustment": "raw",
                "feed": "iex",  # free-tier feed; switch to "sip" with paid subscription
            }
            if page_token:
                params["page_token"] = page_token

            payload = self._request_bars(params)
            self.last_request_count += 1

            for market_symbol, bars in payload.get("bars", {}).items():
                original_symbol = original_by_market_symbol.get(market_symbol, market_symbol)
                for bar in bars:
                    rows.append(self._transform_bar(original_symbol, bar))

            page_token = payload.get("next_page_token")
            if not page_token:
                break

        return rows

    def _fetch_batch_with_fallback(self, symbol_pairs: list[tuple[str, str]], start: date, end: date) -> list[dict]:
        try:
            return self._fetch_batch_pages(symbol_pairs, start, end)
        except httpx.HTTPStatusError as exc:
            if not _is_invalid_symbol_error(exc):
                raise
            if len(symbol_pairs) == 1:
                skipped_symbol = symbol_pairs[0][0]
                logger.warning("Skipping invalid Alpaca market-data symbol: %s", skipped_symbol)
                self.last_skipped_invalid_symbols.append(skipped_symbol)
                return []

            rows: list[dict] = []
            for symbol_pair in symbol_pairs:
                rows.extend(self._fetch_batch_with_fallback([symbol_pair], start, end))
            return rows

    def fetch_daily_bars(self, symbols: list[str], start: date, end: date) -> list[dict]:
        if not symbols:
            return []

        self.last_request_count = 0
        self.last_skipped_invalid_symbols = []

        symbol_pairs = self._build_symbol_pairs(symbols)
        rows: list[dict] = []
        for symbol_batch in _chunk_list(symbol_pairs, self.symbol_batch_size):
            rows.extend(self._fetch_batch_with_fallback(symbol_batch, start, end))

        logger.info(
            "Fetched %s bars across %s request(s); skipped_invalid_symbols=%s",
            len(rows),
            self.last_request_count,
            self.last_skipped_invalid_symbols,
        )
        return rows

    def save_bars(self, rows: list[dict]) -> int:
        if not rows:
            return 0

        batch_count = 0
        for row_batch in _chunk_list(rows, PRICE_BARS_UPSERT_BATCH_SIZE):
            self._upsert_bars_batch(row_batch)
            batch_count += 1

        logger.info("Upserted %s price bars across %s batch(es)", len(rows), batch_count)
        return len(rows)
