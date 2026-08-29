from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from artisan.jobs.reconcile_trades import (
    TradeReconciler,
    map_execution_status,
    map_intent_status,
)


class _Query:
    def __init__(self, table_name: str, db: "FakeDB") -> None:
        self.table_name = table_name
        self.db = db
        self.rows = db.tables.setdefault(table_name, [])
        self._filters: list[tuple[str, str, object]] = []  # (op, column, value)
        self._or_filter: str | None = None
        self._select_fields: str | None = None
        self._insert_row: dict | None = None
        self._update_fields: dict | None = None
        self._upsert_row: dict | None = None
        self._upsert_on_conflict: str | None = None
        self._delete = False

    def select(self, fields: str):
        self._select_fields = fields
        return self

    def eq(self, column: str, value):
        self._filters.append(("eq", column, value))
        return self

    def lt(self, column: str, value):
        self._filters.append(("lt", column, value))
        return self

    def in_(self, column: str, values):
        self._filters.append(("in", column, list(values)))
        return self

    def or_(self, filter_string: str):
        self._or_filter = filter_string
        return self

    def order(self, column: str, desc: bool = False):
        self.rows = sorted(self.rows, key=lambda r: r.get(column) or "", reverse=desc)
        return self

    def limit(self, n: int):
        self.rows = self.rows[:n]
        return self

    def range(self, start: int, end: int):
        self.rows = self.rows[start : end + 1]
        return self

    def insert(self, row: dict):
        self._insert_row = dict(row)
        return self

    def update(self, fields: dict):
        self._update_fields = fields
        return self

    def upsert(self, row: dict, on_conflict: str):
        self._upsert_row = dict(row)
        self._upsert_on_conflict = on_conflict
        return self

    def delete(self):
        self._delete = True
        return self

    def _matches(self, row: dict) -> bool:
        for op, column, value in self._filters:
            if op == "eq" and row.get(column) != value:
                return False
            if op == "lt" and not (row.get(column) is not None and row.get(column) < value):
                return False
            if op == "in" and row.get(column) not in value:
                return False
        if self._or_filter is not None:
            if not self._matches_or(row, self._or_filter):
                return False
        return True

    @staticmethod
    def _matches_or(row: dict, filter_string: str) -> bool:
        # Narrow parser for exactly the shape this job issues:
        # "status.eq.scheduled,and(status.eq.failed,retry_count.lt.3)"
        for clause in _split_or_clauses(filter_string):
            if clause.startswith("and(") and clause.endswith(")"):
                sub_clauses = clause[4:-1].split(",")
                if all(_matches_simple_clause(row, sub) for sub in sub_clauses):
                    return True
            elif _matches_simple_clause(row, clause):
                return True
        return False

    def _embed(self, row: dict) -> dict:
        if not self._select_fields or "trade_intents(" not in self._select_fields:
            return row
        embedded = dict(row)
        intents = self.db.tables.get("trade_intents", [])
        match = next((i for i in intents if i["id"] == row.get("intent_id")), None)
        embedded["trade_intents"] = dict(match) if match else None
        return embedded

    def execute(self):
        if self._insert_row is not None:
            row = dict(self._insert_row)
            row.setdefault("id", f"generated-{len(self.rows)}")
            self.rows.append(row)
            return type("Response", (), {"data": [row]})()

        if self._upsert_row is not None:
            key_cols = self._upsert_on_conflict.split(",")
            existing = next(
                (r for r in self.rows if all(r.get(c) == self._upsert_row.get(c) for c in key_cols)),
                None,
            )
            if existing:
                existing.update(self._upsert_row)
                return type("Response", (), {"data": [existing]})()
            row = dict(self._upsert_row)
            row.setdefault("id", f"generated-{len(self.rows)}")
            self.rows.append(row)
            return type("Response", (), {"data": [row]})()

        matched = [r for r in self.rows if self._matches(r)]

        if self._delete:
            for row in matched:
                self.rows.remove(row)
            return type("Response", (), {"data": matched})()

        if self._update_fields is not None:
            for row in matched:
                row.update(self._update_fields)
            return type("Response", (), {"data": matched})()

        return type("Response", (), {"data": [self._embed(r) for r in matched]})()


