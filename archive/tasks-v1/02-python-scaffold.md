# Task 02 — Python Engine Scaffold

**Status:** ⬜ pending  
**Depends on:** 01 (migration must be applied so the smoke test can query strategies)  
**Estimated effort:** 1–2 hours  

---

## Goal
Bootstrap the `engine-py/` Python package: dependency manifest, typed settings, Supabase client singleton, and a smoke test confirming the client can reach the DB.

---

## Files to create

```
engine-py/
├── pyproject.toml
├── .python-version          # "3.12"
├── .env.example
├── artisan/
│   ├── __init__.py
│   ├── config.py
│   └── db/
│       ├── __init__.py
│       └── client.py
└── tests/
    ├── __init__.py
    └── test_smoke.py
```

---

## `pyproject.toml`

```toml
[project]
name = "artisan"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "supabase>=2.10",
  "httpx>=0.27",
  "vaderSentiment>=3.3",
  "pandas>=2.2",
  "pandas-ta>=0.3",
  "numpy>=1.26",
  "anthropic>=0.37",
  "python-dotenv>=1.0",
  "tenacity>=8.3",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "pytest-asyncio>=0.23"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["artisan"]
```

---

## `artisan/config.py`

Read all env vars once at import time. Provide a `Settings` dataclass so the rest of the package never calls `os.getenv` directly.

```python
from dataclasses import dataclass
import os
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

    @classmethod
    def from_env(cls) -> "Settings":
        missing = []
        def require(key: str) -> str:
            v = os.getenv(key)
            if not v:
                missing.append(key)
            return v or ""
        s = cls(
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
        )
        if missing:
            raise EnvironmentError(f"Missing required env vars: {', '.join(missing)}")
        return s

settings = Settings.from_env()
```

---

## `artisan/db/client.py`

Module-level singleton. Imported by all adapters and jobs.

```python
from supabase import create_client, Client
from artisan.config import settings

_client: Client | None = None

def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client
```

---

## `.env.example`

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ALPACA_API_KEY=PK...
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets
FMP_API_KEY=...
FINNHUB_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
STRATEGY_ID=00000000-0000-0000-0000-000000000010
ACCOUNT_ID=00000000-0000-0000-0000-000000000002
ADMIN_USER_ID=00000000-0000-0000-0000-000000000001
LOG_LEVEL=INFO
```

Copy to `.env` for local dev (gitignored). Add all to `engine-py/.gitignore`:
```
.env
__pycache__/
.pytest_cache/
*.pyc
```

---

## `tests/test_smoke.py`

```python
from artisan.db.client import get_client

def test_supabase_reachable():
    db = get_client()
    resp = db.table("strategies").select("id, name").limit(1).execute()
    assert len(resp.data) == 1
    assert resp.data[0]["name"] == "long_term_v0"
```

---

## Setup commands

```bash
cd engine-py

# Install uv if not present
curl -LsSf https://astral.sh/uv/install.sh | sh

# Create venv + install deps
uv sync

# Run smoke test
uv run pytest tests/test_smoke.py -v
```

---

## Acceptance criteria

- [ ] `uv sync` completes without errors
- [ ] `uv run pytest tests/test_smoke.py` → 1 passed
- [ ] Confirm `settings.strategy_id` equals the seeded UUID when printed
