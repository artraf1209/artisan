from __future__ import annotations

from datetime import UTC, datetime, timedelta

from artisan.scorers.sentiment import SentimentScorer


class FakeQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def gte(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = True):
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeDB:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def table(self, table_name: str) -> FakeQuery:
        assert table_name == "news_articles"
        return FakeQuery(self.rows)


def test_sentiment_scorer_returns_neutral_when_no_news() -> None:
    scorer = SentimentScorer(db=FakeDB([]))

    result = scorer.score_symbol("AAPL", now=datetime(2026, 5, 4, tzinfo=UTC))

    assert result["s_score"] == 0.5
    assert result["headline_count"] == 0


def test_sentiment_scorer_weights_recent_positive_news_higher() -> None:
    now = datetime(2026, 5, 4, tzinfo=UTC)
    rows = [
        {"vader_compound": -0.6, "published_at": (now - timedelta(hours=60)).isoformat()},
        {"vader_compound": 0.8, "published_at": (now - timedelta(hours=2)).isoformat()},
    ]
    scorer = SentimentScorer(db=FakeDB(rows))

    result = scorer.score_symbol("AAPL", now=now)

    assert result["s_score"] > 0.5
    assert result["headline_count"] == 2
