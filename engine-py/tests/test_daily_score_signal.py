from __future__ import annotations

from datetime import UTC, datetime

from artisan.jobs.daily_score_signal import run_daily_score_signal


class FakeUniverseQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeStrategyQuery(FakeUniverseQuery):
    pass


class FakeInsertQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def insert(self, row: dict):
        self.rows.append(row)
        return self

    def execute(self):
        return type("Response", (), {"data": []})()


class FakePriceQuery:
    def __init__(self, symbol: str) -> None:
        self.symbol = symbol

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        if self.symbol == "fundamentals":
            return type(
                "Response",
                (),
                {"data": [{"symbol": "AAPL", "pe_ratio": 18, "pb_ratio": 4, "roe": 0.22, "debt_equity": 0.6, "earnings_date": "2026-05-20"}]},
            )()
        return type(
            "Response",
            (),
            {
                "data": [
                    {
                        "symbol": "AAPL",
                        "bar_time": f"2025-01-{(idx % 28) + 1:02d}T00:00:00+00:00",
                        "open": 100 + idx,
                        "high": 101 + idx,
                        "low": 99 + idx,
                        "close": 100 + idx,
                        "volume": 1000 + idx,
                        "vwap": 100 + idx,
                    }
                    for idx in range(220)
                ]
            },
        )()


class FakeNewsQuery:
    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def gte(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = True):
        return self

    def execute(self):
        return type(
            "Response",
            (),
            {
                "data": [
                    {
                        "headline": "Positive demand",
                        "summary": "Demand improved",
                        "vader_compound": 0.7,
                        "published_at": "2026-05-04T10:00:00+00:00",
                    }
                ]
            },
        )()


class FakeUpsertQuery:
    def __init__(self, table_name: str, saves: list[dict]) -> None:
        self.table_name = table_name
        self.saves = saves

    def upsert(self, row, on_conflict: str):
        self.saves.append({"table": self.table_name, "row": row, "on_conflict": on_conflict})
        return self

    def insert(self, row: dict):
        self.saves.append({"table": self.table_name, "row": row})
        return self

    def execute(self):
        row = self.saves[-1]["row"]
        return type("Response", (), {"data": [row] if isinstance(row, dict) else []})()


class FakeDB:
    def __init__(self) -> None:
        self.saves: list[dict] = []

    def table(self, table_name: str):
        if table_name == "universes":
            return FakeUniverseQuery([{"symbol": "AAPL"}])
        if table_name == "strategies":
            return FakeStrategyQuery(
                [
                    {
                        "id": "strategy-1",
                        "f_weight": 0.5,
                        "t_weight": 0.25,
                        "s_weight": 0.25,
                        "threshold": 0.55,
                    }
                ]
            )
        if table_name == "price_bars":
            return FakePriceQuery("price_bars")
        if table_name == "fundamentals":
            return FakePriceQuery("fundamentals")
        if table_name == "news_articles":
            return FakeNewsQuery()
        if table_name in {"indicator_values", "composite_scores", "signal_events", "audit_log"}:
            return FakeUpsertQuery(table_name, self.saves)
        raise AssertionError(f"Unexpected table: {table_name}")


def test_daily_score_signal_creates_pending_signal_summary() -> None:
    summary = run_daily_score_signal(
        db=FakeDB(),
        now=datetime(2026, 5, 4, 13, 30, tzinfo=UTC),
    )

    assert summary["symbols"] == 1
    assert summary["indicators"] == 1
    assert summary["composite_scores"] == 1
    assert summary["signals_created"] == 1
