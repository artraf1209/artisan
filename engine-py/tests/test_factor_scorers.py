from __future__ import annotations

import numpy as np
import pandas as pd

from artisan.scorers.factor_composite import score_universe
from artisan.scorers.growth_scorer import compute_growth_scores
from artisan.scorers.low_vol_scorer import compute_low_vol_scores
from artisan.scorers.quality_scorer import compute_quality_scores
from artisan.scorers.value_scorer import compute_value_scores


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
    assert db.factor_scores.upserts[0]["on_conflict"] == "symbol,strategy_id,scored_at"
    assert len(db.factor_scores.upserts[0]["rows"]) == 3
