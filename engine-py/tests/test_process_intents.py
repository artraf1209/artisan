from __future__ import annotations

from artisan.jobs.process_intents import IntentExecutor


class FakeResponse:
    def __init__(self, payload: dict, *, is_success: bool = True) -> None:
        self._payload = payload
        self.is_success = is_success

    def json(self) -> dict:
        return self._payload


class FakeQuery:
    def __init__(self, table_name: str, db: "FakeDB") -> None:
        self.table_name = table_name
        self.db = db
        self._status_filter: str | None = None
        self._update_payload: dict | None = None
        self._entity_id: str | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        if column == "status":
            self._status_filter = value
        if column == "id":
            self._entity_id = value
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def update(self, payload: dict):
        self._update_payload = payload
        return self

    def insert(self, payload: dict):
        self.db.audit_rows.append(payload)
        return self

    def execute(self):
        if self.table_name == "trade_intents" and self._update_payload is None:
            rows = self.db.intents
            if self._status_filter is not None:
                rows = [row for row in rows if row.get("status") == self._status_filter]
            return type("Response", (), {"data": rows})()

        if self.table_name == "trade_intents" and self._update_payload is not None:
            for row in self.db.intents:
                if self._entity_id is None or row["id"] == self._entity_id:
                    row.update(self._update_payload)
            self.db.updates.append({"id": self._entity_id, "payload": self._update_payload})
            return type("Response", (), {"data": []})()

        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self) -> None:
        self.intents = [
            {
                "id": "intent-1",
                "signal_id": "rec-1",
                "account_id": "account-1",
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 10,
                "status": "scheduled",
            }
        ]
        self.updates: list[dict] = []
        self.audit_rows: list[dict] = []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self)


def test_execute_intent_posts_v2_trade_intent_payload(monkeypatch) -> None:
    captured: dict = {}

    def fake_post(url: str, *, json: dict, headers: dict):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return FakeResponse({"success": True, "status": "submitted"})

    monkeypatch.setattr("artisan.jobs.process_intents.httpx.post", fake_post)

    executor = IntentExecutor(db=FakeDB())
    result = executor.execute_intent(executor.db.intents[0])

    assert result["status"] == "submitted"
    assert captured["json"] == {"trade_intent_id": "intent-1"}


def test_run_leaves_market_closed_intents_scheduled() -> None:
    db = FakeDB()
    executor = IntentExecutor(db=db)

    def fake_execute(_intent: dict) -> dict:
        raise RuntimeError("market_closed: market closed")

    executor.execute_intent = fake_execute  # type: ignore[method-assign]

    summary = executor.run()

    assert summary["market_closed"] == 1
    assert summary["failed"] == 0
    assert db.intents[0]["status"] == "scheduled"
    assert db.audit_rows == []


def test_run_rejects_non_market_closed_failures() -> None:
    db = FakeDB()
    executor = IntentExecutor(db=db)

    def fake_execute(_intent: dict) -> dict:
        raise RuntimeError("other: insufficient state")

    executor.execute_intent = fake_execute  # type: ignore[method-assign]

    summary = executor.run()

    assert summary["failed"] == 1
    assert db.intents[0]["status"] == "rejected"
    assert db.audit_rows[0]["action"] == "execute_failed"
