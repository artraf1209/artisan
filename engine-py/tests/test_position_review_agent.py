from __future__ import annotations

from datetime import UTC, datetime

import pytest

import artisan.agents.position_review as position_review


class _Query:
    def __init__(self, rows: list[dict], insert_sink: list[dict] | None = None) -> None:
        self.rows = rows  # shared mutable reference to the table's row list
        self.insert_sink = insert_sink
        self._filters: dict[str, object] = {}
        self._insert_row: dict | None = None
        self._update_fields: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        self._filters[column] = value
        return self

    def order(self, column: str, desc: bool = False):
        self.rows = sorted(self.rows, key=lambda r: r.get(column) or "", reverse=desc)
        return self

    def limit(self, n: int):
        self.rows = self.rows[:n]
        return self

    def insert(self, row: dict):
        self._insert_row = row
        return self

    def update(self, fields: dict):
        self._update_fields = fields
        return self

    def _matches(self, row: dict) -> bool:
        return all(row.get(k) == v for k, v in self._filters.items())

    def execute(self):
        if self._insert_row is not None:
            row = dict(self._insert_row)
            row.setdefault("id", f"generated-{len(self.insert_sink) if self.insert_sink is not None else 0}")
            if self.insert_sink is not None:
                self.insert_sink.append(row)
            return type("Response", (), {"data": [row]})()
        matched = [r for r in self.rows if self._matches(r)]
        if self._update_fields is not None:
            for row in matched:
                row.update(self._update_fields)
            return type("Response", (), {"data": matched})()
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(self, table_rows: dict[str, list[dict]]) -> None:
        self.table_rows = table_rows
        self.position_reviews_inserted: list[dict] = []
        self.trade_intents_inserted: list[dict] = []
        self.agent_analyses_inserted: list[dict] = []

    def table(self, name: str):
        sinks = {
            "position_reviews": self.position_reviews_inserted,
            "trade_intents": self.trade_intents_inserted,
            "agent_analyses": self.agent_analyses_inserted,
        }
        return _Query(self.table_rows.setdefault(name, []), sinks.get(name))


NOW = datetime(2026, 6, 1, tzinfo=UTC)
RUN_ID = "run-1"


def _base_tables(opened_at: str = "2026-05-20T00:00:00+00:00") -> dict[str, list[dict]]:
    return {
        "portfolio_positions": [
            {
                "id": "pos-1", "account_id": "acct-1", "symbol": "AAPL", "quantity": 10,
                "avg_entry_price": 100.0, "stop_price": 90.0, "target_price": 130.0,
                "signal_id": "rec-1", "opened_at": opened_at,
            }
        ],
        "price_bars": [{"symbol": "AAPL", "close": 110.0, "bar_time": "2026-06-01T00:00:00+00:00"}],
        "indicator_values": [{"symbol": "AAPL", "atr_14": 3.0, "computed_at": "2026-06-01T00:00:00+00:00"}],
        "recommendations": [
            {"id": "rec-1", "thesis": "clean pullback", "entry_price": 100.0, "stop_price": 90.0,
             "target_price": 130.0, "effective_horizon_days": 20, "setup_type": "pullback",
             "created_at": "2026-05-20T00:00:00+00:00"}
        ],
        "fundamentals": [],
        "regime_snapshots": [{"regime": "risk_on", "run_id": RUN_ID}],
        "portfolio_snapshots": [{"equity": 100_000.0, "drawdown_from_high_pct": -0.02, "snapshot_date": "2026-06-01"}],
    }


def _review(**overrides) -> dict:
    row = {
        "position_id": "pos-1",
        "symbol": "AAPL",
        "recommended_action": "hold",
        "reasoning": "thesis still holds",
        "suggested_new_stop": None,
        "suggested_new_target": None,
        "historical_precedent": "no relevant history found",
    }
    row.update(overrides)
    return row


def _run_agent_result(reviews: list[dict], tool_calls: list[dict] | None = None) -> dict:
    return {
        "output": {"position_reviews": reviews},
        "tool_calls": tool_calls or [{"name": "query_decision_history", "input": {"symbol": "AAPL"}}],
        "prompt_tokens": 1500, "output_tokens": 400, "cache_read_tokens": 200,
    }


@pytest.mark.asyncio
async def test_hold_writes_executed_status_with_no_side_effects(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(position_review, "run_agent", lambda *a, **k: _run_agent_result([_review()]))

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert len(result["reviews"]) == 1
    assert result["reviews"][0]["recommended_action"] == "hold"
    assert result["reviews"][0]["status"] == "executed"
    assert db.trade_intents_inserted == []
    assert result["available_risk_budget"] > 0


@pytest.mark.asyncio
async def test_close_creates_sell_trade_intent_and_executes_immediately(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="close", reasoning="invalidation triggered")]),
    )

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    row = result["reviews"][0]
    assert row["recommended_action"] == "close"
    assert row["status"] == "executed"  # auto-applied, never 'pending' for the /queue
    assert len(db.trade_intents_inserted) == 1
    intent = db.trade_intents_inserted[0]
    assert intent["side"] == "sell"
    assert intent["symbol"] == "AAPL"
    assert intent["quantity"] == 10
    assert intent["signal_id"] == "rec-1"


