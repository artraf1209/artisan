from __future__ import annotations

from datetime import UTC, datetime

from artisan.llm.thesis_analyst import ThesisAnalyst


class FakeSelectQuery:
    def __init__(self, table_name: str, db: "FakeDB") -> None:
        self.table_name = table_name
        self.db = db
        self.inserted_row: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        if self.table_name == "signal_events" and column == "status":
            self.db.signal_status = value
        if self.table_name == "llm_analyses" and column == "analysis_type":
            self.db.analysis_type = value
        if self.table_name == "news_articles" and column == "symbol":
            self.db.news_symbol = value
        return self

    def gte(self, _column: str, _value: str):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        if self.inserted_row is not None:
            return type("Response", (), {"data": [self.inserted_row]})()
        if self.table_name == "signal_events":
            return type("Response", (), {"data": self.db.pending_signals})()
        if self.table_name == "llm_analyses":
            return type("Response", (), {"data": self.db.existing_analyses})()
        if self.table_name == "news_articles":
            return type("Response", (), {"data": self.db.headlines})()
        if self.table_name == "audit_log":
            return type("Response", (), {"data": []})()
        raise AssertionError(f"Unexpected select table: {self.table_name}")

    def insert(self, row: dict):
        self.db.inserts.append({"table": self.table_name, "row": row})
        self.inserted_row = row
        return self


class FakeDB:
    def __init__(self) -> None:
        self.pending_signals = [
            {
                "id": "signal-1",
                "symbol": "AAPL",
                "direction": "long",
                "composite_score": 0.7123,
                "f_score": 0.8,
                "t_score": 0.7,
                "s_score": 0.5,
                "pillars_passed": 2,
                "stop_price": 182.5,
                "target_price": 204.0,
                "atr_at_signal": 5.75,
                "earnings_blackout": False,
                "created_at": "2026-05-04T13:30:00+00:00",
            }
        ]
        self.existing_analyses: list[dict] = []
        self.headlines = [
            {
                "headline": "Apple demand stays resilient",
                "source": "Reuters",
                "vader_compound": 0.63,
                "published_at": "2026-05-04T10:00:00+00:00",
            }
        ]
        self.inserts: list[dict] = []
        self.signal_status = None
        self.analysis_type = None
        self.news_symbol = None

    def table(self, table_name: str) -> FakeSelectQuery:
        return FakeSelectQuery(table_name, self)


class FakeUsage:
    input_tokens = 120
    output_tokens = 80
    cache_read_input_tokens = 0


class FakeMessage:
    model = "claude-haiku-4-5-20251001"
    usage = FakeUsage()
    content = [
        {
            "type": "text",
            "text": "AAPL scores well on fundamentals and technicals. Recent headlines are supportive. Invalidate if price breaks below the stop or the positive news tone reverses.",
        }
    ]


class FakeMessagesAPI:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeMessage()


class FakeClient:
    def __init__(self) -> None:
        self.messages = FakeMessagesAPI()


def test_thesis_analyst_creates_one_thesis_per_pending_signal() -> None:
    db = FakeDB()
    client = FakeClient()
    analyst = ThesisAnalyst(db=db, client=client)

    summary = analyst.run(now=datetime(2026, 5, 4, 14, 0, tzinfo=UTC))

    assert summary["theses_created"] == 1
    thesis_insert = next(item for item in db.inserts if item["table"] == "llm_analyses")
    assert thesis_insert["row"]["analysis_type"] == "thesis"
    assert thesis_insert["row"]["signal_id"] == "signal-1"
    assert thesis_insert["row"]["model"] == "claude-haiku-4-5-20251001"
    assert "invalidate" in thesis_insert["row"]["content"].lower()


def test_thesis_analyst_skips_existing_thesis_rows() -> None:
    db = FakeDB()
    db.existing_analyses = [{"signal_id": "signal-1"}]
    client = FakeClient()
    analyst = ThesisAnalyst(db=db, client=client)

    summary = analyst.run(now=datetime(2026, 5, 4, 14, 0, tzinfo=UTC))

    assert summary["theses_created"] == 0
    assert summary["signals_skipped"] == 1
    assert client.messages.calls == []


def test_build_user_prompt_uses_actual_signal_inputs() -> None:
    signal = {
        "id": "signal-1",
        "symbol": "AAPL",
        "direction": "long",
        "composite_score": 0.7123,
        "f_score": 0.8,
        "t_score": 0.7,
        "s_score": 0.5,
        "pillars_passed": 2,
        "stop_price": 182.5,
        "target_price": 204.0,
        "atr_at_signal": 5.75,
        "earnings_blackout": False,
        "created_at": "2026-05-04T13:30:00+00:00",
    }
    prompt = ThesisAnalyst.build_user_prompt(
        signal,
        [{"headline": "Apple demand stays resilient", "source": "Reuters", "vader_compound": 0.63}],
    )

    assert "AAPL" in prompt
    assert "0.7123" in prompt
    assert "Apple demand stays resilient" in prompt
