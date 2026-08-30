from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime

import artisan.jobs.nightly_ingest as nightly_ingest
from artisan.adapters.fmp_screener import FmpScreenerUnavailableError
from artisan.jobs.nightly_ingest import (
    _select_fundamental_refresh_symbols,
    refresh_universe,
    resolve_run_date,
    run_nightly_ingest,
)

FAKE_RUN_ID = "fake-run-id"

STRATEGY_ROW = {
    "risk_params": {
        "risk_per_trade_pct": 0.01,
        "max_position_pct": 0.10,
        "max_concurrent_positions": 15,
        "max_sector_exposure_pct": 0.25,
        "max_portfolio_heat_pct": 0.08,
        "daily_drawdown_kill_switch_pct": -0.03,
        "max_drawdown_tolerance_pct": 0.18,
    },
    "screening_params": {
        "shortlist_size": 50,
        "daily_recommendation_cap": 10,
        "factor_weights": {"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15},
    },
    "timing_params": {
        "max_holding_period_days": 30,
        "horizon_baseline_days": {"pullback": 20, "breakout": 15, "squeeze": 10},
        "regime_multipliers": {"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
        "earnings_blackout_pre_days": 3,
        "earnings_blackout_post_days": 1,
    },
    "position_mgmt_params": {
        "trailing_stop_atr_multiple": 2,
        "breakeven_trigger_r": 1,
        "auto_apply_stop_tightening": True,
    },
    "performance_goals": {
        "target_annual_return_pct": 0.25,
        "benchmark_symbol": "SPY",
        "llm_daily_cost_cap_usd": 5.0,
    },
}

DEFAULT_MARKET_CALENDAR = [
    {"date": "2026-05-02", "open": "09:30", "close": "16:00"},
    {"date": "2026-05-04", "open": "09:30", "close": "16:00"},
    {"date": "2026-05-05", "open": "09:30", "close": "16:00"},
]


def fake_market_calendar_loader(_start: date, _end: date) -> list[dict]:
    return DEFAULT_MARKET_CALENDAR


class FakeSelectQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def in_(self, _column: str, _value: list[str]):
        return self

    def eq(self, _column: str, _value: str):
        return self

    def gte(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _limit: int):
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeInsertQuery:
    def __init__(self, inserts: list[dict]) -> None:
        self.inserts = inserts

    def insert(self, row: dict):
        self.inserts.append(row)
        return self

    def execute(self):
        return type("Response", (), {"data": []})()


class FakePipelineRunsQuery:
    def __init__(self, runs: dict[str, dict], updates: list[dict]) -> None:
        self.runs = runs
        self.updates = updates
        self._insert_row: dict | None = None
        self._update_fields: dict | None = None
        self._filter_id: str | None = None

    def insert(self, row: dict):
        self._insert_row = row
        return self

    def update(self, fields: dict):
        self._update_fields = fields
        return self

    def eq(self, _column: str, value):
        self._filter_id = value
        return self

    def execute(self):
        if self._insert_row is not None:
            row = {"id": FAKE_RUN_ID, **self._insert_row}
            self.runs[FAKE_RUN_ID] = row
            return type("Response", (), {"data": [row]})()
        if self._update_fields is not None:
            run = self.runs.setdefault(self._filter_id, {})
            run.update(self._update_fields)
            self.updates.append({"id": self._filter_id, **self._update_fields})
            return type("Response", (), {"data": [run]})()
        return type("Response", (), {"data": []})()


class FakePortfolioTableQuery:
    """Handles both portfolio_snapshots and portfolio_positions select/insert."""

    def __init__(self, rows: list[dict], inserted_sink: list[dict]) -> None:
        self.rows = rows
        self.inserted_sink = inserted_sink
        self._insert_row: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value):
        return self

    def gte(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        return self

    def limit(self, _n: int):
        return self

    def insert(self, row: dict):
        self._insert_row = row
        return self

    def execute(self):
        if self._insert_row is not None:
            self.inserted_sink.append(self._insert_row)
            return type("Response", (), {"data": [self._insert_row]})()
        return type("Response", (), {"data": self.rows})()


class FakeDB:
    def __init__(
        self,
        fundamental_rows: list[dict] | None = None,
        prior_portfolio_snapshots: list[dict] | None = None,
        portfolio_positions: list[dict] | None = None,
        strategy_row: dict | None = None,
        universe_symbols: list[str] | None = None,
    ) -> None:
        self.inserts: list[dict] = []
        self.fundamental_rows = fundamental_rows or []
        self.pipeline_runs: dict[str, dict] = {}
        self.pipeline_run_updates: list[dict] = []
        self.prior_portfolio_snapshots = prior_portfolio_snapshots or []
        self.portfolio_snapshots_inserted: list[dict] = []
        self.portfolio_positions = portfolio_positions or []
        self.strategy_row = strategy_row or STRATEGY_ROW
        self.universe_symbols = universe_symbols or ["AAPL", "MSFT"]

    def table(self, table_name: str):
        if table_name == "universes":
            return FakeSelectQuery([{"symbol": symbol} for symbol in self.universe_symbols])
        if table_name == "fundamentals":
            return FakeSelectQuery(self.fundamental_rows)
        if table_name == "audit_log":
            return FakeInsertQuery(self.inserts)
        if table_name == "pipeline_runs":
            return FakePipelineRunsQuery(self.pipeline_runs, self.pipeline_run_updates)
        if table_name == "portfolio_snapshots":
            return FakePortfolioTableQuery(self.prior_portfolio_snapshots, self.portfolio_snapshots_inserted)
        if table_name == "portfolio_positions":
            return FakePortfolioTableQuery(self.portfolio_positions, [])
        if table_name == "strategies":
            return FakeSelectQuery([self.strategy_row])
        raise AssertionError(f"Unexpected table requested: {table_name}")


class FakePricesAdapter:
    def __init__(self, skipped_invalid_symbols: list[str] | None = None) -> None:
        self.saved_rows: list[dict] = []
        self.last_requested_symbols: list[str] = []
        self.last_requested_start: date | None = None
        self.last_requested_end: date | None = None
        self.last_skipped_invalid_symbols = skipped_invalid_symbols or []

    def fetch_daily_bars(self, symbols: list[str], start: date, end: date) -> list[dict]:
        self.last_requested_symbols = symbols
        self.last_requested_start = start
        self.last_requested_end = end
        assert start <= end
        return [{"symbol": symbol} for symbol in symbols if symbol not in self.last_skipped_invalid_symbols]

    def save_bars(self, rows: list[dict]) -> int:
        self.saved_rows = rows
        return len(rows)


class FakeFundamentalsAdapter:
    def __init__(self) -> None:
        self.synced: list[str] = []

    def sync_symbol(self, symbol: str) -> dict:
        self.synced.append(symbol)
        return {"symbol": symbol}


class FakeNewsAdapter:
    def __init__(self) -> None:
        self.saved = 0

    def fetch_news(self, symbol: str, start: date, end: date) -> list[dict]:
        assert start <= end
        return [{"symbol": symbol, "url": f"https://example.com/{symbol.lower()}"}]

    def save_articles(self, rows: list[dict]) -> int:
        self.saved += len(rows)
        return len(rows)


class FakeAccountAdapter:
    def __init__(self, equity: float = 100_000.0, cash: float = 20_000.0) -> None:
        self.equity = equity
        self.cash = cash

    def get_account(self) -> dict:
        return {"equity": self.equity, "cash": self.cash}


def test_run_nightly_ingest_orchestrates_all_stages() -> None:
    db = FakeDB()
    prices = FakePricesAdapter()
    fundamentals = FakeFundamentalsAdapter()
    news = FakeNewsAdapter()
    account = FakeAccountAdapter()

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=fundamentals,
        news_adapter=news,
        account_adapter=account,
        now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),  # Within FMP quota window (9pm UTC)
        refresh_universe_from_screener=False,
        market_calendar_loader=fake_market_calendar_loader,
    )

    assert summary["run_date"] == "2026-05-04"
    assert summary["symbols"] == 2
    assert summary["fundamental_targets"] == 2
    assert summary["price_rows"] == 3
    assert summary["fundamental_rows"] == 2
    assert summary["news_rows"] == 2
    assert summary["skipped_invalid_symbols"] == []
    assert prices.saved_rows == [{"symbol": "AAPL"}, {"symbol": "MSFT"}, {"symbol": "SPY"}]
    assert prices.last_requested_symbols == ["AAPL", "MSFT", "SPY"]
    assert prices.last_requested_end == date(2026, 5, 4)
    assert fundamentals.synced == ["AAPL", "MSFT"]

    # pipeline_runs anchoring -- "ingested", not "completed": daily_pipeline.yml
    # (v2-14) reuses this row through briefing, which owns the terminal status.
    assert summary["run_id"] == FAKE_RUN_ID
    assert db.pipeline_runs[FAKE_RUN_ID]["status"] == "ingested"
    assert db.pipeline_runs[FAKE_RUN_ID]["run_date"] == "2026-05-04"
    assert db.pipeline_run_updates[-1]["status"] == "ingested"

    # portfolio_snapshots: first run, no prior snapshot -> drawdown 0
    assert len(db.portfolio_snapshots_inserted) == 1
    snapshot = db.portfolio_snapshots_inserted[0]
    assert snapshot["run_id"] == FAKE_RUN_ID
    assert snapshot["equity"] == 100_000.0
    assert snapshot["cash"] == 20_000.0
    assert snapshot["high_water_mark"] == 100_000.0
    assert snapshot["drawdown_from_high_pct"] == 0.0
    assert snapshot["trailing_return_pct"] == 0.0
    assert snapshot["open_positions_count"] == 0
    assert summary["portfolio_snapshot"] == snapshot

    # every ingest-stage audit_log payload carries run_id
    assert len(db.inserts) == 5  # run_started, prices, fundamentals, news, summary
    assert all("run_id" in entry["payload"] for entry in db.inserts)
    assert all("run_date" in entry["payload"] for entry in db.inserts)


