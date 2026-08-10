from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class AlpacaAccountAdapter:
    """Read-only Alpaca account state (equity/cash) for portfolio_snapshots.

    This is a read against the trading API, not an order placement — it does not
    violate the "execute-trade is the only Alpaca order-placement path" rule
    (CLAUDE.md), mirroring the existing read-only AlpacaPricesAdapter.
    """

    def __init__(self, http_client: httpx.Client | None = None, base_url: str | None = None) -> None:
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = (base_url or settings.alpaca_base_url).rstrip("/")
        self.headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_api_secret,
        }

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def get_account(self) -> dict:
        response = self.http_client.get(f"{self.base_url}/v2/account", headers=self.headers)
        response.raise_for_status()
        data = response.json()
        return {"equity": float(data["equity"]), "cash": float(data["cash"])}
