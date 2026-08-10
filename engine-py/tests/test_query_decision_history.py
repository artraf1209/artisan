from __future__ import annotations

from artisan.agents.tools import query_decision_history


class FakeDecisionOutcomesQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self._filters: dict[str, object] = {}

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

    def execute(self):
        matched = [r for r in self.rows if all(r.get(k) == v for k, v in self._filters.items())]
        return type("Response", (), {"data": matched})()


class FakeRecommendationsQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self._ids: list[str] | None = None

    def select(self, _fields: str):
        return self

    def in_(self, _column: str, values: list[str]):
        self._ids = values
        return self

    def execute(self):
        matched = [r for r in self.rows if self._ids is None or r["id"] in self._ids]
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(self, decision_outcomes: list[dict], recommendations: list[dict] | None = None) -> None:
        self.decision_outcomes = decision_outcomes
        self.recommendations = recommendations or []

    def table(self, name: str):
        if name == "decision_outcomes":
            return FakeDecisionOutcomesQuery(self.decision_outcomes)
        if name == "recommendations":
            return FakeRecommendationsQuery(self.recommendations)
        raise AssertionError(f"Unexpected table: {name}")


def _row(**overrides) -> dict:
    row = {
        "id": "do-1",
        "symbol": "AAPL",
        "source_type": "recommendation",
        "source_id": "rec-1",
        "mode": "real",
        "resolution": "hit_target",
        "r_multiple": 2.0,
        "days_to_resolution": 10,
        "setup_type": "pullback",
        "regime": "risk_on",
        "resolved_at": "2026-05-15T00:00:00+00:00",
        "created_at": "2026-05-01T00:00:00+00:00",
    }
    row.update(overrides)
    return row


def test_aggregate_win_rate_and_avg_r_multiple() -> None:
    rows = [
        _row(id="do-1", resolution="hit_target", r_multiple=2.0),
        _row(id="do-2", resolution="hit_stop", r_multiple=-1.0),
        _row(id="do-3", resolution="hit_target", r_multiple=1.5),
        _row(id="do-4", resolution="still_open", r_multiple=None),  # excluded from win rate
    ]
    db = FakeDB(rows)

    result = query_decision_history(db=db)

    assert result["aggregate"]["count"] == 4
    assert result["aggregate"]["win_rate"] == round(2 / 3, 4)
    assert result["aggregate"]["avg_r_multiple"] == round((2.0 - 1.0 + 1.5) / 3, 4)
    assert result["aggregate"]["avg_days_to_resolution"] == 10.0


def test_real_and_shadow_counts() -> None:
    rows = [
        _row(id="do-1", mode="real"),
        _row(id="do-2", mode="shadow"),
        _row(id="do-3", mode="shadow"),
    ]
    db = FakeDB(rows)

    result = query_decision_history(db=db)

    assert result["aggregate"]["real_count"] == 1
    assert result["aggregate"]["shadow_count"] == 2


def test_filters_narrow_results_by_symbol() -> None:
    rows = [_row(id="do-1", symbol="AAPL"), _row(id="do-2", symbol="MSFT")]
    db = FakeDB(rows)

    result = query_decision_history(symbol="MSFT", db=db)

    assert result["aggregate"]["count"] == 1
    assert result["recent"][0]["symbol"] == "MSFT"


def test_filters_narrow_results_by_setup_type_and_regime() -> None:
    rows = [
        _row(id="do-1", setup_type="pullback", regime="risk_on"),
        _row(id="do-2", setup_type="breakout", regime="risk_on"),
        _row(id="do-3", setup_type="pullback", regime="risk_off"),
    ]
    db = FakeDB(rows)

    result = query_decision_history(setup_type="pullback", regime="risk_on", db=db)

    assert result["aggregate"]["count"] == 1
    assert result["recent"][0]["resolution"] == rows[0]["resolution"]


def test_recent_limit_caps_results_but_not_aggregate() -> None:
    rows = [_row(id=f"do-{i}") for i in range(5)]
    db = FakeDB(rows)

    result = query_decision_history(limit=2, db=db)

    assert result["aggregate"]["count"] == 5
    assert len(result["recent"]) == 2


def test_thesis_summary_attached_for_recommendation_sourced_rows() -> None:
    rows = [_row(id="do-1", source_type="recommendation", source_id="rec-1")]
    recommendations = [{"id": "rec-1", "thesis": "Strong earnings momentum, breaking out of a base."}]
    db = FakeDB(rows, recommendations)

    result = query_decision_history(db=db)

    assert result["recent"][0]["thesis_summary"] == "Strong earnings momentum, breaking out of a base."


def test_thesis_summary_truncated_when_long() -> None:
    long_thesis = "x" * 500
    rows = [_row(id="do-1", source_type="recommendation", source_id="rec-1")]
    recommendations = [{"id": "rec-1", "thesis": long_thesis}]
    db = FakeDB(rows, recommendations)

    result = query_decision_history(db=db)

    summary = result["recent"][0]["thesis_summary"]
    assert len(summary) == 241  # 240 chars + ellipsis
    assert summary.endswith("…")


def test_thesis_summary_none_for_position_review_sourced_rows() -> None:
    rows = [_row(id="do-1", source_type="position_review", source_id="pr-1")]
    db = FakeDB(rows)

    result = query_decision_history(db=db)

    assert result["recent"][0]["thesis_summary"] is None


def test_no_matches_returns_none_aggregates_not_errors() -> None:
    db = FakeDB([])

    result = query_decision_history(symbol="ZZZZ", db=db)

    assert result["aggregate"]["count"] == 0
    assert result["aggregate"]["win_rate"] is None
    assert result["aggregate"]["avg_r_multiple"] is None
    assert result["recent"] == []
