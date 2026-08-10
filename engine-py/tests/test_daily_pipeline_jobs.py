from __future__ import annotations

import pytest

import artisan.jobs.briefing as briefing_job
import artisan.jobs.common as common_job
import artisan.jobs.expire_stale as expire_stale_job
import artisan.jobs.score as score_job
import artisan.jobs.synthesize as synthesize_job
from artisan.jobs.common import pipeline_job, resolve_current_run_id


class _Query:
    def __init__(self, rows: list[dict], insert_sink: list[dict] | None = None) -> None:
        self.rows = rows
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


class FakeDB:
    def __init__(self, table_rows: dict[str, list[dict]]) -> None:
        self.table_rows = table_rows
        self.inserts: dict[str, list[dict]] = {}

    def table(self, name: str):
        sink = self.inserts.setdefault(name, [])
        return _Query(self.table_rows.setdefault(name, []), sink)


def test_resolve_current_run_id_returns_most_recent() -> None:
    db = FakeDB(
        {
            "pipeline_runs": [
                {"id": "old", "started_at": "2026-06-01T00:00:00+00:00"},
                {"id": "new", "started_at": "2026-06-02T00:00:00+00:00"},
            ]
        }
    )
    assert resolve_current_run_id(db) == "new"


def test_resolve_current_run_id_raises_when_no_rows() -> None:
    db = FakeDB({"pipeline_runs": []})
    with pytest.raises(RuntimeError, match="nightly_ingest must run first"):
        resolve_current_run_id(db)


def test_pipeline_job_happy_path_yields_db_and_run_id() -> None:
    db = FakeDB({"pipeline_runs": [{"id": "run-1", "started_at": "2026-06-01T00:00:00+00:00", "status": "ingested"}]})

    with pipeline_job("test_job", db=db) as (yielded_db, run_id):
        assert yielded_db is db
        assert run_id == "run-1"

    # no failure -> status untouched
    assert db.table_rows["pipeline_runs"][0]["status"] == "ingested"


def test_pipeline_job_marks_failed_and_reraises_on_exception() -> None:
    db = FakeDB({"pipeline_runs": [{"id": "run-1", "started_at": "2026-06-01T00:00:00+00:00", "status": "running"}]})

    with pytest.raises(ValueError, match="boom"):
        with pipeline_job("test_job", db=db):
            raise ValueError("boom")

    assert db.table_rows["pipeline_runs"][0]["status"] == "failed"
    assert db.table_rows["pipeline_runs"][0]["completed_at"] is not None


def test_run_entry_gates_step_only_evaluates_top_shortlist_size_by_rank(monkeypatch, strategy_params) -> None:
    from dataclasses import replace

    capped_params = replace(strategy_params, shortlist_size=2)
    factor_results = [
        {"symbol": "AAPL", "rank": 1, "hard_filter_pass": True},
        {"symbol": "MSFT", "rank": 2, "hard_filter_pass": True},
        {"symbol": "TSLA", "rank": 3, "hard_filter_pass": True},
        {"symbol": "SKIPPED", "rank": None, "hard_filter_pass": False},
    ]
    db = FakeDB({"portfolio_snapshots": [{"drawdown_from_high_pct": -0.02}], "entry_signals": []})

    evaluated_symbols: list[str] = []

    class FakeTechnicalScorer:
        def __init__(self, db):
            pass

        def score_symbol(self, symbol):
            evaluated_symbols.append(symbol)
            return {"_snapshot": {"close": 100.0}, "close": 100.0}

    monkeypatch.setattr(score_job, "TechnicalScorer", FakeTechnicalScorer)
    monkeypatch.setattr(
        score_job, "evaluate_entry",
        lambda **kwargs: {"symbol": kwargs["symbol"], "actionable": False, "setup_type": None},
    )

    rows = score_job.run_entry_gates_step(
        db, run_id="run-1", strategy_id="strategy-1", strategy_params=capped_params,
        regime="risk_on", factor_results=factor_results, spy_df=None, capital=100_000.0,
    )

    assert evaluated_symbols == ["AAPL", "MSFT"]  # only top 2 by rank, SKIPPED (no rank) excluded
    assert len(rows) == 2
    assert len(db.inserts["entry_signals"]) == 2


def test_load_shortlist_symbols_sorts_and_truncates() -> None:
    db = FakeDB(
        {
            "factor_scores": [
                {"symbol": "C", "rank": 3, "run_id": "run-1", "strategy_id": "strategy-1"},
                {"symbol": "A", "rank": 1, "run_id": "run-1", "strategy_id": "strategy-1"},
                {"symbol": "B", "rank": 2, "run_id": "run-1", "strategy_id": "strategy-1"},
                {"symbol": "UNRANKED", "rank": None, "run_id": "run-1", "strategy_id": "strategy-1"},
            ]
        }
    )

    symbols = synthesize_job._load_shortlist_symbols(db, "run-1", "strategy-1", shortlist_size=2)

    assert symbols == ["A", "B"]


@pytest.mark.asyncio
async def test_run_synthesize_skips_analysts_and_synthesis_when_shortlist_empty(monkeypatch, strategy_params) -> None:
    db = FakeDB({"factor_scores": []})
    result = await synthesize_job.run_synthesize(db=db, run_id="run-1", strategy_id="strategy-1", strategy_params=strategy_params)
    assert result == {"symbols": 0, "recommendations": []}


def test_expire_stale_main_writes_audit_log_entry(monkeypatch) -> None:
    db = FakeDB(
        {
            "pipeline_runs": [{"id": "run-1", "started_at": "2026-06-01T00:00:00+00:00", "status": "ingested"}],
            "recommendations": [{"id": "r1", "status": "pending", "run_id": "old-run"}],
            "position_reviews": [],
        }
    )
    monkeypatch.setattr(common_job, "get_client", lambda: db)

    expire_stale_job.main()

    audit_rows = db.inserts.get("audit_log", [])
    assert len(audit_rows) == 1
    assert audit_rows[0]["action"] == "expire_stale"
    assert audit_rows[0]["entity_id"] == "run-1"
    assert audit_rows[0]["payload"]["recommendations_expired"] == 1


def test_load_expired_counts_reads_back_from_audit_log() -> None:
    db = FakeDB(
        {
            "audit_log": [
                {
                    "entity_id": "run-1", "action": "expire_stale", "created_at": "2026-06-01T00:00:00+00:00",
                    "payload": {"recommendations_expired": 3, "position_reviews_expired": 1},
                }
            ]
        }
    )

    counts = briefing_job._load_expired_counts(db, "run-1")

    assert counts == {"recommendations_expired": 3, "position_reviews_expired": 1}


def test_load_expired_counts_defaults_when_missing() -> None:
    db = FakeDB({"audit_log": []})
    counts = briefing_job._load_expired_counts(db, "run-1")
    assert counts == {"recommendations_expired": 0, "position_reviews_expired": 0}