@pytest.mark.asyncio
async def test_trim_executes_immediately_without_trade_intent(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="trim", reasoning="trim into strength")]),
    )

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["status"] == "executed"
    assert db.trade_intents_inserted == []  # no share count available to size a real sell


@pytest.mark.asyncio
async def test_tighten_stop_applies_immediately_when_valid(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="tighten_stop", suggested_new_stop=105.0)]),
    )

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["status"] == "executed"
    assert result["reviews"][0]["new_stop_price"] == 105.0
    updated_position = next(p for p in db.table_rows["portfolio_positions"] if p["id"] == "pos-1")
    assert updated_position["stop_price"] == 105.0


@pytest.mark.asyncio
async def test_tighten_stop_no_op_when_suggested_stop_is_looser(monkeypatch, strategy_params) -> None:
    # position starts at stop=90.0, but the pre-step trailing ratchet moves it to
    # 104.0 first (breakeven + ATR trail against price=110/atr=3 before the agent
    # even runs) -- a suggested_new_stop of 80.0 is looser than that and must be
    # rejected as a no-op, not compared against the stale original 90.0.
    db = FakeDB(_base_tables())
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="tighten_stop", suggested_new_stop=80.0)]),
    )

    await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    updated_position = next(p for p in db.table_rows["portfolio_positions"] if p["id"] == "pos-1")
    assert updated_position["stop_price"] == 104.0  # ratcheted value preserved, LLM's looser suggestion rejected


@pytest.mark.asyncio
async def test_add_downgraded_to_hold_when_veto_fires(monkeypatch, strategy_params) -> None:
    tables = _base_tables()
    # 15 open positions at max_concurrent_positions=15 -> ADD trips max_concurrent_positions veto
    tables["portfolio_positions"] = tables["portfolio_positions"] + [
        {"id": f"pos-extra-{i}", "account_id": "acct-1", "symbol": f"X{i}", "quantity": 1,
         "avg_entry_price": 10.0, "stop_price": 9.0, "target_price": 12.0, "signal_id": None,
         "opened_at": "2026-05-25T00:00:00+00:00"}
        for i in range(14)
    ]
    db = FakeDB(tables)
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="add", reasoning="add on strength")]),
    )

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    aapl_review = next(r for r in result["reviews"] if r["symbol"] == "AAPL")
    assert aapl_review["recommended_action"] == "hold"
    assert aapl_review["status"] == "executed"


@pytest.mark.asyncio
async def test_add_without_veto_stays_pending_for_queue(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(
        position_review, "run_agent",
        lambda *a, **k: _run_agent_result([_review(recommended_action="add", reasoning="add on strength")]),
    )

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["recommended_action"] == "add"
    assert result["reviews"][0]["status"] == "pending"
    assert db.trade_intents_inserted == []  # ADD needs human approval first, no intent created here


@pytest.mark.asyncio
async def test_day30_override_forces_close_on_hold(monkeypatch, strategy_params) -> None:
    # opened 31 days before NOW -> past the 30-day ceiling
    db = FakeDB(_base_tables(opened_at="2026-05-01T00:00:00+00:00"))
    monkeypatch.setattr(position_review, "run_agent", lambda *a, **k: _run_agent_result([_review(recommended_action="hold")]))

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["recommended_action"] == "close"
    assert len(db.trade_intents_inserted) == 1


@pytest.mark.asyncio
async def test_day30_override_forces_close_on_add(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables(opened_at="2026-05-01T00:00:00+00:00"))
    monkeypatch.setattr(position_review, "run_agent", lambda *a, **k: _run_agent_result([_review(recommended_action="add")]))

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["recommended_action"] == "close"
    assert result["reviews"][0]["status"] == "executed"


@pytest.mark.asyncio
async def test_day30_override_does_not_touch_already_valid_trim(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables(opened_at="2026-05-01T00:00:00+00:00"))
    monkeypatch.setattr(position_review, "run_agent", lambda *a, **k: _run_agent_result([_review(recommended_action="trim")]))

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"][0]["recommended_action"] == "trim"


@pytest.mark.asyncio
async def test_no_open_positions_returns_empty_and_still_computes_budget(monkeypatch, strategy_params) -> None:
    tables = _base_tables()
    tables["portfolio_positions"] = []
    db = FakeDB(tables)

    result = await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)

    assert result["reviews"] == []
    assert result["available_risk_budget"] == pytest.approx(100_000.0 * strategy_params.max_portfolio_heat_pct)


@pytest.mark.asyncio
async def test_missing_field_raises(monkeypatch, strategy_params) -> None:
    from artisan.agents.base import AgentOutputError

    db = FakeDB(_base_tables())
    bad = {k: v for k, v in _review().items() if k != "historical_precedent"}
    monkeypatch.setattr(position_review, "run_agent", lambda *a, **k: _run_agent_result([bad]))

    with pytest.raises(AgentOutputError, match="historical_precedent"):
        await position_review.review_positions(run_id=RUN_ID, strategy_params=strategy_params, db=db, client=object(), now=NOW)
