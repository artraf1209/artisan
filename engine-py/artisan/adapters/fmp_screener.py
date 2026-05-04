from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings

logger = logging.getLogger(__name__)

SCREENER_TOP_N = 40  # max symbols to ingest per run (API budget guard)


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class FmpScreenerAdapter:
    def __init__(
        self,
        http_client: httpx.Client | None = None,
        base_url: str = "https://financialmodelingprep.com/stable",
    ) -> None:
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = base_url.rstrip("/")

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _get(self, path: str, **params: object) -> list[dict]:
        query = {"apikey": settings.fmp_api_key, **{k: v for k, v in params.items() if v is not None}}
        response = self.http_client.get(f"{self.base_url}/{path.lstrip('/')}", params=query)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    def screen(self, top_n: int = SCREENER_TOP_N) -> list[str]:
        """
        Return top-N symbols by market cap passing universe definition filters.
        Falls back to empty list (caller uses existing DB universe) if endpoint unavailable.
        """
        try:
            rows = self._get(
                "stock-screener",
                marketCapMoreThan=1_000_000_000,
                volumeMoreThan=5_000_000,
                exchange="nasdaq,nyse",
                country="US",
                isActivelyTrading=True,
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (404, 403):
                logger.warning(
                    "FMP screener endpoint not available on current plan (%s). "
                    "Using existing DB universe.",
                    e.response.status_code,
                )
                return []
            raise

        # Keep only stocks with 5+ years of trading history
        cutoff = (datetime.now(timezone.utc) - timedelta(days=5 * 365)).date()
        qualified = []
        for r in rows:
            ipo = r.get("ipoDate")
            if not ipo:
                continue
            try:
                if datetime.strptime(ipo, "%Y-%m-%d").date() <= cutoff:
                    qualified.append(r)
            except ValueError:
                continue

        # Sort by market cap descending, take top N
        qualified.sort(key=lambda r: r.get("marketCap") or 0, reverse=True)
        symbols = [r["symbol"] for r in qualified[:top_n] if r.get("symbol")]
        logger.info("Screener: %d qualified symbols, returning top %d", len(qualified), len(symbols))
        return symbols
