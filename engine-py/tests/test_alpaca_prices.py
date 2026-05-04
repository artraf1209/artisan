from __future__ import annotations

from datetime import date

import httpx

from artisan.adapters.alpaca_prices import AlpacaPricesAdapter


class FakeQuery:
    def __init__(self, table_name: str, recorder: dict) -> None:
        self.table_name = table_name
        self.recorder = recorder

    def upsert(self, rows, on_conflict: str):
        self.recorder["table"] = self.table_name
        self.recorder["rows"] = rows
        self.recorder["on_conflict"] = on_conflict
        return self

    def execute(self):
        return type("Response", (), {"data": self.recorder["rows"]})()


class FakeDB:
    def __init__(self) -> None:
        self.recorder: dict = {}

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self.recorder)


def test_fetch_daily_bars_handles_pagination() -> None:
    responses = [
        {
            "bars": {
                "AAPL": [
                    {
                        "t": "2026-05-01T00:00:00Z",
                        "o": 100.0,
                        "h": 105.0,
                        "l": 99.0,
                        "c": 104.0,
                        "v": 1000,
                        "vw": 102.5,
                    }
                ]
            },
            "next_page_token": "next-page",
        },
        {
            "bars": {
                "MSFT": [
                    {
                        "t": "2026-05-01T00:00:00Z",
                        "o": 200.0,
                        "h": 204.0,
                        "l": 198.0,
                        "c": 203.0,
                        "v": 2000,
                        "vw": 201.5,
                    }
                ],
                "AAPL": [
                    {
                        "t": "2026-05-02T00:00:00Z",
                        "o": 104.0,
                        "h": 106.0,
                        "l": 103.0,
                        "c": 105.0,
                        "v": 1200,
                        "vw": 104.8,
                    }
                ],
            }
        },
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.pop(0)
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = AlpacaPricesAdapter(db=FakeDB(), http_client=client)

    rows = adapter.fetch_daily_bars(["AAPL", "MSFT"], date(2026, 5, 1), date(2026, 5, 2))

    assert len(rows) == 3
    assert rows[0]["bar_time"].endswith("+00:00")
    assert {row["symbol"] for row in rows} == {"AAPL", "MSFT"}


def test_save_bars_upserts_with_expected_key() -> None:
    db = FakeDB()
    adapter = AlpacaPricesAdapter(db=db, http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))))

    rows = [
        {
            "symbol": "AAPL",
            "bar_time": "2026-05-01T00:00:00+00:00",
            "open": 100.0,
            "high": 105.0,
            "low": 99.0,
            "close": 104.0,
            "volume": 1000,
            "vwap": 102.5,
            "source": "alpaca",
        }
    ]

    saved = adapter.save_bars(rows)

    assert saved == 1
    assert db.recorder["table"] == "price_bars"
    assert db.recorder["on_conflict"] == "symbol,bar_time"
    assert db.recorder["rows"] == rows
