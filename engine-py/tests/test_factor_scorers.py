from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from artisan.scorers.factor_composite import score_universe
from artisan.scorers.growth_scorer import compute_growth_scores
from artisan.scorers.low_vol_scorer import compute_low_vol_scores
from artisan.scorers.quality_scorer import compute_quality_scores
from artisan.scorers.value_scorer import compute_value_scores
from artisan.strategy_params import StrategyParams

TEST_STRATEGY_PARAMS = StrategyParams(
    risk_per_trade_pct=0.01,
    max_position_pct=0.10,
    max_concurrent_positions=15,
    max_sector_exposure_pct=0.25,
    max_portfolio_heat_pct=0.08,
    daily_drawdown_kill_switch_pct=-0.03,
    max_drawdown_tolerance_pct=0.18,
    shortlist_size=50,
    daily_recommendation_cap=10,
    factor_weights={"value": 0.25, "quality": 0.25, "momentum": 0.25, "low_vol": 0.10, "growth": 0.15},
    max_holding_period_days=30,
    horizon_baseline_days={"pullback": 20, "breakout": 15, "squeeze": 10},
    regime_multipliers={"risk_on": 1.0, "neutral": 0.85, "risk_off": 0.65},
    earnings_blackout_pre_days=3,
    earnings_blackout_post_days=1,
    trailing_stop_atr_multiple=2,
    breakeven_trigger_r=1,
    auto_apply_stop_tightening=True,
    target_annual_return_pct=0.25,
    benchmark_symbol="SPY",
    llm_daily_cost_cap_usd=5.0,
)


def test_compute_value_scores_prefers_cheaper_names() -> None:
    fund_df = pd.DataFrame(
        [
            {
                "symbol": "CHEAP",
                "market_cap": 100.0,
                "net_income": 20.0,
                "book_equity": 90.0,
                "revenue": 220.0,
                "fcf": 18.0,
                "ebitda": 25.0,
                "total_debt": 10.0,
                "cash": 20.0,
            },
            {
                "symbol": "EXPENSIVE",
                "market_cap": 220.0,
                "net_income": 10.0,
                "book_equity": 45.0,
                "revenue": 110.0,
                "fcf": 5.0,
                "ebitda": 12.0,
                "total_debt": 35.0,
                "cash": 8.0,
            },
        ]
    ).set_index("symbol")
    sectors = pd.Series({"CHEAP": "Tech", "EXPENSIVE": "Tech"})

    scores = compute_value_scores(fund_df, sectors)

    assert scores["CHEAP"] > scores["EXPENSIVE"]
    assert scores.notna().all()


def test_compute_quality_scores_prefers_higher_quality_names() -> None:
    fund_df = pd.DataFrame(
        [
            {
                "symbol": "QUALITY",
                "gross_profit": 90.0,
                "total_assets": 180.0,
                "net_income": 32.0,
                "roe": 0.22,
                "operating_cash_flow": 40.0,
                "revenue": 150.0,
                "total_debt": 18.0,
                "cash": 20.0,
                "ebitda": 50.0,
                "interest_expense": 2.0,
            },
            {
                "symbol": "WEAK",
                "gross_profit": 30.0,
                "total_assets": 170.0,
                "net_income": 8.0,
                "roe": 0.06,
                "operating_cash_flow": 6.0,
                "revenue": 150.0,
                "total_debt": 90.0,
                "cash": 5.0,
                "ebitda": 18.0,
                "interest_expense": 8.0,
            },
        ]
    ).set_index("symbol")
    sectors = pd.Series({"QUALITY": "Tech", "WEAK": "Tech"})

    scores = compute_quality_scores(fund_df, sectors)

    assert scores["QUALITY"] > scores["WEAK"]
    assert scores.notna().all()


