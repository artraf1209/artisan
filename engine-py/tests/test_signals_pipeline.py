from __future__ import annotations

from datetime import UTC, datetime

from artisan.pipeline.signals import SignalPipeline


class FakeInsertQuery:
    def __init__(self, table_name: str, inserts: list[dict], latest_price: float | None = None) -> None:
        self.table_name = table_name
        self.inserts = inserts
        self.latest_price = latest_price

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = True):
        return self

    def limit(self, _limit: int):
        return self

    def insert(self, row: dict):
        self.inserts.append({"table": self.table_name, "row": row})
        return self

    def execute(self):
        if self.table_name == "price_bars":
            return type("Response", (), {"data": [{"close": self.latest_price}] if self.latest_price else []})()
        if self.table_name == "signal_events":
            return type("Response", (), {"data": [self.inserts[-1]["row"]]})()
        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self, latest_price: float | None = 120.0) -> None:
        self.inserts: list[dict] = []
        self.latest_price = latest_price

    def table(self, table_name: str):
        return FakeInsertQuery(table_name, self.inserts, latest_price=self.latest_price)


def test_signal_pipeline_creates_pending_signal_when_passed() -> None:
    db = FakeDB()
    pipeline = SignalPipeline(db=db)

    signal = pipeline.process_symbol(
        strategy={"id": "strategy-1", "threshold": 0.55},
        composite_row={
            "id": "score-1",
            "symbol": "AAPL",
            "f_score": 0.8,
            "t_score": 0.7,
            "s_score": 0.4,
            "composite": 0.675,
            "pillars_passed": 2,
        },
        indicator_row={"close": 120.0, "atr_14": 5.0},
        fundamental_row={"earnings_date": "2026-05-20"},
        now=datetime(2026, 5, 4, tzinfo=UTC),
    )

    assert signal is not None
    assert signal["status"] == "pending"
    assert signal["stop_price"] == 110.0
    assert signal["target_price"] == 135.0


def test_signal_pipeline_vetoes_earnings_blackout() -> None:
    db = FakeDB()
    pipeline = SignalPipeline(db=db)

    signal = pipeline.process_symbol(
        strategy={"id": "strategy-1", "threshold": 0.55},
        composite_row={
            "id": "score-1",
            "symbol": "AAPL",
            "f_score": 0.8,
            "t_score": 0.7,
            "s_score": 0.6,
            "composite": 0.725,
            "pillars_passed": 3,
        },
        indicator_row={"close": 120.0, "atr_14": 5.0},
        fundamental_row={"earnings_date": "2026-05-06"},
        now=datetime(2026, 5, 4, tzinfo=UTC),
    )

    assert signal is None
