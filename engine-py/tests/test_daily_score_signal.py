from __future__ import annotations

from datetime import UTC, datetime

import pandas as pd

import artisan.jobs.daily_score_signal as daily_score_signal
from artisan.jobs.daily_score_signal import _load_latest_fundamentals, _load_price_df, run_daily_score_signal


class FakeInsertQuery:
    def __init__(self, table_name: str, saves: list[dict], data: list[dict] | None = None) -> None:
        self.table_name = table_name
        self.saves = saves
        self.data = data or []

    def select(self, _fields: str):
        return self

    def eq(self, _column: str, _value):
        return self

    def limit(self, _limit: int):
        return self

    def upsert(self, row, on_conflict: str):
        self.saves.append({"table": self.table_name, "row": row, "on_conflict": on_conflict})
        return self

    def insert(self, row: dict):
        self.saves.append({"table": self.table_name, "row": row})
        return self

    def execute(self):
        return type("Response", (), {"data": self.data})()


class FakeDB:
    def __init__(self) -> None:
        self.saves: list[dict] = []

    def table(self, table_name: str):
        if table_name == "accounts":
            return FakeInsertQuery(table_name, self.saves, data=[{"equity": 125000}])
        if table_name in {"entry_signals", "audit_log"}:
            return FakeInsertQuery(table_name, self.saves)
        raise AssertionError(f"Unexpected table: {table_name}")


class FakePriceQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.range_start = 0
        self.range_end = len(rows) - 1

    def select(self, _fields: str):
        return self

    def in_(self, _column: str, _values):
        return self

    def gte(self, _column: str, _value):
        return self

    def order(self, _column: str, desc: bool = False):
        assert desc is False
        return self

    def range(self, start: int, end: int):
        self.range_start = start
        self.range_end = end
        return self

    def execute(self):
        data = self.rows[self.range_start:self.range_end + 1]
        return type("Response", (), {"data": data})()


class FakePriceDB:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def table(self, table_name: str):
        if table_name != "price_bars":
            raise AssertionError(f"Unexpected table: {table_name}")
        return FakePriceQuery(self.rows)


class FakeFundamentalsQuery:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def select(self, _fields: str):
        return self

    def in_(self, _column: str, _values):
        return self

    def order(self, _column: str, desc: bool = False):
        if _column == "fetched_at":
            self.rows.sort(key=lambda row: row["fetched_at"], reverse=desc)
        elif _column == "period_end":
            self.rows.sort(key=lambda row: row["period_end"], reverse=desc)
        return self

    def limit(self, limit: int):
        self.rows = self.rows[:limit]
        return self

    def execute(self):
        return type("Response", (), {"data": self.rows})()


class FakeFundamentalsDB:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows

    def table(self, table_name: str):
        if table_name != "fundamentals":
            raise AssertionError(f"Unexpected table: {table_name}")
        return FakeFundamentalsQuery(list(self.rows))


def test_load_price_df_paginates_beyond_supabase_row_cap() -> None:
    index = pd.date_range("2021-01-01", periods=1253, freq="D")
    rows = [
        {
            "symbol": symbol,
            "bar_time": ts.isoformat(),
            "close": 100 + idx,
        }
        for idx, ts in enumerate(index)
        for symbol in ("AAPL", "SPY")
    ]

    wide = _load_price_df(FakePriceDB(rows), ["AAPL"], days=10)

    assert not wide.empty
    assert {"AAPL", "SPY"}.issubset(set(wide.columns))
    assert len(wide) == len(index)


def test_load_latest_fundamentals_prefers_most_recent_period_for_same_fetch() -> None:
    rows = [
        {
            "symbol": "AAPL",
            "period_end": "2024-09-28",
            "period_type": "annual",
            "market_cap": None,
            "fetched_at": "2026-05-06T15:35:48.777249+00:00",
        },
        {
            "symbol": "AAPL",
            "period_end": "2025-09-28",
            "period_type": "annual",
            "market_cap": 1000.0,
            "fetched_at": "2026-05-06T15:35:48.777249+00:00",
        },
        {
            "symbol": "MSFT",
            "period_end": "2025-06-30",
            "period_type": "annual",
            "market_cap": 2000.0,
            "fetched_at": "2026-05-06T15:35:48.777249+00:00",
        },
    ]

    latest = _load_latest_fundamentals(FakeFundamentalsDB(rows), ["AAPL", "MSFT"])
    by_symbol = {row["symbol"]: row for row in latest}

    assert by_symbol["AAPL"]["period_end"] == "2025-09-28"
    assert by_symbol["AAPL"]["market_cap"] == 1000.0


