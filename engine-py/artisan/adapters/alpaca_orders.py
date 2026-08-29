from __future__ import annotations

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from artisan.config import settings

MAX_REPLACED_HOPS = 5


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class AlpacaOrdersAdapter:
    """Read-only Alpaca order/position polling for trade reconciliation.

    Like AlpacaAccountAdapter and AlpacaPricesAdapter, this is a read against the
    trading API, not an order placement — it does not violate the "execute-trade is
    the only Alpaca order-placement path" rule (CLAUDE.md).
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
    def _get_order_raw(self, order_id: str) -> dict:
        response = self.http_client.get(f"{self.base_url}/v2/orders/{order_id}", headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_order(self, order_id: str) -> dict:
        """Fetches an order, following the `replaced_by` chain to the final resolved
        order if the broker has replaced it (e.g. a human replaced it manually via
        the Alpaca dashboard) — otherwise polling the original id would never find
        a terminal status."""
        current_id = order_id
        order = self._get_order_raw(current_id)
        hops = 0
        while order.get("replaced_by") and hops < MAX_REPLACED_HOPS:
            current_id = order["replaced_by"]
            order = self._get_order_raw(current_id)
            hops += 1
        return order

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def get_order_by_client_order_id(self, client_order_id: str) -> dict | None:
        response = self.http_client.get(
            f"{self.base_url}/v2/orders:by_client_order_id",
            params={"client_order_id": client_order_id},
            headers=self.headers,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def get_position(self, symbol: str) -> dict | None:
        response = self.http_client.get(f"{self.base_url}/v2/positions/{symbol}", headers=self.headers)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
