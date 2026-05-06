from __future__ import annotations

import logging

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings

logger = logging.getLogger(__name__)


class FmpScreenerUnavailableError(RuntimeError):
    """Raised when no compatible screener endpoint is usable for the current account."""


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500
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

    def screen(self, top_n: int | None = None) -> list[str]:
        """
        Return the full qualified symbol set by default, optionally capped by top_n.
        Raises when no supported screener endpoint is currently usable.
        """
        top_n = settings.screener_top_n if top_n is None else top_n
        rows = self._screen_rows()

        qualified = []
        for r in rows:
            symbol = r.get("symbol")
            if not symbol:
                continue
            if r.get("isEtf") or r.get("isFund"):
                continue
            if r.get("isActivelyTrading") is False:
                continue
            qualified.append(r)

        # Sort by market cap descending; top_n acts only as an optional override.
        qualified.sort(key=lambda r: r.get("marketCap") or 0, reverse=True)
        selected = qualified if top_n is None or top_n <= 0 else qualified[:top_n]
        symbols = [r["symbol"] for r in selected if r.get("symbol")]
        logger.info("Screener: %d qualified symbols, returning %d", len(qualified), len(symbols))
        return symbols

    def _screen_rows(self) -> list[dict]:
        try:
            rows = self._get(
                "company-screener",
                marketCapMoreThan=1_000_000_000,
                volumeMoreThan=5_000_000,
                exchange="NASDAQ,NYSE",
                country="US",
                isActivelyTrading=True,
            )
            logger.info("Universe screener using FMP stable company-screener endpoint")
            return rows
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (403, 404, 429):
                logger.warning("FMP stable company screener unavailable (%s)", status)
                raise FmpScreenerUnavailableError(
                    f"FMP screener unavailable for current account; attempts=stable_company:{status}"
                ) from exc
            raise
