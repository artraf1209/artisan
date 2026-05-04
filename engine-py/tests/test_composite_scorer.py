from __future__ import annotations

from artisan.scorers.composite import CompositeScorer


class FakeQuery:
    def __init__(self, table_name: str, strategy: dict, saves: list[dict]) -> None:
        self.table_name = table_name
        self.strategy = strategy
        self.saves = saves

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def limit(self, _limit: int):
        return self

    def upsert(self, row, on_conflict: str):
        self.saves.append({"row": row, "on_conflict": on_conflict})
        return self

    def execute(self):
        if self.table_name == "strategies":
            return type("Response", (), {"data": [self.strategy]})()
        return type("Response", (), {"data": [self.saves[-1]["row"]]})()


class FakeDB:
    def __init__(self, strategy: dict) -> None:
        self.strategy = strategy
        self.saves: list[dict] = []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self.strategy, self.saves)


def test_composite_scorer_uses_strategy_weights_and_threshold() -> None:
    strategy = {
        "id": "strategy-1",
        "f_weight": 0.5,
        "t_weight": 0.25,
        "s_weight": 0.25,
        "threshold": 0.55,
    }
    scorer = CompositeScorer(db=FakeDB(strategy))

    row = scorer.score_symbol(
        symbol="AAPL",
        strategy=strategy,
        f_score=0.8,
        t_score=0.6,
        s_score=0.4,
        scored_at="2026-05-04T13:30:00+00:00",
    )

    assert row["composite"] == 0.65
    assert row["pillars_passed"] == 2