def test_run_nightly_ingest_computes_drawdown_against_prior_high_water_mark() -> None:
    db = FakeDB(
        prior_portfolio_snapshots=[
            {"equity": 120_000.0, "high_water_mark": 120_000.0, "snapshot_date": "2026-05-03"}
        ],
        portfolio_positions=[{"unrealized_pnl": 500.0}, {"unrealized_pnl": -100.0}],
    )
    summary = run_nightly_ingest(
        db=db,
        prices_adapter=FakePricesAdapter(),
        fundamentals_adapter=FakeFundamentalsAdapter(),
        news_adapter=FakeNewsAdapter(),
        account_adapter=FakeAccountAdapter(equity=108_000.0, cash=10_000.0),
        now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),
        refresh_universe_from_screener=False,
        market_calendar_loader=fake_market_calendar_loader,
    )

    snapshot = summary["portfolio_snapshot"]
    assert snapshot["high_water_mark"] == 120_000.0
    assert snapshot["drawdown_from_high_pct"] == (108_000.0 - 120_000.0) / 120_000.0
    assert snapshot["open_positions_count"] == 2
    assert snapshot["unrealized_pnl"] == 400.0


def test_run_nightly_ingest_pulls_prices_for_open_positions_outside_the_universe() -> None:
    """A held position (ABNB) that has since dropped out of the screener universe
    (universe_symbols below doesn't include it) must still get fresh price bars
    every run -- this is the fix for the gap where a symbol's prices silently
    stopped once universes.active flipped to false while the position stayed
    open. MSFT overlaps both lists to prove de-dup, not just union."""
    db = FakeDB(
        universe_symbols=["AAPL", "MSFT"],
        portfolio_positions=[{"symbol": "MSFT"}, {"symbol": "ABNB"}],
    )
    prices = FakePricesAdapter()

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=FakeFundamentalsAdapter(),
        news_adapter=FakeNewsAdapter(),
        account_adapter=FakeAccountAdapter(),
        now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),
        refresh_universe_from_screener=False,
        market_calendar_loader=fake_market_calendar_loader,
    )

    assert prices.last_requested_symbols == ["AAPL", "MSFT", "ABNB", "SPY"]
    # the universe count itself is unaffected -- only the price pull grows
    assert summary["symbols"] == 2