def test_compute_growth_scores_uses_historical_fcf_rows() -> None:
    fund_df = pd.DataFrame(
        [
            {"symbol": "GROW", "fcf": 64.0},
            {"symbol": "SHRINK", "fcf": 8.0},
        ]
    ).set_index("symbol")
    sectors = pd.Series({"GROW": "Tech", "SHRINK": "Tech"})
    history = {
        "GROW": [
            {"revenue": 100.0, "eps": 10.0, "fcf": 1.0},
            {"revenue": 80.0, "eps": 8.0, "fcf": 4.0},
            {"revenue": 50.0, "eps": 6.0, "fcf": 6.0},
            {"revenue": 25.0, "eps": 4.0, "fcf": 8.0},
        ],
        "SHRINK": [
            {"revenue": 80.0, "eps": 4.0, "fcf": 99.0},
            {"revenue": 90.0, "eps": 5.0, "fcf": 48.0},
            {"revenue": 100.0, "eps": 6.0, "fcf": 32.0},
            {"revenue": 120.0, "eps": 8.0, "fcf": 64.0},
        ],
    }

    scores = compute_growth_scores(fund_df, history, sectors)

    assert scores["GROW"] > scores["SHRINK"]
    assert scores.notna().all()


def test_compute_low_vol_scores_prefers_stabler_name_with_long_history() -> None:
    periods = 1_400
    dates = pd.date_range("2020-01-01", periods=periods, freq="B")
    steps = np.arange(periods)

    spy_returns = 0.00035 + 0.003 * np.sin(steps / 19)
    stable_returns = 0.00030 + (0.50 * spy_returns) + 0.001 * np.cos(steps / 31)
    wild_returns = 0.00045 + (1.80 * spy_returns) + 0.010 * np.sin(steps / 5)

    price_df = pd.DataFrame(
        {
            "STABLE": 100 * np.exp(np.cumsum(stable_returns)),
            "WILD": 100 * np.exp(np.cumsum(wild_returns)),
        },
        index=dates,
    )
    spy_series = pd.Series(100 * np.exp(np.cumsum(spy_returns)), index=dates)
    sectors = pd.Series({"STABLE": "Tech", "WILD": "Tech"})

    scores = compute_low_vol_scores(price_df, spy_series, sectors)

    assert scores["STABLE"] > scores["WILD"]
    assert scores.notna().all()


