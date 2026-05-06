from __future__ import annotations

import httpx
import pytest

from artisan.adapters.fmp_screener import FmpScreenerAdapter, FmpScreenerUnavailableError


def test_screen_uses_company_screener_and_filters_non_equities() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == (
            "https://financialmodelingprep.com/stable/company-screener"
            "?apikey=fmp-key"
            "&marketCapMoreThan=1000000000"
            "&volumeMoreThan=5000000"
            "&exchange=NASDAQ%2CNYSE"
            "&country=US"
            "&isActivelyTrading=true"
        )
        return httpx.Response(
            200,
            json=[
                {"symbol": "QQQ", "marketCap": 10_000_000_000, "isEtf": True, "isFund": False},
                {"symbol": "FUNDX", "marketCap": 20_000_000_000, "isEtf": False, "isFund": True},
                {"symbol": "DEAD", "marketCap": 30_000_000_000, "isEtf": False, "isFund": False, "isActivelyTrading": False},
                {"symbol": "MSFT", "marketCap": 3_000_000_000_000, "isEtf": False, "isFund": False, "isActivelyTrading": True},
                {"symbol": "AAPL", "marketCap": 4_000_000_000_000, "isEtf": False, "isFund": False, "isActivelyTrading": True},
                {"symbol": "AMD", "marketCap": 250_000_000_000, "isEtf": False, "isFund": False, "isActivelyTrading": True},
                {"marketCap": 1_000_000_000, "isEtf": False, "isFund": False, "isActivelyTrading": True},
            ],
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = FmpScreenerAdapter(http_client=client)

    assert adapter.screen(top_n=2) == ["AAPL", "MSFT"]


def test_screen_raises_when_company_screener_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = FmpScreenerAdapter(http_client=client)

    with pytest.raises(FmpScreenerUnavailableError, match="stable_company:403"):
        adapter.screen()