def test_select_fundamental_refresh_symbols_prioritizes_missing_then_stale() -> None:
    db = FakeDB(
        fundamental_rows=[
            {"symbol": "AAPL", "fetched_at": "2026-05-04T00:00:00+00:00"},
            {"symbol": "MSFT", "fetched_at": "2026-04-01T00:00:00+00:00"},
        ]
    )

    symbols = _select_fundamental_refresh_symbols(db, ["AAPL", "MSFT", "NVDA"], refresh_limit=2)

    assert symbols == ["NVDA", "MSFT"]


def test_select_fundamental_refresh_symbols_returns_full_universe_when_uncapped() -> None:
    db = FakeDB(
        fundamental_rows=[
            {"symbol": "AAPL", "fetched_at": "2026-05-04T00:00:00+00:00"},
            {"symbol": "MSFT", "fetched_at": "2026-04-01T00:00:00+00:00"},
        ]
    )

    symbols = _select_fundamental_refresh_symbols(db, ["AAPL", "MSFT", "NVDA"], refresh_limit=None)

    assert symbols == ["AAPL", "MSFT", "NVDA"]


def test_refresh_universe_reports_degraded_state_when_screener_is_unavailable() -> None:
    class BrokenScreener:
        def screen(self, top_n=None):
            raise FmpScreenerUnavailableError("fmp_unavailable")

    result = refresh_universe(FakeDB(), "strategy-1", BrokenScreener())

    assert result["status"] == "degraded_existing_universe"
    assert result["symbols"] == ["AAPL", "MSFT"]


