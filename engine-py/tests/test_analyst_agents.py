from __future__ import annotations

import pytest

import artisan.agents.fundamental_analyst as fundamental_analyst
import artisan.agents.sentiment_analyst as sentiment_analyst
import artisan.agents.technical_analyst as technical_analyst
from artisan.agents.base import AgentOutputError


class FakeSelectQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value):
        return self

    def gte(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, n: int):
        self.rows = self.rows[:n]
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeInsertQuery:
    def __init__(self, sink: list[dict]) -> None:
        self.sink = sink

    def insert(self, row: dict):
        self.sink.append(row)
        return self

    def execute(self):
        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self, table_rows: dict[str, list[dict]]) -> None:
        self.table_rows = table_rows
        self.inserted_agent_analyses: list[dict] = []

    def table(self, name: str):
        if name == "agent_analyses":
            return FakeInsertQuery(self.inserted_agent_analyses)
        if name in self.table_rows:
            return FakeSelectQuery(list(self.table_rows[name]))
        raise AssertionError(f"Unexpected table: {name}")


VALID_FUNDAMENTAL_OUTPUT = {
    "symbol": "AAPL",
    "summary": "Cheap on FCF yield, quality mediocre.",
    "key_drivers": ["value", "growth"],
    "quality_assessment": "medium",
    "red_flags": [],
    "trend_vs_prior_run": "improving",
    "historical_precedent": "no relevant history found",
}

VALID_TECHNICAL_OUTPUT = {
    "symbol": "AAPL",
    "summary": "Clean pullback to the 50-day.",
    "setup_quality": "strong",
    "confirmation_strength": "volume and MACD both confirming",
    "technical_invalidation_note": "close below SMA50 invalidates",
    "regime_fit": "fits well in risk_on",
    "historical_precedent": "no relevant history found",
}

VALID_SENTIMENT_OUTPUT = {
    "symbol": "AAPL",
    "summary": "Quiet news window, nothing material.",
    "sentiment_direction": "neutral",
    "materiality": "none",
    "catalysts_identified": [],
    "red_flags": [],
    "historical_precedent": "no relevant history found",
}


def _run_agent_result(output: dict) -> dict:
    return {"output": output, "prompt_tokens": 500, "output_tokens": 150, "cache_read_tokens": 100}


class TestFundamentalAnalyst:
    @pytest.mark.asyncio
    async def test_writes_agent_analyses_row_on_valid_output(self, monkeypatch) -> None:
        db = FakeDB(
            {
                "factor_scores": [{"value_z": 1.2, "quality_z": 0.1, "rank": 3, "hard_filter_pass": True}],
                "fundamentals": [{"period_end": "2025-12-31", "revenue": 100.0}],
                "assets": [{"sector": "Tech", "industry": "Software", "exchange": "NASDAQ"}],
            }
        )
        monkeypatch.setattr(
            fundamental_analyst, "run_agent", lambda *a, **k: _run_agent_result(VALID_FUNDAMENTAL_OUTPUT)
        )

        output = await fundamental_analyst.analyze(
            "AAPL", run_id="run-1", strategy_id="strategy-1", db=db, client=object()
        )

        assert output == VALID_FUNDAMENTAL_OUTPUT
        assert len(db.inserted_agent_analyses) == 1
        row = db.inserted_agent_analyses[0]
        assert row["run_id"] == "run-1"
        assert row["symbol"] == "AAPL"
        assert row["agent_type"] == "fundamental"
        assert row["output"] == VALID_FUNDAMENTAL_OUTPUT
        assert row["prompt_tokens"] == 500
        assert row["cost_usd"] is not None

    @pytest.mark.asyncio
    async def test_raises_on_missing_historical_precedent(self, monkeypatch) -> None:
        db = FakeDB({"factor_scores": [], "fundamentals": [], "assets": []})
        bad_output = {k: v for k, v in VALID_FUNDAMENTAL_OUTPUT.items() if k != "historical_precedent"}
        monkeypatch.setattr(fundamental_analyst, "run_agent", lambda *a, **k: _run_agent_result(bad_output))

        with pytest.raises(AgentOutputError, match="historical_precedent"):
            await fundamental_analyst.analyze("AAPL", run_id="run-1", strategy_id="strategy-1", db=db, client=object())

        assert db.inserted_agent_analyses == []

    @pytest.mark.asyncio
    async def test_raises_on_missing_required_field_other_than_precedent(self, monkeypatch) -> None:
        db = FakeDB({"factor_scores": [], "fundamentals": [], "assets": []})
        bad_output = {k: v for k, v in VALID_FUNDAMENTAL_OUTPUT.items() if k != "quality_assessment"}
        monkeypatch.setattr(fundamental_analyst, "run_agent", lambda *a, **k: _run_agent_result(bad_output))

        with pytest.raises(AgentOutputError, match="quality_assessment"):
            await fundamental_analyst.analyze("AAPL", run_id="run-1", strategy_id="strategy-1", db=db, client=object())


