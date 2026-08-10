from __future__ import annotations

from dataclasses import replace

import pytest

import artisan.agents.synthesis as synthesis


class _Query:
    def __init__(self, rows: list[dict], insert_sink: list[dict] | None) -> None:
        self.rows = list(rows)
        self.insert_sink = insert_sink
        self._filters: dict[str, object] = {}
        self._in_filters: dict[str, set] = {}
        self._insert_row: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        self._filters[column] = value
        return self

    def in_(self, column: str, values):
        self._in_filters[column] = set(values)
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

    def _matches(self, row: dict) -> bool:
        for k, v in self._filters.items():
            if row.get(k) != v:
                return False
        for k, vals in self._in_filters.items():
            if row.get(k) not in vals:
                return False
        return True

    def execute(self):
        if self._insert_row is not None:
            row = dict(self._insert_row)
            row.setdefault("id", f"generated-{len(self.insert_sink)}")
            self.insert_sink.append(row)
            return type("Response", (), {"data": [row]})()
        matched = [r for r in self.rows if self._matches(r)]
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(self, table_rows: dict[str, list[dict]]) -> None:
        self.table_rows = table_rows
        self.recommendations_inserted: list[dict] = []
        self.decision_outcomes_inserted: list[dict] = []
        self.agent_analyses_inserted: list[dict] = []

    def table(self, name: str):
        sinks = {
            "recommendations": self.recommendations_inserted,
            "decision_outcomes": self.decision_outcomes_inserted,
            "agent_analyses": self.agent_analyses_inserted,
        }
        return _Query(self.table_rows.get(name, []), sinks.get(name))


RUN_ID = "run-1"
STRATEGY_ID = "strategy-1"


