from __future__ import annotations

import os

import pytest


def pytest_configure() -> None:
    defaults = {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
        "ALPACA_API_KEY": "alpaca-key",
        "ALPACA_API_SECRET": "alpaca-secret",
        "ALPACA_BASE_URL": "https://paper-api.alpaca.markets",
        "FMP_API_KEY": "fmp-key",
        "FINNHUB_API_KEY": "finnhub-key",
        "ANTHROPIC_API_KEY": "anthropic-key",
        "STRATEGY_ID": "00000000-0000-0000-0000-000000000010",
        "ACCOUNT_ID": "00000000-0000-0000-0000-000000000002",
        "ADMIN_USER_ID": "00000000-0000-0000-0000-000000000001",
        "LOG_LEVEL": "INFO",
    }
    for key, value in defaults.items():
        os.environ.setdefault(key, value)


@pytest.fixture
def strategy_params() -> "StrategyParams":
    """v2 default strategy config (matches supabase/seed.sql), for tests that need
    a fully-populated StrategyParams without hitting the DB.

    Imported lazily (not at module scope) so that importing conftest.py itself
    doesn't trigger artisan.config's load_dotenv()/Settings.from_env() before
    pytest_configure() has set the dummy env var defaults above — doing it at
    module scope leaks real .env values into the whole test session.
    """
    from artisan.strategy_params import StrategyParams

    return StrategyParams(
        risk_per_trade_pct=0.01,
        max_position_pct=0.10,
        max_concurrent_positions=15,
        max_sector_exposure_pct=0.25,
        max_portfolio_heat_pct=0.08,
        daily_drawdown_kill_switch_pct=-0.03,
        max_drawdown_tolerance_pct=0.18,
        shortlist_size=30,
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
