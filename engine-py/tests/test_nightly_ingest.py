from __future__ import annotations

from datetime import UTC, date, datetime

from artisan.jobs.nightly_ingest import run_nightly_ingest


class FakeSelectQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str):
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
    def __init__(self) -> None:
        self.inserts: list[dict] = []

    def table(self, table_name: str):
        if table_name == "universes":
            return FakeSelectQuery([{"symbol": "AAPL"}, {"symbol": "MSFT"}])
        if table_name == "audit_log":
            return FakeInsertQuery(self.inserts)
        raise AssertionError(f"Unexpected table requested: {table_name}")


class FakePricesAdapter:
    def __init__(self) -> None:
        self.saved_rows: list[dict] = []

    def fetch_daily_bars(self, symbols: list[str], start: date, end: date) -> list[dict]:
        assert symbols == ["AAPL", "MSFT"]
        assert start < end
        return [{"symbol": "AAPL"}, {"symbol": "MSFT"}]

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
    )

    assert summary["symbols"] == 2
    assert summary["price_rows"] == 2
    assert summary["fundamental_rows"] == 2
    assert summary["news_rows"] == 2
    assert len(db.inserts) == 3
    assert prices.saved_rows == [{"symbol": "AAPL"}, {"symbol": "MSFT"}]
    assert fundamentals.synced == ["AAPL", "MSFT"]