def test_score_universe_marks_hard_filter_failures_unranked() -> None:
    class FakeFactorScoresQuery:
        def __init__(self, prev_rows: list[dict]) -> None:
            self.prev_rows = prev_rows
            self.upserts: list[dict] = []
            self.mode = "select"

        def select(self, _fields: str):
            self.mode = "select"
            return self

        def eq(self, _column: str, _value):
            return self

        def order(self, _column: str, desc: bool = False):
            return self

        def limit(self, _limit: int):
            return self

        def upsert(self, rows, on_conflict: str):
            self.mode = "upsert"
            self.upserts.append({"rows": rows, "on_conflict": on_conflict})
            return self

        def execute(self):
            if self.mode == "select":
                return type("Response", (), {"data": self.prev_rows})()
            return type("Response", (), {"data": []})()

    class FakeDB:
        def __init__(self, prev_rows: list[dict]) -> None:
            self.factor_scores = FakeFactorScoresQuery(prev_rows)

        def table(self, table_name: str):
            if table_name != "factor_scores":
                raise AssertionError(f"Unexpected table: {table_name}")
            return self.factor_scores

    fundamentals = [
        {
            "symbol": "AAPL",
            "fcf": 40.0,
            "ebitda": 50.0,
            "total_debt": 20.0,
            "cash": 10.0,
            "net_income": 30.0,
            "book_equity": 100.0,
            "revenue": 220.0,
            "market_cap": 140.0,
            "gross_profit": 95.0,
            "total_assets": 180.0,
            "roe": 0.20,
            "operating_cash_flow": 42.0,
            "interest_expense": 3.0,
        },
        {
            "symbol": "MSFT",
            "fcf": 22.0,
            "ebitda": 35.0,
            "total_debt": 25.0,
            "cash": 8.0,
            "net_income": 18.0,
            "book_equity": 70.0,
            "revenue": 170.0,
            "market_cap": 180.0,
            "gross_profit": 60.0,
            "total_assets": 175.0,
            "roe": 0.15,
            "operating_cash_flow": 20.0,
            "interest_expense": 5.0,
        },
        {
            "symbol": "RISK",
            "fcf": -5.0,
            "ebitda": 12.0,
            "total_debt": 80.0,
            "cash": 5.0,
            "net_income": 6.0,
            "book_equity": 20.0,
            "revenue": 80.0,
            "market_cap": 90.0,
            "gross_profit": 18.0,
            "total_assets": 120.0,
            "roe": 0.05,
            "operating_cash_flow": 4.0,
            "interest_expense": 8.0,
        },
    ]
    history = {
        "AAPL": [
            {"revenue": 220.0, "eps": 7.0, "fcf": 30.0},
            {"revenue": 200.0, "eps": 6.5, "fcf": 26.0},
            {"revenue": 170.0, "eps": 5.5, "fcf": 22.0},
            {"revenue": 120.0, "eps": 4.0, "fcf": 15.0},
        ],
        "MSFT": [
            {"revenue": 170.0, "eps": 6.0, "fcf": 20.0},
            {"revenue": 165.0, "eps": 5.8, "fcf": 19.0},
            {"revenue": 150.0, "eps": 5.2, "fcf": 16.0},
            {"revenue": 140.0, "eps": 5.0, "fcf": 14.0},
        ],
        "RISK": [
            {"revenue": 80.0, "eps": 2.0, "fcf": -5.0},
            {"revenue": 78.0, "eps": 2.1, "fcf": -4.0},
            {"revenue": 76.0, "eps": 2.2, "fcf": -3.0},
            {"revenue": 74.0, "eps": 2.3, "fcf": -2.0},
        ],
    }
    dates = pd.date_range("2025-01-01", periods=300, freq="B")
    steps = np.arange(len(dates))
    spy_returns = 0.00035 + 0.0025 * np.sin(steps / 20)
    aapl_returns = 0.00045 + 0.45 * spy_returns
    msft_returns = 0.00040 + 0.90 * spy_returns + 0.004 * np.sin(steps / 7)
    risk_returns = 0.00020 + 1.40 * spy_returns + 0.008 * np.cos(steps / 5)
    price_df = pd.DataFrame(
        {
            "AAPL": 100 * np.exp(np.cumsum(aapl_returns)),
            "MSFT": 100 * np.exp(np.cumsum(msft_returns)),
            "RISK": 100 * np.exp(np.cumsum(risk_returns)),
        },
        index=dates,
    )
    spy_series = pd.Series(100 * np.exp(np.cumsum(spy_returns)), index=dates)
    sectors = {"AAPL": "Tech", "MSFT": "Tech", "RISK": "Tech"}
    prev_rows = [
        {
            "symbol": "AAPL",
            "value_z": 0.25,
            "quality_z": 0.10,
            "momentum_z": 0.20,
            "low_vol_z": 0.05,
            "growth_z": 0.15,
            "rank": 2,
        }
    ]
    db = FakeDB(prev_rows)

    results = score_universe(
        db=db,
        strategy_id="strategy-1",
        strategy_params=TEST_STRATEGY_PARAMS,
        run_id="run-1",
        fundamentals=fundamentals,
        income_history=history,
        price_df=price_df,
        spy_series=spy_series,
        sectors=sectors,
        scored_at="2026-05-04T13:30:00+00:00",
    )

    risk_row = next(row for row in results if row["symbol"] == "RISK")
    aapl_row = next(row for row in results if row["symbol"] == "AAPL")

    assert risk_row["hard_filter_pass"] is False
    assert risk_row["rank"] is None
    assert aapl_row["hard_filter_pass"] is True
    assert aapl_row["rank"] is not None
    assert aapl_row["value_prev"] == 0.25
    assert aapl_row["run_id"] == "run-1"
    # AAPL was already in the prior run's top-30 (rank=2) -> not new; MSFT wasn't -> new
    assert aapl_row["is_new"] is False
    msft_row = next(row for row in results if row["symbol"] == "MSFT")
    assert msft_row["is_new"] is True
    assert db.factor_scores.upserts[0]["on_conflict"] == "symbol,strategy_id,scored_at"
    assert len(db.factor_scores.upserts[0]["rows"]) == 3


