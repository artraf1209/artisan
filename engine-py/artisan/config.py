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
    fmp_quota_reset_hour_utc: int
    fmp_quota_reset_minute_utc: int
    fmp_quota_buffer_minutes: int
    force_pre_reset_ingest: bool

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

        def as_bool(key: str, default: bool = False) -> bool:
            value = os.getenv(key, "").lower()
            if value == "":
                return default
            return value in ("true", "1", "yes")

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
            fmp_quota_reset_hour_utc=as_int("FMP_QUOTA_RESET_HOUR_UTC", 20),  # 8pm UTC = 3pm EST
            fmp_quota_reset_minute_utc=as_int("FMP_QUOTA_RESET_MINUTE_UTC", 0),
            fmp_quota_buffer_minutes=as_int("FMP_QUOTA_BUFFER_MINUTES", 60),
            force_pre_reset_ingest=as_bool("FORCE_PRE_RESET_INGEST", False),
        )
        if missing:
            missing_list = ", ".join(missing)
            raise EnvironmentError(f"Missing required env vars: {missing_list}")
        return settings


settings = Settings.from_env()