def _split_or_clauses(filter_string: str) -> list[str]:
    clauses: list[str] = []
    depth = 0
    current = ""
    for ch in filter_string:
        if ch == "," and depth == 0:
            clauses.append(current)
            current = ""
            continue
        if ch == "(":
            depth += 1
        if ch == ")":
            depth -= 1
        current += ch
    if current:
        clauses.append(current)
    return clauses


def _matches_simple_clause(row: dict, clause: str) -> bool:
    column, op, value = clause.split(".", 2)
    if op == "eq":
        return str(row.get(column)) == value
    if op == "lt":
        return row.get(column) is not None and row.get(column) < type(row.get(column))(value)
    raise ValueError(f"unsupported clause: {clause}")


class FakeDB:
    def __init__(self, tables: dict[str, list[dict]] | None = None) -> None:
        self.tables = tables or {}

    def table(self, name: str) -> _Query:
        return _Query(name, self)


class FakeOrdersAdapter:
    def __init__(self, orders: dict[str, dict] | None = None, positions: dict[str, dict] | None = None) -> None:
        self.orders_by_id = orders or {}
        self.positions = positions or {}
        self.get_order_calls: list[str] = []

    def get_order(self, order_id: str) -> dict:
        self.get_order_calls.append(order_id)
        order = self.orders_by_id[order_id]
        hops = 0
        while order.get("replaced_by") and hops < 5:
            order = self.orders_by_id[order["replaced_by"]]
            hops += 1
        return order

    def get_order_by_client_order_id(self, client_order_id: str) -> dict | None:
        for order in self.orders_by_id.values():
            if order.get("client_order_id") == client_order_id:
                return order
        return None

    def get_position(self, symbol: str) -> dict | None:
        return self.positions.get(symbol)

    def get_all_positions(self) -> list[dict]:
        return list(self.positions.values())


def _now() -> datetime:
    return datetime.now(UTC)


def test_map_execution_status_covers_every_alpaca_status() -> None:
    assert map_execution_status("filled") == "filled"
    assert map_execution_status("partially_filled") == "partial"
    assert map_execution_status("rejected") == "rejected"
    assert map_execution_status("canceled") == "cancelled"
    assert map_execution_status("cancelled") == "cancelled"
    for status in ("expired", "done_for_day", "stopped", "suspended"):
        assert map_execution_status(status) == "expired"
    for status in ("new", "accepted", "pending_new", "accepted_for_bidding", "calculated", "pending_cancel", "pending_replace", None):
        assert map_execution_status(status) == "pending"


def test_map_intent_status_derives_partial_from_expired_with_fill() -> None:
    assert map_intent_status("expired", 0) == "expired"
    assert map_intent_status("expired", None) == "expired"
    assert map_intent_status("expired", 5) == "partial"
    assert map_intent_status("filled", 10) == "filled"
    assert map_intent_status("partial", 3) == "submitted"
    assert map_intent_status("pending", None) == "submitted"
    assert map_intent_status("rejected", None) == "rejected"
    assert map_intent_status("cancelled", None) == "cancelled"