def test_run_nightly_ingest_refreshes_full_universe_when_uncapped(monkeypatch) -> None:
    db = FakeDB(
        fundamental_rows=[
            {"symbol": "AAPL", "fetched_at": "2026-05-04T00:00:00+00:00"},
            {"symbol": "MSFT", "fetched_at": "2026-05-04T00:00:00+00:00"},
        ]
    )
    prices = FakePricesAdapter()
    fundamentals = FakeFundamentalsAdapter()
    news = FakeNewsAdapter()

    # Force time to be within window (21:00 UTC = 4pm EST)
    monkeypatch.setattr(
        nightly_ingest,
        "settings",
        replace(nightly_ingest.settings, fundamentals_refresh_limit=None),
    )

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=fundamentals,
        news_adapter=news,
        account_adapter=FakeAccountAdapter(),
        now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),  # Within window
        refresh_universe_from_screener=False,
        market_calendar_loader=fake_market_calendar_loader,
    )

    assert summary["fundamental_targets"] == 2
    assert summary["fundamental_rows"] == 2
    assert fundamentals.synced == ["AAPL", "MSFT"]


def test_run_nightly_ingest_marks_pipeline_run_failed_on_error() -> None:
    class EmptyUniverseDB(FakeDB):
        def table(self, table_name: str):
            if table_name == "universes":
                return FakeSelectQuery([])
            return super().table(table_name)

    failing_db = EmptyUniverseDB()

    try:
        run_nightly_ingest(
            db=failing_db,
            prices_adapter=FakePricesAdapter(),
            fundamentals_adapter=FakeFundamentalsAdapter(),
            news_adapter=FakeNewsAdapter(),
            account_adapter=FakeAccountAdapter(),
            now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),
            refresh_universe_from_screener=False,
            market_calendar_loader=fake_market_calendar_loader,
        )
        raise AssertionError("expected RuntimeError for empty universe")
    except RuntimeError as exc:
        assert "Universe is empty" in str(exc)

    assert failing_db.pipeline_runs[FAKE_RUN_ID]["status"] == "failed"
    failed_entries = [e for e in failing_db.inserts if e["action"] == "nightly_ingest_failed"]
    assert len(failed_entries) == 1
    assert failed_entries[0]["payload"]["run_id"] == FAKE_RUN_ID
    assert failed_entries[0]["payload"]["run_date"] == "2026-05-04"


def test_resolve_run_date_uses_most_recent_completed_us_session_after_midnight_utc() -> None:
    run_date = resolve_run_date(
        datetime(2026, 5, 5, 5, 30, tzinfo=UTC),
        market_calendar_loader=fake_market_calendar_loader,
    )

    assert run_date == date(2026, 5, 4)


def test_run_nightly_ingest_records_skipped_invalid_symbols_and_completes() -> None:
    db = FakeDB(universe_symbols=["AAPL", "BRK-B", "MSFT"])
    prices = FakePricesAdapter(skipped_invalid_symbols=["BRK-B"])

    summary = run_nightly_ingest(
        db=db,
        prices_adapter=prices,
        fundamentals_adapter=FakeFundamentalsAdapter(),
        news_adapter=FakeNewsAdapter(),
        account_adapter=FakeAccountAdapter(),
        now=datetime(2026, 5, 4, 21, 0, tzinfo=UTC),
        refresh_universe_from_screener=False,
        market_calendar_loader=fake_market_calendar_loader,
    )

    assert summary["status"] == "ok"
    assert summary["price_rows"] == 3
    assert summary["skipped_invalid_symbols"] == ["BRK-B"]
    assert db.pipeline_runs[FAKE_RUN_ID]["status"] == "ingested"

    price_audits = [entry for entry in db.inserts if entry["action"] == "ingest_prices"]
    assert len(price_audits) == 1
    assert price_audits[0]["payload"]["skipped_invalid_symbols"] == ["BRK-B"]
