from __future__ import annotations

from datetime import UTC, datetime

from artisan.jobs.track_outcomes import run_track_outcomes

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)


class FakeQuery:
    def __init__(self, rows: list[dict], on_execute=None) -> None:
        self.rows = rows
        self._filters: dict[str, object] = {}
        self._on_execute = on_execute
        self._update_fields: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        self._filters[column] = value
        return self

    def order(self, _column: str, desc: bool = False):
        self.rows = sorted(self.rows, key=lambda r: r.get(_column, ""), reverse=desc)
        return self

    def limit(self, n: int):
        self.rows = self.rows[:n]
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
            if self._on_execute:
                self._on_execute(matched, self._update_fields)
            return type("Response", (), {"data": matched})()
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(
        self,
        decision_outcomes: list[dict],
        prices: dict[str, float],
        position_reviews: list[dict] | None = None,
        portfolio_positions: list[dict] | None = None,
    ) -> None:
        self.decision_outcomes = decision_outcomes
        self.prices = prices
        self.position_reviews = position_reviews or []
        self.portfolio_positions = portfolio_positions or []

    def table(self, name: str):
        if name == "decision_outcomes":
            return FakeQuery(self.decision_outcomes)
        if name == "price_bars":
            return _PriceBarsQuery(self.prices)
        if name == "position_reviews":
            return FakeQuery(self.position_reviews)
        if name == "portfolio_positions":
            return FakeQuery(self.portfolio_positions)
        raise AssertionError(f"Unexpected table: {name}")


class _PriceBarsQuery:
    def __init__(self, prices: dict[str, float]) -> None:
        self.prices = prices
        self._symbol: str | None = None

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, value):
        self._symbol = value
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _n: int):
        return self

    def execute(self):
        price = self.prices.get(self._symbol)
        data = [{"close": price, "bar_time": "2026-06-01T00:00:00+00:00"}] if price is not None else []
        return type("Response", (), {"data": data})()


def _base_row(**overrides) -> dict:
    row = {
        "id": "do-1",
        "symbol": "AAPL",
        "source_type": "recommendation",
        "source_id": "rec-1",
        "entry_price_reference": 100.0,
        "stop_price": 90.0,
        "target_price": 120.0,
        "effective_horizon_days": 20,
        "created_at": "2026-05-01T00:00:00+00:00",
        "resolution": "still_open",
    }
    row.update(overrides)
    return row


def test_hit_target_resolution() -> None:
    row = _base_row()
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 121.0})

    result = run_track_outcomes(db=db, now=NOW)

    assert result == {"checked": 1, "resolved": 1}
    assert row["resolution"] == "hit_target"
    assert row["r_multiple"] == round((121.0 - 100.0) / (100.0 - 90.0), 4)
    assert row["days_to_resolution"] == (NOW.date() - datetime(2026, 5, 1, tzinfo=UTC).date()).days


def test_hit_stop_resolution() -> None:
    row = _base_row()
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 88.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "hit_stop"
    assert row["r_multiple"] == round((88.0 - 100.0) / (100.0 - 90.0), 4)


def test_time_expired_favorable() -> None:
    # horizon 20 days, created 2026-05-01, now 2026-06-01 -> 31 days held, past horizon
    row = _base_row(target_price=200.0, stop_price=50.0)  # wide enough to not hit target/stop
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 110.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "time_expired_favorable"


def test_time_expired_unfavorable() -> None:
    row = _base_row(target_price=200.0, stop_price=50.0)
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 95.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "time_expired_unfavorable"


def test_time_expired_flat() -> None:
    row = _base_row(target_price=200.0, stop_price=50.0)
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 100.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "time_expired_flat"


def test_superseded_when_linked_position_closed() -> None:
    row = _base_row(
        source_type="position_review",
        source_id="pr-1",
        target_price=200.0,
        stop_price=50.0,
        effective_horizon_days=9999,  # never naturally time-expires in this test
    )
    db = FakeDB(
        decision_outcomes=[row],
        prices={"AAPL": 110.0},
        position_reviews=[{"id": "pr-1", "position_id": "pos-1"}],
        portfolio_positions=[],  # position no longer exists -> closed
    )

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "superseded"


def test_still_open_when_no_condition_met() -> None:
    row = _base_row(
        source_type="position_review",
        source_id="pr-1",
        target_price=200.0,
        stop_price=50.0,
        effective_horizon_days=9999,
    )
    db = FakeDB(
        decision_outcomes=[row],
        prices={"AAPL": 110.0},
        position_reviews=[{"id": "pr-1", "position_id": "pos-1"}],
        portfolio_positions=[{"id": "pos-1"}],  # still open
    )

    result = run_track_outcomes(db=db, now=NOW)

    assert result == {"checked": 1, "resolved": 0}
    assert row["resolution"] == "still_open"


def test_recommendation_source_never_checks_superseded() -> None:
    # source_type='recommendation' rows should stay still_open rather than being
    # marked superseded, even with the same "nothing else resolves" shape.
    row = _base_row(target_price=200.0, stop_price=50.0, effective_horizon_days=9999)
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 110.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "still_open"


def test_hit_target_takes_priority_over_time_expiry() -> None:
    row = _base_row(effective_horizon_days=1)  # already past horizon too
    db = FakeDB(decision_outcomes=[row], prices={"AAPL": 125.0})

    run_track_outcomes(db=db, now=NOW)

    assert row["resolution"] == "hit_target"