class TestSubmissionPass:
    def test_picks_up_scheduled_and_under_cap_failed_skips_at_cap(self, monkeypatch) -> None:
        db = FakeDB({
            "trade_intents": [
                {"id": "i-scheduled", "status": "scheduled", "symbol": "AAPL", "retry_count": 0},
                {"id": "i-failed-under-cap", "status": "failed", "symbol": "MSFT", "retry_count": 2},
                {"id": "i-failed-at-cap", "status": "failed", "symbol": "TSLA", "retry_count": 3},
                {"id": "i-submitted", "status": "submitted", "symbol": "NVDA", "retry_count": 0},
            ],
        })
        reconciler = TradeReconciler(db=db, orders_adapter=FakeOrdersAdapter())
        submittable = reconciler.fetch_submittable_intents()
        assert {row["id"] for row in submittable} == {"i-scheduled", "i-failed-under-cap"}

    def test_successful_response_is_never_re_derived_or_rewritten(self, monkeypatch) -> None:
        """Regression test: process_intents.py used to force any non-'filled' response
        back to 'submitted', silently clobbering a legitimate 'rejected' outcome.
        execute-trade now fully owns status resolution -- this job must leave it alone."""
        db = FakeDB({"trade_intents": [{"id": "i-1", "status": "scheduled", "symbol": "AAPL", "retry_count": 0}]})
        reconciler = TradeReconciler(db=db, orders_adapter=FakeOrdersAdapter())

        def fake_post(url, *, json, headers, timeout):
            # Simulate execute-trade already having resolved this to 'rejected'.
            db.tables["trade_intents"][0]["status"] = "rejected"
            return type("R", (), {"json": lambda self: {"success": False, "status": "rejected"}})()

        monkeypatch.setattr("artisan.jobs.reconcile_trades.httpx.post", fake_post)
        reconciler.run_submission_pass()

        assert db.tables["trade_intents"][0]["status"] == "rejected"

    def test_market_closed_response_left_untouched(self, monkeypatch) -> None:
        db = FakeDB({"trade_intents": [{"id": "i-1", "status": "scheduled", "symbol": "AAPL", "retry_count": 0}]})
        reconciler = TradeReconciler(db=db, orders_adapter=FakeOrdersAdapter())

        def fake_post(url, *, json, headers, timeout):
            db.tables["trade_intents"][0]["status"] = "scheduled"
            return type("R", (), {"json": lambda self: {"success": False, "status": "scheduled", "error_type": "market_closed"}})()

        monkeypatch.setattr("artisan.jobs.reconcile_trades.httpx.post", fake_post)
        summary = reconciler.run_submission_pass()

        assert db.tables["trade_intents"][0]["status"] == "scheduled"
        assert summary["edge_function_errors"] == 0

    def test_edge_function_unreachable_logs_audit_and_leaves_status(self, monkeypatch) -> None:
        db = FakeDB({
            "trade_intents": [{"id": "i-1", "status": "scheduled", "symbol": "AAPL", "retry_count": 0}],
            "audit_log": [],
        })
        reconciler = TradeReconciler(db=db, orders_adapter=FakeOrdersAdapter())

        def fake_post(url, *, json, headers, timeout):
            raise ConnectionError("network down")

        monkeypatch.setattr("artisan.jobs.reconcile_trades.httpx.post", fake_post)
        summary = reconciler.run_submission_pass()

        assert summary["edge_function_errors"] == 1
        assert db.tables["trade_intents"][0]["status"] == "scheduled"
        assert db.tables["audit_log"][0]["action"] == "submit_edge_function_error"


