from __future__ import annotations

import os


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