def test_daily_score_signal_only_generates_entry_signals_for_ranked_shortlist(monkeypatch) -> None:
    entry_symbols: list[str] = []

    class FakeTechnicalScorer:
        def __init__(self, db) -> None:
            self.db = db

        def score_symbol(self, symbol: str, computed_at: str):
            close_series = pd.Series([100 + idx for idx in range(260)], dtype=float)
            return {
                "symbol": symbol,
                "computed_at": computed_at,
                "rsi_14": 55.0,
                "macd_line": 1.0,
                "macd_signal": 0.5,
                "macd_hist": 0.5,
                "bb_upper": 120.0,
                "bb_mid": 110.0,
                "bb_lower": 100.0,
                "atr_14": 2.0,
                "sma_50": 115.0,
                "sma_200": 105.0,
                "adx_14": 25.0,
                "obv": 5000.0,
                "vol_ratio": 1.5,
                "close": float(close_series.iloc[-1]),
                "t_score": 0.8,
                "_snapshot": {
                    "close": float(close_series.iloc[-1]),
                    "rsi_14": 55.0,
                    "macd_hist": 0.5,
                    "atr_14": 2.0,
                    "sma_50": 115.0,
                    "sma_200": 105.0,
                    "adx_14": 25.0,
                    "vol_ratio": 1.5,
                    "bb_upper": 120.0,
                    "bb_mid": 110.0,
                    "bb_lower": 100.0,
                    "_close_series": close_series,
                    "_high_series": close_series + 1,
                    "_low_series": close_series - 1,
                    "_obv_series": pd.Series([1000 + idx for idx in range(260)], dtype=float),
                    "_macd_hist_series": pd.Series([0.1 + (idx / 1000) for idx in range(260)], dtype=float),
                },
            }

    class FakeFundamentalScorer:
        def __init__(self, db) -> None:
            self.db = db

        def score_symbol(self, symbol: str):
            return {"f_score": 0.75, "row": {"symbol": symbol}}

    class FakeSentimentScorer:
        def __init__(self, db) -> None:
            self.db = db

        def score_symbol(self, symbol: str, now):
            return {"s_score": 0.7}

    class FakeCompositeScorer:
        def __init__(self, db) -> None:
            self.db = db

        def fetch_strategy(self, _strategy_id: str):
            return {"id": "strategy-1", "max_positions": 1}

        def score_symbol(self, **kwargs):
            return {"symbol": kwargs["symbol"], "composite": 0.8}

    class FakeSignalPipeline:
        def __init__(self, db) -> None:
            self.db = db

        def process_symbol(self, **kwargs):
            return {"symbol": kwargs["composite_row"]["symbol"]}

    class FakeThesisAnalyst:
        def __init__(self, db) -> None:
            self.db = db

        def run(self, *, now):
            assert now == datetime(2026, 5, 4, 13, 30, tzinfo=UTC)
            return {"theses_created": 1, "theses_failed": 0, "signals_skipped": 0}

    def fake_score_universe(**kwargs):
        assert kwargs["income_history"]["AAPL"][0]["fcf"] == 10.0
        return [
            {"symbol": "AAPL", "hard_filter_pass": True, "rank": 1},
            {"symbol": "MSFT", "hard_filter_pass": True, "rank": 2},
        ]

    def fake_evaluate_entry(*, symbol: str, **kwargs):
        entry_symbols.append(symbol)
        return {
            "symbol": symbol,
            "strategy_id": kwargs["strategy_id"],
            "evaluated_at": kwargs["evaluated_at"],
            "gate_market": True,
            "gate_trend": True,
            "setup_type": "pullback",
            "gate_confirmed": True,
            "entry_price": 100.0,
            "stop_price": 96.0,
            "target_price": 112.0,
            "atr": 2.0,
            "r_multiple": 3.0,
            "shares": 25,
            "dollar_risk": 100.0,
            "actionable": True,
        }

    monkeypatch.setattr(daily_score_signal, "load_universe", lambda db, strategy_id: ["AAPL", "MSFT"])
    monkeypatch.setattr(daily_score_signal, "_load_price_df", lambda db, symbols: pd.DataFrame({
        "AAPL": [100 + idx for idx in range(260)],
        "MSFT": [110 + idx for idx in range(260)],
        "SPY": [90 + idx for idx in range(260)],
    }))
    monkeypatch.setattr(
        daily_score_signal,
        "_load_latest_fundamentals",
        lambda db, symbols: [
            {"symbol": "AAPL", "fcf": 10.0, "ebitda": 20.0},
            {"symbol": "MSFT", "fcf": 12.0, "ebitda": 22.0},
        ],
    )
    monkeypatch.setattr(
        daily_score_signal,
        "_load_fundamental_history",
        lambda db, symbols: {
            "AAPL": [{"symbol": "AAPL", "period_end": "2025-09-28", "revenue": 100.0, "eps": 6.0, "fcf": 10.0}],
            "MSFT": [{"symbol": "MSFT", "period_end": "2025-09-28", "revenue": 120.0, "eps": 7.0, "fcf": 12.0}],
        },
    )
    monkeypatch.setattr(daily_score_signal, "_load_sectors", lambda db, symbols: {"AAPL": "Tech", "MSFT": "Tech"})
    monkeypatch.setattr(daily_score_signal, "TechnicalScorer", FakeTechnicalScorer)
    monkeypatch.setattr(daily_score_signal, "FundamentalScorer", FakeFundamentalScorer)
    monkeypatch.setattr(daily_score_signal, "SentimentScorer", FakeSentimentScorer)
    monkeypatch.setattr(daily_score_signal, "CompositeScorer", FakeCompositeScorer)
    monkeypatch.setattr(daily_score_signal, "SignalPipeline", FakeSignalPipeline)
    monkeypatch.setattr(daily_score_signal, "ThesisAnalyst", FakeThesisAnalyst)
    monkeypatch.setattr(daily_score_signal, "score_universe", fake_score_universe)
    monkeypatch.setattr(daily_score_signal, "evaluate_entry", fake_evaluate_entry)

    summary = run_daily_score_signal(
        db=FakeDB(),
        now=datetime(2026, 5, 4, 13, 30, tzinfo=UTC),
    )

    assert summary["symbols"] == 2
    assert summary["signals_created"] == 2
    assert summary["factor_scores"] == 2
    assert summary["entry_shortlist"] == 1
    assert summary["entry_signals"] == 1
    assert summary["theses_created"] == 1
    assert entry_symbols == ["AAPL"]