class TestOrphanSweep:
    def _stuck_intent(self, **overrides) -> dict:
        base = {
            "id": "i-1", "status": "submitting", "symbol": "AAPL", "retry_count": 0,
            "account_id": "acct-1", "side": "buy", "signal_id": "rec-1", "stop_price": 90.0,
            "quantity": 10, "last_attempted_at": (_now() - timedelta(minutes=20)).isoformat(),
            "order_class": "simple", "overrides": None,
        }
        base.update(overrides)
        return base

    def test_adopts_order_found_via_client_order_id(self) -> None:
        db = FakeDB({
            "trade_intents": [self._stuck_intent()],
            "trade_executions": [],
            "portfolio_positions": [],
        })
        adapter = FakeOrdersAdapter(
            orders={"o-1": {"id": "o-1", "client_order_id": "i-1", "status": "filled", "filled_qty": "10", "filled_avg_price": "100"}},
            positions={"AAPL": {"qty": "10", "avg_entry_price": "100", "current_price": "101", "unrealized_pl": "10"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_orphan_sweep()

        assert summary["adopted"] == 1
        assert db.tables["trade_intents"][0]["status"] == "filled"
        assert db.tables["trade_executions"][0]["broker_order_id"] == "o-1"

    def test_confirmed_not_found_marks_failed_and_bumps_retry_count(self) -> None:
        db = FakeDB({"trade_intents": [self._stuck_intent(retry_count=1)], "audit_log": []})
        reconciler = TradeReconciler(db=db, orders_adapter=FakeOrdersAdapter(orders={}))
        summary = reconciler.run_orphan_sweep()

        assert summary["marked_failed"] == 1
        assert db.tables["trade_intents"][0]["status"] == "failed"
        assert db.tables["trade_intents"][0]["retry_count"] == 2

    def test_inconclusive_lookup_leaves_submitting(self) -> None:
        class BrokenAdapter(FakeOrdersAdapter):
            def get_order_by_client_order_id(self, client_order_id: str):
                raise ConnectionError("alpaca unreachable")

        db = FakeDB({"trade_intents": [self._stuck_intent()]})
        reconciler = TradeReconciler(db=db, orders_adapter=BrokenAdapter())
        summary = reconciler.run_orphan_sweep()

        assert summary["inconclusive"] == 1
        assert db.tables["trade_intents"][0]["status"] == "submitting"


class TestPollPass:
    def _open_execution(self, **overrides) -> dict:
        base = {
            "id": "e-1", "intent_id": "i-1", "broker_order_id": "o-1",
            "status": "pending", "filled_qty": None, "leg_type": None,
        }
        base.update(overrides)
        return base

    def _intent(self, **overrides) -> dict:
        base = {
            "id": "i-1", "account_id": "acct-1", "symbol": "AAPL", "side": "buy",
            "status": "submitted", "order_class": "simple", "overrides": None,
            "signal_id": "rec-1", "stop_price": 90.0, "quantity": 10,
        }
        base.update(overrides)
        return base

    def test_updates_on_new_fill_data(self) -> None:
        db = FakeDB({
            "trade_executions": [self._open_execution()],
            "trade_intents": [self._intent()],
            "portfolio_positions": [],
            "recommendations": [{"id": "rec-1", "target_price": 120.0, "status": "approved"}],
            "decision_outcomes": [{"id": "do-1", "source_type": "recommendation", "source_id": "rec-1", "mode": "shadow", "resolution": "still_open"}],
        })
        adapter = FakeOrdersAdapter(
            orders={"o-1": {"id": "o-1", "status": "filled", "filled_qty": "10", "filled_avg_price": "100"}},
            positions={"AAPL": {"qty": "10", "avg_entry_price": "100", "current_price": "101", "unrealized_pl": "10"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_poll_pass()

        assert summary["updated"] == 1
        assert db.tables["trade_executions"][0]["status"] == "filled"
        assert db.tables["trade_intents"][0]["status"] == "filled"
        assert db.tables["recommendations"][0]["status"] == "executed"
        assert len(db.tables["portfolio_positions"]) == 1

    def test_noop_on_unchanged_status_and_no_duplicate_sync(self) -> None:
        db = FakeDB({
            "trade_executions": [self._open_execution(status="partial", filled_qty=5)],
            "trade_intents": [self._intent(status="submitted")],
            "portfolio_positions": [{"account_id": "acct-1", "symbol": "AAPL", "quantity": 5}],
        })
        adapter = FakeOrdersAdapter(
            orders={"o-1": {"id": "o-1", "status": "partially_filled", "filled_qty": "5", "filled_avg_price": "100"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_poll_pass()

        assert summary["unchanged"] == 1
        assert summary["updated"] == 0

    def test_replaced_order_updates_broker_order_id(self) -> None:
        db = FakeDB({
            "trade_executions": [self._open_execution()],
            "trade_intents": [self._intent()],
            "portfolio_positions": [],
            "recommendations": [{"id": "rec-1", "target_price": 120.0, "status": "approved"}],
        })
        adapter = FakeOrdersAdapter(
            orders={
                "o-1": {"id": "o-1", "status": "replaced", "replaced_by": "o-2"},
                "o-2": {"id": "o-2", "status": "filled", "filled_qty": "10", "filled_avg_price": "100"},
            },
            positions={"AAPL": {"qty": "10", "avg_entry_price": "100"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_poll_pass()

        assert db.tables["trade_executions"][0]["broker_order_id"] == "o-2"

    def test_expired_with_fill_becomes_partial_and_alerts(self, monkeypatch) -> None:
        alerts: list[dict] = []
        monkeypatch.setattr(
            "artisan.jobs.reconcile_trades.send_alert",
            lambda **kwargs: alerts.append(kwargs),
        )
        db = FakeDB({
            "trade_executions": [self._open_execution(status="partial", filled_qty=6)],
            "trade_intents": [self._intent(status="submitted", quantity=10)],
            "portfolio_positions": [],
            "recommendations": [{"id": "rec-1", "target_price": 120.0, "status": "approved"}],
        })
        adapter = FakeOrdersAdapter(
            orders={"o-1": {"id": "o-1", "status": "expired", "filled_qty": "6", "filled_avg_price": "100"}},
            positions={"AAPL": {"qty": "6", "avg_entry_price": "100"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_poll_pass()

        assert db.tables["trade_intents"][0]["status"] == "partial"
        assert db.tables["recommendations"][0]["status"] == "approved"  # never flipped for partial
        assert len(alerts) == 1
        assert alerts[0]["trigger"] == "trade_reconciliation"

    def test_expired_with_zero_fill_expires_recommendation(self) -> None:
        db = FakeDB({
            "trade_executions": [self._open_execution()],
            "trade_intents": [self._intent(status="submitted")],
            "portfolio_positions": [],
            "recommendations": [{"id": "rec-1", "target_price": 120.0, "status": "approved"}],
        })
        adapter = FakeOrdersAdapter(
            orders={"o-1": {"id": "o-1", "status": "expired", "filled_qty": "0"}},
            positions={},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_poll_pass()

        assert db.tables["trade_intents"][0]["status"] == "expired"
        assert db.tables["recommendations"][0]["status"] == "expired"

    def test_stop_loss_leg_fill_resolves_decision_outcome_hit_stop(self) -> None:
        db = FakeDB({
            "trade_executions": [self._open_execution(broker_order_id="stop-1", leg_type="stop_loss")],
            "trade_intents": [self._intent(status="filled", side="sell")],
            "portfolio_positions": [],
            "decision_outcomes": [{
                "id": "do-1", "source_type": "recommendation", "source_id": "rec-1", "mode": "real",
                "resolution": "still_open", "entry_price_reference": 100.0, "stop_price": 90.0,
                "created_at": (_now() - timedelta(days=5)).isoformat(),
            }],
        })
        adapter = FakeOrdersAdapter(
            orders={"stop-1": {"id": "stop-1", "status": "filled", "filled_qty": "10", "filled_avg_price": "89.5"}},
            positions={},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_poll_pass()

        outcome = db.tables["decision_outcomes"][0]
        assert outcome["resolution"] == "hit_stop"
        assert outcome["r_multiple"] is not None

    def test_sibling_leg_cancellation_is_not_alerted(self, monkeypatch) -> None:
        alerts: list[dict] = []
        monkeypatch.setattr(
            "artisan.jobs.reconcile_trades.send_alert",
            lambda **kwargs: alerts.append(kwargs),
        )
        db = FakeDB({
            "trade_executions": [self._open_execution(broker_order_id="target-1", leg_type="take_profit")],
            "trade_intents": [self._intent(status="filled", side="sell")],
        })
        adapter = FakeOrdersAdapter(
            orders={"target-1": {"id": "target-1", "status": "canceled", "filled_qty": "0"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_poll_pass()

        assert db.tables["trade_executions"][0]["status"] == "cancelled"
        assert alerts == []


class TestPositionRefreshPass:
    def _db_position(self, **overrides) -> dict:
        base = {
            "id": "pos-1", "account_id": "acct-1", "symbol": "AAPL", "quantity": 10.0,
            "avg_entry_price": 100.0, "current_price": 100.0, "unrealized_pnl": 0.0,
            "stop_price": 90.0, "target_price": 120.0, "signal_id": "rec-1",
            "entry_order_id": "entry-1", "stop_order_id": "stop-1", "target_order_id": "target-1",
        }
        base.update(overrides)
        return base

    def test_refreshes_price_and_pnl_with_no_pending_order(self) -> None:
        # A position with zero rows in trade_executions/trade_intents (no order
        # activity at all right now) must still get its price/PnL refreshed.
        db = FakeDB({"portfolio_positions": [self._db_position()]})
        adapter = FakeOrdersAdapter(
            positions={"AAPL": {"symbol": "AAPL", "qty": "10", "avg_entry_price": "100", "current_price": "115", "unrealized_pl": "150"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_position_refresh_pass()

        assert summary == {"db_positions": 1, "refreshed": 1, "closed": 0, "orphans_alerted": 0, "errors": 0}
        position = db.tables["portfolio_positions"][0]
        assert position["current_price"] == 115.0
        assert position["unrealized_pnl"] == 150.0

    def test_leaves_risk_fields_and_order_ids_untouched(self) -> None:
        db = FakeDB({"portfolio_positions": [self._db_position()]})
        adapter = FakeOrdersAdapter(
            positions={"AAPL": {"symbol": "AAPL", "qty": "10", "avg_entry_price": "100", "current_price": "115", "unrealized_pl": "150"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        reconciler.run_position_refresh_pass()

        position = db.tables["portfolio_positions"][0]
        assert position["stop_price"] == 90.0
        assert position["target_price"] == 120.0
        assert position["signal_id"] == "rec-1"
        assert position["entry_order_id"] == "entry-1"
        assert position["stop_order_id"] == "stop-1"
        assert position["target_order_id"] == "target-1"

    def test_deletes_position_alpaca_no_longer_reports(self) -> None:
        db = FakeDB({"portfolio_positions": [self._db_position()]})
        adapter = FakeOrdersAdapter(positions={})  # Alpaca reports nothing for AAPL
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_position_refresh_pass()

        assert summary["closed"] == 1
        assert db.tables["portfolio_positions"] == []

    def test_alerts_on_orphan_broker_position_without_fabricating_a_row(self, monkeypatch) -> None:
        alerts: list[dict] = []
        monkeypatch.setattr(
            "artisan.jobs.reconcile_trades.send_alert",
            lambda **kwargs: alerts.append(kwargs),
        )
        db = FakeDB({"portfolio_positions": [], "audit_log": []})
        adapter = FakeOrdersAdapter(
            positions={"MSFT": {"symbol": "MSFT", "qty": "5", "avg_entry_price": "300", "current_price": "310", "unrealized_pl": "50"}},
        )
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_position_refresh_pass()

        assert summary["orphans_alerted"] == 1
        assert db.tables["portfolio_positions"] == []  # never fabricated
        assert len(alerts) == 1
        assert "MSFT" in alerts[0]["message"]
        assert db.tables["audit_log"][0]["action"] == "orphan_broker_position_detected"

    def test_noop_when_nothing_open_anywhere(self) -> None:
        db = FakeDB({"portfolio_positions": []})
        adapter = FakeOrdersAdapter(positions={})
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_position_refresh_pass()

        assert summary == {"db_positions": 0, "refreshed": 0, "closed": 0, "orphans_alerted": 0, "errors": 0}

    def test_orphan_detection_runs_even_with_zero_db_positions(self, monkeypatch) -> None:
        # The Alpaca call (and therefore orphan detection) must not be skipped just
        # because our own DB currently has nothing to refresh.
        alerts: list[dict] = []
        monkeypatch.setattr(
            "artisan.jobs.reconcile_trades.send_alert",
            lambda **kwargs: alerts.append(kwargs),
        )
        db = FakeDB({"portfolio_positions": [], "audit_log": []})
        adapter = FakeOrdersAdapter(positions={"MSFT": {"symbol": "MSFT", "qty": "5"}})
        reconciler = TradeReconciler(db=db, orders_adapter=adapter)
        summary = reconciler.run_position_refresh_pass()

        assert summary["orphans_alerted"] == 1
        assert len(alerts) == 1
