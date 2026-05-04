from __future__ import annotations

from artisan.execution.alpaca_executor import TradeExecutor


class FakeIntentQuery:
    def __init__(self, table_name: str, db: "FakeDB") -> None:
        self.table_name = table_name
        self.db = db
        self.payload = None

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def update(self, payload: dict):
        self.payload = payload
        self.db.actions.append({"table": self.table_name, "action": "update", "payload": payload})
        return self

    def insert(self, payload: dict):
        self.payload = payload
        self.db.actions.append({"table": self.table_name, "action": "insert", "payload": payload})
        return self

    def upsert(self, payload: dict, on_conflict: str):
        self.payload = payload
        self.db.actions.append(
            {"table": self.table_name, "action": "upsert", "payload": payload, "on_conflict": on_conflict}
        )
        return self

    def execute(self):
        if self.table_name == "trade_intents" and self.payload is None:
            return type("Response", (), {"data": self.db.intents})()
        if self.table_name == "signal_events" and self.payload is None:
            return type("Response", (), {"data": [self.db.signal]})()
        if self.table_name == "trade_executions" and self.payload is not None:
            return type("Response", (), {"data": [self.payload]})()
        return type("Response", (), {"data": []})()


class FakeDB:
    def __init__(self) -> None:
        self.intents = [
            {
                "id": "intent-1",
                "signal_id": "signal-1",
                "account_id": "account-1",
                "symbol": "AAPL",
                "side": "buy",
                "quantity": 10,
                "dollar_value": 1900,
                "order_type": "market",
                "stop_price": 182.5,
                "status": "pending",
                "created_at": "2026-05-04T14:00:00+00:00",
            }
        ]
        self.signal = {"id": "signal-1", "symbol": "AAPL", "target_price": 204.0, "stop_price": 182.5}
        self.actions: list[dict] = []

    def table(self, table_name: str) -> FakeIntentQuery:
        return FakeIntentQuery(table_name, self)


class FilledBroker:
    def submit_order(self, intent: dict):
        return {
            "id": "order-1",
            "status": "filled",
            "filled_qty": "10",
            "filled_avg_price": "191.5",
            "filled_at": "2026-05-04T14:30:00+00:00",
        }

    def get_account(self) -> dict:
        return {"equity": "100000.00", "cash": "95000.00"}

    def get_position(self, symbol: str) -> dict | None:
        return {
            "symbol": symbol,
            "qty": "10",
            "avg_entry_price": "191.5",
            "current_price": "191.5",
            "unrealized_pl": "0",
        }


class RejectingBroker:
    def submit_order(self, intent: dict):
        raise RuntimeError("insufficient buying power")

    def get_account(self) -> dict:
        return {"equity": "100000.00", "cash": "95000.00"}

    def get_position(self, symbol: str) -> dict | None:
        return None


def test_trade_executor_persists_filled_execution_and_position() -> None:
    db = FakeDB()
    executor = TradeExecutor(db=db, broker=FilledBroker())

    summary = executor.run()

    assert summary["filled"] == 1
    execution_insert = next(
        action for action in db.actions if action["table"] == "trade_executions" and action["action"] == "insert"
    )
    assert execution_insert["payload"]["status"] == "filled"
    position_upsert = next(
        action for action in db.actions if action["table"] == "portfolio_positions" and action["action"] == "upsert"
    )
    assert position_upsert["payload"]["symbol"] == "AAPL"
    assert position_upsert["on_conflict"] == "account_id,symbol"


def test_trade_executor_persists_rejected_execution() -> None:
    db = FakeDB()
    executor = TradeExecutor(db=db, broker=RejectingBroker())

    summary = executor.run()

    assert summary["rejected"] == 1
    execution_insert = next(
        action for action in db.actions if action["table"] == "trade_executions" and action["action"] == "insert"
    )
    assert execution_insert["payload"]["status"] == "rejected"
    assert "insufficient buying power" in execution_insert["payload"]["raw_response"]["error"]