class TestTechnicalAnalyst:
    @pytest.mark.asyncio
    async def test_writes_agent_analyses_row_on_valid_output(self, monkeypatch) -> None:
        db = FakeDB(
            {
                "entry_signals": [{"setup_type": "pullback", "actionable": True}],
                "indicator_values": [{"rsi_14": 45.0, "adx_14": 25.0}],
                "regime_snapshots": [{"regime": "risk_on"}],
            }
        )
        monkeypatch.setattr(
            technical_analyst, "run_agent", lambda *a, **k: _run_agent_result(VALID_TECHNICAL_OUTPUT)
        )

        output = await technical_analyst.analyze(
            "AAPL", run_id="run-1", strategy_id="strategy-1", db=db, client=object()
        )

        assert output == VALID_TECHNICAL_OUTPUT
        assert len(db.inserted_agent_analyses) == 1
        assert db.inserted_agent_analyses[0]["agent_type"] == "technical"

    @pytest.mark.asyncio
    async def test_raises_on_missing_historical_precedent(self, monkeypatch) -> None:
        db = FakeDB({"entry_signals": [], "indicator_values": [], "regime_snapshots": []})
        bad_output = {k: v for k, v in VALID_TECHNICAL_OUTPUT.items() if k != "historical_precedent"}
        monkeypatch.setattr(technical_analyst, "run_agent", lambda *a, **k: _run_agent_result(bad_output))

        with pytest.raises(AgentOutputError, match="historical_precedent"):
            await technical_analyst.analyze("AAPL", run_id="run-1", strategy_id="strategy-1", db=db, client=object())

        assert db.inserted_agent_analyses == []


class TestSentimentAnalyst:
    @pytest.mark.asyncio
    async def test_writes_agent_analyses_row_on_valid_output(self, monkeypatch) -> None:
        db = FakeDB(
            {
                "news_articles": [
                    {"headline": "Co beats on earnings", "summary": "...", "source": "Reuters",
                     "published_at": "2026-05-01T00:00:00+00:00", "vader_compound": 0.4}
                ],
            }
        )
        monkeypatch.setattr(
            sentiment_analyst, "run_agent", lambda *a, **k: _run_agent_result(VALID_SENTIMENT_OUTPUT)
        )

        output = await sentiment_analyst.analyze("AAPL", run_id="run-1", db=db, client=object())

        assert output == VALID_SENTIMENT_OUTPUT
        assert len(db.inserted_agent_analyses) == 1
        assert db.inserted_agent_analyses[0]["agent_type"] == "sentiment"

    @pytest.mark.asyncio
    async def test_raises_on_missing_historical_precedent(self, monkeypatch) -> None:
        db = FakeDB({"news_articles": []})
        bad_output = {k: v for k, v in VALID_SENTIMENT_OUTPUT.items() if k != "historical_precedent"}
        monkeypatch.setattr(sentiment_analyst, "run_agent", lambda *a, **k: _run_agent_result(bad_output))

        with pytest.raises(AgentOutputError, match="historical_precedent"):
            await sentiment_analyst.analyze("AAPL", run_id="run-1", db=db, client=object())

        assert db.inserted_agent_analyses == []

    @pytest.mark.asyncio
    async def test_handles_empty_news_window(self, monkeypatch) -> None:
        db = FakeDB({"news_articles": []})
        monkeypatch.setattr(
            sentiment_analyst, "run_agent", lambda *a, **k: _run_agent_result(VALID_SENTIMENT_OUTPUT)
        )

        output = await sentiment_analyst.analyze("AAPL", run_id="run-1", db=db, client=object())

        assert output["materiality"] == "none"
