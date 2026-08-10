from __future__ import annotations

from artisan.jobs.expire_stale import run_expire_stale

CURRENT_RUN_ID = "run-current"
OLD_RUN_ID = "run-old"


class FakeTableQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self._filters: dict[str, object] = {}
        self._update_fields: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        self._filters[column] = value
        return self

    def update(self, fields: dict):
        self._update_fields = fields
        return self

    def _matches(self, row: dict) -> bool:
        return all(row.get(k) == v for k, v in self._filters.items())

    def execute(self):
        matched = [r for r in self.rows if self._matches(r)]
        if self._update_fields is not None:
            for row in matched:
                row.update(self._update_fields)
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(self, recommendations: list[dict], position_reviews: list[dict], decision_outcomes: list[dict]) -> None:
        self.recommendations = recommendations
        self.position_reviews = position_reviews
        self.decision_outcomes = decision_outcomes

    def table(self, name: str):
        if name == "recommendations":
            return FakeTableQuery(self.recommendations)
        if name == "position_reviews":
            return FakeTableQuery(self.position_reviews)
        if name == "decision_outcomes":
            return FakeTableQuery(self.decision_outcomes)
        raise AssertionError(f"Unexpected table: {name}")


def test_expires_only_pending_rows_from_a_different_run() -> None:
    recommendations = [
        {"id": "r1", "status": "pending", "run_id": OLD_RUN_ID},
        {"id": "r2", "status": "pending", "run_id": CURRENT_RUN_ID},
        {"id": "r3", "status": "approved", "run_id": OLD_RUN_ID},  # not pending -> untouched
    ]
    position_reviews = [
        {"id": "p1", "status": "pending", "run_id": OLD_RUN_ID},
        {"id": "p2", "status": "pending", "run_id": CURRENT_RUN_ID},
    ]
    decision_outcomes = [{"id": "do1", "resolution": "still_open"}]

    db = FakeDB(recommendations, position_reviews, decision_outcomes)
    result = run_expire_stale(db=db, current_run_id=CURRENT_RUN_ID)

    assert result == {"recommendations_expired": 1, "position_reviews_expired": 1}
    assert recommendations[0]["status"] == "expired"
    assert recommendations[1]["status"] == "pending"
    assert recommendations[2]["status"] == "approved"
    assert position_reviews[0]["status"] == "expired"
    assert position_reviews[1]["status"] == "pending"

    # queue hygiene only -- decision_outcomes is never touched
    assert decision_outcomes[0]["resolution"] == "still_open"


def test_null_run_id_rows_are_treated_as_stale() -> None:
    recommendations = [{"id": "r1", "status": "pending", "run_id": None}]
    db = FakeDB(recommendations, [], [])

    result = run_expire_stale(db=db, current_run_id=CURRENT_RUN_ID)

    assert result["recommendations_expired"] == 1
    assert recommendations[0]["status"] == "expired"


def test_no_stale_rows_is_a_no_op() -> None:
    recommendations = [{"id": "r1", "status": "pending", "run_id": CURRENT_RUN_ID}]
    db = FakeDB(recommendations, [], [])

    result = run_expire_stale(db=db, current_run_id=CURRENT_RUN_ID)

    assert result == {"recommendations_expired": 0, "position_reviews_expired": 0}
    assert recommendations[0]["status"] == "pending"
