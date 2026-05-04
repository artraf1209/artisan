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
        "/profile": [{"companyName": "Apple", "exchangeShortName": "NASDAQ", "sector": "Tech", "industry": "Hardware", "mktCap": 1000}],
        "/key-metrics": [{"date": "2025-09-28", "returnOnEquity": 1.45}],
        "/ratios": [{"priceToEarningsRatio": 28.2, "priceToBookRatio": 42.0, "debtToEquityRatio": 1.2}],
        "/income-statement": [
            {"date": "2025-09-28", "revenue": 100.0, "netIncome": 25.0, "eps": 6.5, "grossProfit": 40.0, "ebitda": 30.0, "interestExpense": 1.0},
            {"date": "2024-09-28", "revenue": 90.0, "netIncome": 20.0, "eps": 5.9, "grossProfit": 36.0, "ebitda": 28.0, "interestExpense": 1.1},
        ],
        "/cash-flow-statement": [
            {"date": "2025-09-28", "freeCashFlow": 22.0, "operatingCashFlow": 30.0},
            {"date": "2024-09-28", "freeCashFlow": 18.0, "operatingCashFlow": 26.0},
        ],
        "/balance-sheet-statement": [
            {"date": "2025-09-28", "totalAssets": 200.0, "totalDebt": 60.0, "totalStockholdersEquity": 120.0, "cashAndCashEquivalents": 20.0},
            {"date": "2024-09-28", "totalAssets": 180.0, "totalDebt": 55.0, "totalStockholdersEquity": 110.0, "cashAndCashEquivalents": 18.0},
        ],
        "/earnings-calendar": [{"symbol": "AAPL", "date": "2026-05-08"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/stable")
        return httpx.Response(200, json=payloads[path])

    adapter = FmpFundamentalsAdapter(
        db=FakeDB(),
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        base_url="https://financialmodelingprep.com/stable",
    )

    row, asset_row = adapter.build_fundamental_row("AAPL")

    assert row["symbol"] == "AAPL"
    assert row["period_end"] == "2025-09-28"
    assert row["pe_ratio"] == 28.2
    assert row["fcf"] == 22.0
    assert row["book_equity"] == 120.0
    assert row["earnings_date"] == "2026-05-08"
    assert asset_row["exchange"] == "NASDAQ"
    assert asset_row["sector"] == "Tech"


def test_sync_symbol_persists_nullable_fields_when_responses_are_partial() -> None:
    payloads = {
        "/profile": [{"companyName": "Apple"}],
        "/key-metrics": [{"date": "2025-09-28"}],
        "/ratios": [{}],
        "/income-statement": [{"date": "2025-09-28", "revenue": 100.0}],
        "/cash-flow-statement": [{"date": "2025-09-28"}],
        "/balance-sheet-statement": [{"date": "2025-09-28"}],
        "/earnings-calendar": [],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/stable")
        return httpx.Response(200, json=payloads[path])

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
    assert isinstance(db.calls[1]["row"], list)
