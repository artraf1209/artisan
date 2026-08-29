from __future__ import annotations

from datetime import date

import httpx
from postgrest.exceptions import APIError

from artisan.adapters.alpaca_prices import AlpacaPricesAdapter


class FakeQuery:
    def __init__(self, table_name: str, recorder: dict, failures: list[BaseException] | None = None) -> None:
        self.table_name = table_name
        self.recorder = recorder
        self.failures = failures or []
        self.current_rows: list[dict] = []

    def upsert(self, rows, on_conflict: str):
        self.current_rows = rows
        self.recorder.setdefault("calls", []).append(
            {
                "table": self.table_name,
                "rows": rows,
                "on_conflict": on_conflict,
            }
        )
        return self

    def execute(self):
        if self.failures:
            raise self.failures.pop(0)
        return type("Response", (), {"data": self.current_rows})()


class FakeDB:
    def __init__(self, failures: list[BaseException] | None = None) -> None:
        self.recorder: dict = {}
        self.failures = failures or []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self.recorder, self.failures)


def _build_bar(close: float, timestamp: str = "2026-05-01T00:00:00Z") -> dict:
    return {
        "t": timestamp,
        "o": close - 1.0,
        "h": close + 1.0,
        "l": close - 2.0,
        "c": close,
        "v": 1_000,
        "vw": close - 0.25,
    }


def test_fetch_daily_bars_handles_pagination() -> None:
    responses = [
        {
            "bars": {
                "AAPL": [_build_bar(104.0)],
            },
            "next_page_token": "next-page",
        },
        {
            "bars": {
                "MSFT": [_build_bar(203.0)],
                "AAPL": [_build_bar(105.0, "2026-05-02T00:00:00Z")],
            }
        },
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        payload = responses.pop(0)
        return httpx.Response(200, json=payload)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = AlpacaPricesAdapter(db=FakeDB(), http_client=client)

    rows = adapter.fetch_daily_bars(["AAPL", "MSFT"], date(2026, 5, 1), date(2026, 5, 2))

    assert len(rows) == 3
    assert rows[0]["bar_time"].endswith("+00:00")
    assert {row["symbol"] for row in rows} == {"AAPL", "MSFT"}
    assert adapter.last_request_count == 2
    assert adapter.last_skipped_invalid_symbols == []


def test_fetch_daily_bars_batches_symbols_and_preserves_original_symbol_names() -> None:
    requested_symbols: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_symbols.append(request.url.params["symbols"])
        market_symbol = request.url.params["symbols"]
        return httpx.Response(200, json={"bars": {market_symbol: [_build_bar(300.0)]}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = AlpacaPricesAdapter(db=FakeDB(), http_client=client, symbol_batch_size=1)

    rows = adapter.fetch_daily_bars(["BRK-B", "MSFT"], date(2026, 5, 1), date(2026, 5, 2))

    assert requested_symbols == ["BRK.B", "MSFT"]
    assert [row["symbol"] for row in rows] == ["BRK-B", "MSFT"]


def test_fetch_daily_bars_skips_only_invalid_symbols_within_a_batch() -> None:
    requested_symbols: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        symbols = request.url.params["symbols"]
        requested_symbols.append(symbols)
        if symbols == "BRK.B,BAD,MSFT":
            return httpx.Response(400, json={"message": "invalid symbol: BAD"}, request=request)
        if symbols == "BAD":
            return httpx.Response(400, json={"message": "invalid symbol: BAD"}, request=request)
        return httpx.Response(200, json={"bars": {symbols: [_build_bar(150.0)]}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    adapter = AlpacaPricesAdapter(db=FakeDB(), http_client=client, symbol_batch_size=3)

    rows = adapter.fetch_daily_bars(["BRK-B", "BAD", "MSFT"], date(2026, 5, 1), date(2026, 5, 2))

    assert requested_symbols == ["BRK.B,BAD,MSFT", "BRK.B", "BAD", "MSFT"]
    assert [row["symbol"] for row in rows] == ["BRK-B", "MSFT"]
    assert adapter.last_skipped_invalid_symbols == ["BAD"]


def test_save_bars_upserts_with_expected_key() -> None:
    db = FakeDB()
    adapter = AlpacaPricesAdapter(
        db=db,
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))),
    )

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
    assert len(db.recorder["calls"]) == 1
    assert db.recorder["calls"][0]["table"] == "price_bars"
    assert db.recorder["calls"][0]["on_conflict"] == "symbol,bar_time"
    assert db.recorder["calls"][0]["rows"] == rows


def test_save_bars_upserts_in_chunks_of_2000_rows() -> None:
    db = FakeDB()
    adapter = AlpacaPricesAdapter(
        db=db,
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))),
    )
    rows = [
        {
            "symbol": f"SYM{i}",
            "bar_time": f"2026-05-{(i % 28) + 1:02d}T00:00:00+00:00",
            "open": float(i),
            "high": float(i) + 1.0,
            "low": float(i) - 1.0,
            "close": float(i) + 0.5,
            "volume": i + 100,
            "vwap": float(i) + 0.25,
            "source": "alpaca",
        }
        for i in range(2_001)
    ]

    saved = adapter.save_bars(rows)

    assert saved == 2_001
    assert [len(call["rows"]) for call in db.recorder["calls"]] == [2_000, 1]


def test_save_bars_retries_transient_supabase_write_errors() -> None:
    db = FakeDB(
        failures=[
            APIError(
                {
                    "message": "canceling statement due to statement timeout",
                    "code": "57014",
                    "details": None,
                    "hint": None,
                }
            )
        ]
    )
    adapter = AlpacaPricesAdapter(
        db=db,
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={}))),
    )
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
    assert len(db.recorder["calls"]) == 2
