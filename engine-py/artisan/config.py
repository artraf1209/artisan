from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    alpaca_api_key: str
    alpaca_api_secret: str
    alpaca_base_url: str
    fmp_api_key: str
    finnhub_api_key: str
    anthropic_api_key: str
    strategy_id: str
    account_id: str
    admin_user_id: str
    log_level: str
    screener_top_n: int
    fundamentals_refresh_limit: int
    price_history_lookback_days: int

    @classmethod
    def from_env(cls) -> "Settings":
        missing: list[str] = []

        def require(key: str) -> str:
            value = os.getenv(key)
            if not value:
                missing.append(key)
            return value or ""

        def as_int(key: str, default: int) -> int:
            value = os.getenv(key)
            if value is None or value == "":
                return default
            return int(value)

        settings = cls(
            supabase_url=require("SUPABASE_URL"),
            supabase_service_role_key=require("SUPABASE_SERVICE_ROLE_KEY"),
            alpaca_api_key=require("ALPACA_API_KEY"),
            alpaca_api_secret=require("ALPACA_API_SECRET"),
            alpaca_base_url=os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
            fmp_api_key=require("FMP_API_KEY"),
            finnhub_api_key=require("FINNHUB_API_KEY"),
            anthropic_api_key=require("ANTHROPIC_API_KEY"),
            strategy_id=os.getenv("STRATEGY_ID", "00000000-0000-0000-0000-000000000010"),
            account_id=os.getenv("ACCOUNT_ID", "00000000-0000-0000-0000-000000000002"),
            admin_user_id=os.getenv("ADMIN_USER_ID", "00000000-0000-0000-0000-000000000001"),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            screener_top_n=as_int("SCREENER_TOP_N", 40),
            fundamentals_refresh_limit=as_int("FUNDAMENTALS_REFRESH_LIMIT", 20),
            price_history_lookback_days=as_int("PRICE_HISTORY_LOOKBACK_DAYS", 1900),
        )
        if missing:
            missing_list = ", ".join(missing)
            raise EnvironmentError(f"Missing required env vars: {missing_list}")
        return settings


settings = Settings.from_env()