def test_score_universe_reads_factor_weights_and_shortlist_size_from_strategy_params() -> None:
    """Config-driven wiring: different factor_weights/shortlist_size change the output
    without any code change, proving there's no hardcoded FACTOR_WEIGHTS/top-N left."""

    class NoopFactorScoresQuery:
        def select(self, _fields: str):
            return self

        def eq(self, _column: str, _value):
            return self

        def order(self, _column: str, desc: bool = False):
            return self

        def limit(self, _limit: int):
            return self

        def upsert(self, rows, on_conflict: str):
            self.upserted = rows
            return self

        def execute(self):
            return type("Response", (), {"data": getattr(self, "upserted", [])})()

    class NoopDB:
        def __init__(self) -> None:
            self.factor_scores = NoopFactorScoresQuery()

        def table(self, _name: str):
            return self.factor_scores

    fundamentals = [
        {
            "symbol": "VALUE_HEAVY",
            "fcf": 40.0, "ebitda": 50.0, "total_debt": 20.0, "cash": 10.0,
            "net_income": 30.0, "book_equity": 100.0, "revenue": 220.0, "market_cap": 60.0,
            "gross_profit": 60.0, "total_assets": 150.0, "roe": 0.10, "operating_cash_flow": 20.0,
            "interest_expense": 3.0,
        },
        {
            "symbol": "QUALITY_HEAVY",
            "fcf": 20.0, "ebitda": 30.0, "total_debt": 20.0, "cash": 10.0,
            "net_income": 30.0, "book_equity": 100.0, "revenue": 220.0, "market_cap": 220.0,
            "gross_profit": 95.0, "total_assets": 180.0, "roe": 0.25, "operating_cash_flow": 45.0,
            "interest_expense": 1.0,
        },
    ]
    history = {
        "VALUE_HEAVY": [{"revenue": 220.0, "eps": 7.0, "fcf": 40.0}] * 4,
        "QUALITY_HEAVY": [{"revenue": 220.0, "eps": 7.0, "fcf": 20.0}] * 4,
    }
    dates = pd.date_range("2025-01-01", periods=300, freq="B")
    price_df = pd.DataFrame(
        {"VALUE_HEAVY": np.full(len(dates), 100.0), "QUALITY_HEAVY": np.full(len(dates), 100.0)},
        index=dates,
    )
    spy_series = pd.Series(np.full(len(dates), 100.0), index=dates)
    sectors = {"VALUE_HEAVY": "Tech", "QUALITY_HEAVY": "Tech"}

    value_tilted = replace(
        TEST_STRATEGY_PARAMS,
        factor_weights={"value": 0.9, "quality": 0.025, "momentum": 0.025, "low_vol": 0.025, "growth": 0.025},
        shortlist_size=1,
    )
    quality_tilted = replace(
        TEST_STRATEGY_PARAMS,
        factor_weights={"value": 0.025, "quality": 0.9, "momentum": 0.025, "low_vol": 0.025, "growth": 0.025},
        shortlist_size=1,
    )

    value_run = score_universe(
        db=NoopDB(), strategy_id="strategy-1", strategy_params=value_tilted, run_id="run-a",
        fundamentals=fundamentals, income_history=history, price_df=price_df,
        spy_series=spy_series, sectors=sectors, scored_at="2026-05-04T13:30:00+00:00",
    )
    quality_run = score_universe(
        db=NoopDB(), strategy_id="strategy-1", strategy_params=quality_tilted, run_id="run-b",
        fundamentals=fundamentals, income_history=history, price_df=price_df,
        spy_series=spy_series, sectors=sectors, scored_at="2026-05-04T13:30:00+00:00",
    )

    value_winner = next(r["symbol"] for r in value_run if r["rank"] == 1)
    quality_winner = next(r["symbol"] for r in quality_run if r["rank"] == 1)
    assert value_winner == "VALUE_HEAVY"
    assert quality_winner == "QUALITY_HEAVY"
    # shortlist_size=1 -> only the top-ranked symbol can be flagged is_new
    assert sum(1 for r in value_run if r["is_new"]) <= 1