def _base_tables() -> dict[str, list[dict]]:
    return {
        "regime_snapshots": [{"regime": "risk_on", "run_id": RUN_ID}],
        "factor_scores": [
            {"symbol": "AAPL", "sector": "Tech", "composite_z": 1.5, "rank": 1, "hard_filter_pass": True,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
            {"symbol": "MSFT", "sector": "Tech", "composite_z": 1.2, "rank": 2, "hard_filter_pass": True,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
            {"symbol": "TSLA", "sector": "Auto", "composite_z": 0.8, "rank": 3, "hard_filter_pass": True,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        ],
        "entry_signals": [
            {"symbol": "AAPL", "setup_type": "pullback", "actionable": True, "entry_price": 200.0,
             "stop_price": 190.0, "target_price": 230.0, "atr": 5.0, "effective_horizon_days": 20,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
            {"symbol": "MSFT", "setup_type": "breakout", "actionable": True, "entry_price": 400.0,
             "stop_price": 380.0, "target_price": 460.0, "atr": 10.0, "effective_horizon_days": 15,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
            {"symbol": "TSLA", "setup_type": None, "actionable": False, "entry_price": None,
             "stop_price": None, "target_price": None, "atr": None, "effective_horizon_days": None,
             "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        ],
        "agent_analyses": [],
        "portfolio_positions": [],
        "assets": [{"symbol": "AAPL", "sector": "Tech"}, {"symbol": "MSFT", "sector": "Tech"}],
        "portfolio_snapshots": [
            {"equity": 100_000.0, "drawdown_from_high_pct": -0.02, "trailing_return_pct": 0.10,
             "snapshot_date": "2026-06-01"}
        ],
    }


VALID_RECOMMENDATION = {
    "action": "enter",
    "conviction": "high",
    "thesis": "Strong setup with quality backing.",
    "invalidation_conditions": ["close below SMA50"],
    "redundancy_note": "no existing Tech exposure",
    "historical_precedent": "no relevant history found",
}


def _run_agent_result(output: dict, tool_calls: list[dict] | None = None) -> dict:
    return {
        "output": output,
        "tool_calls": tool_calls or [],
        "prompt_tokens": 2000,
        "output_tokens": 800,
        "cache_read_tokens": 500,
    }


@pytest.mark.asyncio
async def test_happy_path_writes_recommendations_and_shadow_outcomes(monkeypatch, strategy_params) -> None:
    # cutoff for risk_on with a 3-symbol shortlist -> round(3*0.10)=0 -> max(1,0)=1
    # so only AAPL (rank 1) is enter-eligible; MSFT/TSLA fall to watch-eligible.
    db = FakeDB(_base_tables())
    output = {
        "recommendations": [
            {**VALID_RECOMMENDATION, "symbol": "AAPL"},
            {**VALID_RECOMMENDATION, "symbol": "MSFT", "action": "watch", "conviction": "medium"},
            {**VALID_RECOMMENDATION, "symbol": "TSLA", "action": "skip", "conviction": "low"},
        ]
    }
    monkeypatch.setattr(
        synthesis, "run_agent",
        lambda *a, **k: _run_agent_result(output, tool_calls=[{"name": "query_decision_history", "input": {"symbol": "AAPL"}}]),
    )

    result = await synthesis.synthesize(
        run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params,
        available_risk_budget=1000.0, db=db, client=object(),
    )

    # skip is never persisted -- only 2 rows written
    assert len(result["recommendations"]) == 2
    actions = {r["symbol"]: r["action"] for r in result["recommendations"]}
    assert actions == {"AAPL": "enter", "MSFT": "watch"}
    assert result["missing_decision_history_lookups"] == []

    assert len(db.decision_outcomes_inserted) == 1
    shadow = db.decision_outcomes_inserted[0]
    assert shadow["symbol"] == "AAPL"
    assert shadow["source_type"] == "recommendation"
    assert shadow["mode"] == "shadow"
    assert shadow["resolution"] == "still_open"
    assert shadow["entry_price_reference"] == 200.0

    aapl_rec = next(r for r in db.recommendations_inserted if r["symbol"] == "AAPL")
    assert aapl_rec["entry_price"] == 200.0
    assert aapl_rec["stop_price"] == 190.0
    assert aapl_rec["shares"] is not None and aapl_rec["shares"] > 0
    assert aapl_rec["dollar_risk"] is not None

    msft_rec = next(r for r in db.recommendations_inserted if r["symbol"] == "MSFT")
    assert msft_rec["shares"] is None  # sizing only computed for 'enter'

    assert len(db.agent_analyses_inserted) == 1
    assert db.agent_analyses_inserted[0]["agent_type"] == "synthesis"
    assert db.agent_analyses_inserted[0]["cost_usd"] is not None


@pytest.mark.asyncio
async def test_zero_risk_budget_downgrades_enter_to_watch(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    output = {"recommendations": [{**VALID_RECOMMENDATION, "symbol": "AAPL"}]}
    monkeypatch.setattr(
        synthesis, "run_agent",
        lambda *a, **k: _run_agent_result(output, tool_calls=[{"name": "query_decision_history", "input": {"symbol": "AAPL"}}]),
    )

    result = await synthesis.synthesize(
        run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params,
        available_risk_budget=0.0, db=db, client=object(),
    )

    assert result["recommendations"][0]["action"] == "watch"
    assert db.decision_outcomes_inserted == []


@pytest.mark.asyncio
async def test_enter_on_non_eligible_symbol_is_downgraded(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    # TSLA is not actionable -> not ENTER-eligible, but the mocked model tries anyway
    output = {"recommendations": [{**VALID_RECOMMENDATION, "symbol": "TSLA"}]}
    monkeypatch.setattr(synthesis, "run_agent", lambda *a, **k: _run_agent_result(output, tool_calls=[]))

    result = await synthesis.synthesize(
        run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params,
        available_risk_budget=1000.0, db=db, client=object(),
    )

    assert result["recommendations"][0]["action"] == "watch"
    assert db.decision_outcomes_inserted == []


@pytest.mark.asyncio
async def test_over_cap_enter_count_truncated_to_top_conviction(monkeypatch, strategy_params) -> None:
    tables = _base_tables()
    # widen the shortlist so risk_on's top-decile cutoff admits 3 names (round(30*0.10)=3)
    tables["factor_scores"] = [
        {"symbol": "AAPL", "sector": "Tech", "composite_z": 1.5, "rank": 1, "hard_filter_pass": True, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        {"symbol": "MSFT", "sector": "Health", "composite_z": 1.4, "rank": 2, "hard_filter_pass": True, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        {"symbol": "GOOG", "sector": "Energy", "composite_z": 1.3, "rank": 3, "hard_filter_pass": True, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        *[{"symbol": f"S{i}", "sector": "Other", "composite_z": 0.1, "rank": i, "hard_filter_pass": True, "run_id": RUN_ID, "strategy_id": STRATEGY_ID} for i in range(4, 31)],
    ]
    tables["entry_signals"] = [
        {"symbol": "AAPL", "setup_type": "pullback", "actionable": True, "entry_price": 200.0, "stop_price": 190.0, "target_price": 230.0, "atr": 5.0, "effective_horizon_days": 20, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        {"symbol": "MSFT", "setup_type": "breakout", "actionable": True, "entry_price": 400.0, "stop_price": 380.0, "target_price": 460.0, "atr": 10.0, "effective_horizon_days": 15, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
        {"symbol": "GOOG", "setup_type": "squeeze", "actionable": True, "entry_price": 150.0, "stop_price": 140.0, "target_price": 175.0, "atr": 3.0, "effective_horizon_days": 10, "run_id": RUN_ID, "strategy_id": STRATEGY_ID},
    ]
    tables["assets"] = [
        {"symbol": "AAPL", "sector": "Tech"}, {"symbol": "MSFT", "sector": "Health"}, {"symbol": "GOOG", "sector": "Energy"},
    ]
    db = FakeDB(tables)
    capped_params = replace(strategy_params, daily_recommendation_cap=2)

    output = {
        "recommendations": [
            {**VALID_RECOMMENDATION, "symbol": "AAPL", "conviction": "high"},
            {**VALID_RECOMMENDATION, "symbol": "MSFT", "conviction": "medium"},
            {**VALID_RECOMMENDATION, "symbol": "GOOG", "conviction": "low"},
        ]
    }
    monkeypatch.setattr(
        synthesis, "run_agent",
        lambda *a, **k: _run_agent_result(
            output,
            tool_calls=[
                {"name": "query_decision_history", "input": {"symbol": "AAPL"}},
                {"name": "query_decision_history", "input": {"symbol": "MSFT"}},
                {"name": "query_decision_history", "input": {"symbol": "GOOG"}},
            ],
        ),
    )

    result = await synthesis.synthesize(
        run_id="run-1", strategy_id="strategy-1", strategy_params=capped_params,
        available_risk_budget=100_000.0, db=db, client=object(),
    )

    actions = {r["symbol"]: r["action"] for r in result["recommendations"]}
    assert actions["AAPL"] == "enter"
    assert actions["MSFT"] == "enter"
    assert actions["GOOG"] == "watch"  # lowest conviction, truncated by the cap
    assert len(db.decision_outcomes_inserted) == 2


@pytest.mark.asyncio
async def test_missing_field_raises(monkeypatch, strategy_params) -> None:
    from artisan.agents.base import AgentOutputError

    db = FakeDB(_base_tables())
    bad = {k: v for k, v in VALID_RECOMMENDATION.items() if k != "historical_precedent"}
    output = {"recommendations": [{**bad, "symbol": "AAPL"}]}
    monkeypatch.setattr(synthesis, "run_agent", lambda *a, **k: _run_agent_result(output, tool_calls=[]))

    with pytest.raises(AgentOutputError, match="historical_precedent"):
        await synthesis.synthesize(
            run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params,
            available_risk_budget=1000.0, db=db, client=object(),
        )


@pytest.mark.asyncio
async def test_reports_missing_decision_history_lookup_for_enter_candidate(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    output = {"recommendations": [{**VALID_RECOMMENDATION, "symbol": "AAPL"}]}
    # no query_decision_history call at all in the transcript
    monkeypatch.setattr(synthesis, "run_agent", lambda *a, **k: _run_agent_result(output, tool_calls=[]))

    result = await synthesis.synthesize(
        run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params,
        available_risk_budget=1000.0, db=db, client=object(),
    )

    assert result["missing_decision_history_lookups"] == ["AAPL"]
    # still written -- this is a logged compliance gap, not a rejection
    assert result["recommendations"][0]["action"] == "enter"
