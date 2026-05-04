from __future__ import annotations

import httpx

from artisan.adapters.fmp_fundamentals import FmpFundamentalsAdapter


class FakeQuery:
    def __init__(self, table_name: str, calls: list[dict]) -> None:
        self.table_name = table_name
        self.calls = calls

    def upsert(self, row, on_conflict: str):
        self.calls.append(
            {
                "table": self.table_name,
                "row": row,
                "on_conflict": on_conflict,
            }
        )
        return self

    def execute(self):
        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self.calls)


def test_build_fundamental_row_maps_complete_response() -> None:
    payloads = {
        "/profile": [{"companyName": "Apple", "exchangeShortName": "NASDAQ", "sector": "Tech", "industry": "Hardware"}],
        "/key-metrics": [{"date": "2025-09-28", "peRatio": 28.2, "pbRatio": 42.0}],
        "/ratios": [{"returnOnEquity": 1.45, "debtEquityRatio": 1.2}],
        "/income-statement": [{"date": "2025-09-28", "revenue": 100.0, "netIncome": 25.0, "eps": 6.5}],
        "/earnings-calendar": [{"date": "2026-05-08"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payloads[request.url.path])

    adapter = FmpFundamentalsAdapter(
        db=FakeDB(),
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        base_url="https://financialmodelingprep.com/stable",
    )

    row, asset_row = adapter.build_fundamental_row("AAPL")

    assert row["symbol"] == "AAPL"
    assert row["period_end"] == "2025-09-28"
    assert row["pe_ratio"] == 28.2
    assert row["earnings_date"] == "2026-05-08"
    assert asset_row["exchange"] == "NASDAQ"
    assert asset_row["sector"] == "Tech"


def test_sync_symbol_persists_nullable_fields_when_responses_are_partial() -> None:
    payloads = {
        "/profile": [{"companyName": "Apple"}],
        "/key-metrics": [{"date": "2025-09-28"}],
        "/ratios": [{}],
        "/income-statement": [{"date": "2025-09-28", "revenue": 100.0}],
        "/earnings-calendar": [],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payloads[request.url.path])

    db = FakeDB()
    adapter = FmpFundamentalsAdapter(
        db=db,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        base_url="https://financialmodelingprep.com/stable",
    )

    row = adapter.sync_symbol("AAPL")

    assert row["pb_ratio"] is None
    assert row["earnings_date"] is None
    assert db.calls[0]["table"] == "assets"
    assert db.calls[1]["table"] == "fundamentals"
    assert db.calls[1]["on_conflict"] == "symbol,period_end,period_type"
