from __future__ import annotations

from datetime import UTC, datetime

from artisan.llm.daily_briefing import DailyBriefingAnalyst


class FakeQuery:
    def __init__(self, table_name: str, db: "FakeDB") -> None:
        self.table_name = table_name
        self.db = db
        self.inserted_row: dict | None = None

    def select(self, _fields: str):
        return self

    def gte(self, _column: str, _value: str):
        return self

    def eq(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def insert(self, row: dict):
        self.db.inserts.append({"table": self.table_name, "row": row})
        self.inserted_row = row
        return self

    def execute(self):
        if self.inserted_row is not None:
            return type("Response", (), {"data": [self.inserted_row]})()
        if self.table_name == "signal_events":
            return type("Response", (), {"data": self.db.signals})()
        if self.table_name == "trade_intents":
            return type("Response", (), {"data": self.db.intents})()
        if self.table_name == "trade_executions":
            return type("Response", (), {"data": self.db.executions})()
        if self.table_name == "news_articles":
            return type("Response", (), {"data": self.db.headlines})()
        if self.table_name == "audit_log":
            return type("Response", (), {"data": []})()
        raise AssertionError(f"Unexpected table: {self.table_name}")


class FakeDB:
    def __init__(self) -> None:
        self.signals = [
            {
                "id": "signal-1",
                "symbol": "AAPL",
                "status": "pending",
                "direction": "long",
                "composite_score": 0.71,
                "f_score": 0.8,
                "t_score": 0.7,
                "s_score": 0.5,
                "created_at": "2026-05-04T13:30:00+00:00",
            }
        ]
        self.intents = [
            {
                "id": "intent-1",
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 10,
                "dollar_value": 1900,
                "status": "pending",
                "created_at": "2026-05-04T14:00:00+00:00",
            }
        ]
        self.executions = [
            {
                "id": "execution-1",
                "intent_id": "intent-1",
                "status": "filled",
                "filled_qty": 10,
                "filled_price": 191.5,
                "filled_at": "2026-05-04T14:30:00+00:00",
                "created_at": "2026-05-04T14:30:00+00:00",
            }
        ]
        self.headlines = [
            {
                "symbol": "AAPL",
                "headline": "Apple demand remains strong",
                "source": "Reuters",
                "vader_compound": 0.72,
                "published_at": "2026-05-04T11:00:00+00:00",
            }
        ]
        self.inserts: list[dict] = []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self)


class FakeUsage:
    input_tokens = 180
    output_tokens = 90
    cache_read_input_tokens = 0


class FakeMessage:
    model = "claude-haiku-4-5-20251001"
    usage = FakeUsage()
    content = [
        {
            "type": "text",
            "text": "AAPL remains the strongest recent name based on composite scoring and supportive headlines. One pending intent and one filled execution confirm recent activity. Watch whether positive demand headlines continue into today.",
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


def test_daily_briefing_creates_one_briefing_row() -> None:
    db = FakeDB()
    client = FakeClient()
    analyst = DailyBriefingAnalyst(db=db, client=client)

    summary = analyst.run(now=datetime(2026, 5, 5, 11, 30, tzinfo=UTC))

    assert summary["briefing_created"] is True
    insert = next(item for item in db.inserts if item["table"] == "llm_analyses")
    assert insert["row"]["analysis_type"] == "briefing"
    assert insert["row"]["signal_id"] is None
    assert "AAPL" in insert["row"]["content"]


def test_daily_briefing_prompt_uses_repo_data_inputs() -> None:
    prompt = DailyBriefingAnalyst.build_user_prompt(
        briefing_date=datetime(2026, 5, 5, tzinfo=UTC).date(),
        signals=[
            {
                "symbol": "AAPL",
                "status": "pending",
                "direction": "long",
                "composite_score": 0.71,
                "f_score": 0.8,
                "t_score": 0.7,
                "s_score": 0.5,
            }
        ],
        intents=[],
        executions=[],
        headlines=[{"symbol": "AAPL", "headline": "Apple demand remains strong", "source": "Reuters", "vader_compound": 0.72}],
    )

    assert "AAPL" in prompt
    assert "0.7100" in prompt
    assert "Apple demand remains strong" in prompt
