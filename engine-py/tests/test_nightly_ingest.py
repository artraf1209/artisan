from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime

import artisan.jobs.nightly_ingest as nightly_ingest
from artisan.adapters.fmp_screener import FmpScreenerUnavailableError
from artisan.jobs.nightly_ingest import _select_fundamental_refresh_symbols, refresh_universe, run_nightly_ingest


class FakeSelectQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def in_(self, _column: str, _value: list[str]):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeInsertQuery:
    def __init__(self, inserts: list[dict]) -> None:
        self.inserts = inserts

    def insert(self, row: dict):
        self.inserts.append(row)
        return self

    def execute(self):
        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self, fundamental_rows: list[dict] | None = None) -> None:
        self.inserts: list[dict] = []
        self.fundamental_rows = fundamental_rows or []

    def table(self, table_name: str):
        if table_name == "universes":
            return FakeSelectQuery([{"symbol": "AAPL"}, {"symbol": "MSFT"}])
        if table_name == "fundamentals":
            return FakeSelectQuery(self.fundamental_rows)
        if table_name == "audit_log":
            return FakeInsertQuery(self.inserts)
        raise AssertionError(f"Unexpected table requested: {table_name}")


class FakePricesAdapter:
    def __init__(self) -> None:
        self.saved_rows: list[dict] = []

    def fetch_daily_bars(self, symbols: list[str], start: date, end: date) -> list[dict]:
        assert symbols == ["AAPL", "MSFT", "SPY"]
        assert start < end
        return [{"symbol": symbol} for symbol in symbols]

    def save_bars(self, rows: list[dict]) -> int:
        self.saved_rows = rows
        return len(rows)


class FakeFundamentalsAdapter:
    def __init__(self) -> None:
        self.synced: list[str] = []

    def sync_symbol(self, symbol: str) -> dict:
        self.synced.append(symbol)
        return {"symbol": symbol}


class FakeNewsAdapter:
    def __init__(self) -> None:
        self.saved = 0

    def fetch_news(self, symbol: str, start: date, end: date) -> list[dict]:
        assert start <= end
        return [{"symbol": symbol, "url": f"https://example.com/{symbol.lower()}"}]

    def save_articles(self, rows: list[dict]) -> int:
        self.saved += len(rows)
        return len(rows)


def test_run_nightly_ingest_orchestrates_all_stages() -> None:
    db = FakeDB()
    prices = FakePricesAdapter()
    fundamentals = FakeFundamentalsAdapter()
    news = FakeNewsAdapter()

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=fundamentals,
        news_adapter=news,
        now=datetime(2026, 5, 4, 2, 0, tzinfo=UTC),
        refresh_universe_from_screener=False,
    )

    assert summary["symbols"] == 2
    assert summary["fundamental_targets"] == 2
    assert summary["price_rows"] == 3
    assert summary["fundamental_rows"] == 2
    assert summary["news_rows"] == 2
    assert len(db.inserts) == 3
    assert prices.saved_rows == [{"symbol": "AAPL"}, {"symbol": "MSFT"}, {"symbol": "SPY"}]
    assert fundamentals.synced == ["AAPL", "MSFT"]


def test_select_fundamental_refresh_symbols_prioritizes_missing_then_stale() -> None:
    db = FakeDB(
        fundamental_rows=[
            {"symbol": "AAPL", "fetched_at": "2026-05-04T00:00:00+00:00"},
            {"symbol": "MSFT", "fetched_at": "2026-04-01T00:00:00+00:00"},
        ]
    )

    symbols = _select_fundamental_refresh_symbols(db, ["AAPL", "MSFT", "NVDA"], refresh_limit=2)

    assert symbols == ["NVDA", "MSFT"]


def test_refresh_universe_reports_degraded_state_when_screener_is_unavailable() -> None:
    class BrokenScreener:
        def screen(self, top_n=None):
            raise FmpScreenerUnavailableError("fmp_unavailable")

    result = refresh_universe(FakeDB(), "strategy-1", BrokenScreener())

    assert result["status"] == "degraded_existing_universe"
    assert result["symbols"] == ["AAPL", "MSFT"]


def test_run_nightly_ingest_allows_zero_refresh_targets_when_budgeted(monkeypatch) -> None:
    db = FakeDB(
        fundamental_rows=[
            {"symbol": "AAPL", "fetched_at": "2026-05-04T00:00:00+00:00"},
            {"symbol": "MSFT", "fetched_at": "2026-05-04T00:00:00+00:00"},
        ]
    )
    prices = FakePricesAdapter()
    fundamentals = FakeFundamentalsAdapter()
    news = FakeNewsAdapter()

    monkeypatch.setattr(
        nightly_ingest,
        "settings",
        replace(nightly_ingest.settings, fundamentals_refresh_limit=0),
    )

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=fundamentals,
        news_adapter=news,
        now=datetime(2026, 5, 4, 2, 0, tzinfo=UTC),
        refresh_universe_from_screener=False,
    )

    assert summary["fundamental_targets"] == 0
    assert summary["fundamental_rows"] == 0
    assert fundamentals.synced == []
