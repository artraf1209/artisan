from __future__ import annotations

from datetime import datetime, timedelta

from artisan.scorers.technical import TechnicalScorer


class FakePriceQuery:
    def __init__(self, rows: list[dict], upserts: list[dict]) -> None:
        self.rows = rows
        self.upserts = upserts

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()

    def upsert(self, row, on_conflict: str):
        self.upserts.append({"row": row, "on_conflict": on_conflict})
        return self


class FakeDB:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.upserts: list[dict] = []

    def table(self, table_name: str) -> FakePriceQuery:
        assert table_name in {"price_bars", "indicator_values"}
        return FakePriceQuery(self.rows if table_name == "price_bars" else [], self.upserts)


def _price_rows(trend_up: bool = True, count: int = 220) -> list[dict]:
    start = datetime(2025, 1, 1)
    rows: list[dict] = []
    price = 100.0
    for idx in range(count):
        price += 0.4 if trend_up else -0.2
        rows.append(
            {
                "symbol": "AAPL",
                "bar_time": (start + timedelta(days=idx)).isoformat(),
                "open": price - 1,
                "high": price + 1,
                "low": price - 2,
                "close": price,
                "volume": 1000000 + idx,
                "vwap": price - 0.3,
            }
        )
    return rows


def test_technical_scorer_returns_bullish_score_for_rising_trend() -> None:
    scorer = TechnicalScorer(db=FakeDB(_price_rows(trend_up=True)))

    result = scorer.score_symbol("AAPL", computed_at="2026-05-04T13:30:00+00:00")

    assert result["t_score"] >= 0.5
    assert result["sma_200"] is not None


def test_technical_scorer_handles_short_history_gracefully() -> None:
    scorer = TechnicalScorer(db=FakeDB(_price_rows(count=10)))

    result = scorer.score_symbol("AAPL", computed_at="2026-05-04T13:30:00+00:00")

    assert result["rsi_14"] is None
    assert result["t_score"] == 0.0 or result["t_score"] == 0.5
