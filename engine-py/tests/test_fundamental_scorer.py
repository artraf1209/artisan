from __future__ import annotations

from artisan.scorers.fundamental import FundamentalScorer


class FakeQuery:
    def __init__(self, row: dict | None) -> None:
        self.row = row

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = True):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        data = [self.row] if self.row else []
        return type("Response", (), {"data": data})()


class FakeDB:
    def __init__(self, row: dict | None) -> None:
        self.row = row

    def table(self, table_name: str) -> FakeQuery:
        assert table_name == "fundamentals"
        return FakeQuery(self.row)


def test_fundamental_scorer_handles_strong_company() -> None:
    scorer = FundamentalScorer(
        db=FakeDB({"pe_ratio": 18, "pb_ratio": 4, "roe": 0.22, "debt_equity": 0.6})
    )

    result = scorer.score_symbol("AAPL")

    assert result["f_score"] > 0.6
    assert result["input_count"] == 4


def test_fundamental_scorer_handles_partial_data() -> None:
    scorer = FundamentalScorer(db=FakeDB({"pe_ratio": None, "pb_ratio": None, "roe": 0.1, "debt_equity": None}))

    result = scorer.score_symbol("AAPL")

    assert result["input_count"] == 1
    assert 0 <= result["f_score"] <= 1
