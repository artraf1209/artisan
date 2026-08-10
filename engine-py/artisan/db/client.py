from __future__ import annotations

from typing import Any, Callable

from supabase import Client, create_client

from artisan.config import settings

_client: Client | None = None

DEFAULT_PAGE_SIZE = 1000


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


def fetch_all_pages(build_query: Callable[[], Any], page_size: int = DEFAULT_PAGE_SIZE) -> list[dict]:
    """Pages through a PostgREST query past the project's default row cap
    (discovered while building v2-04/v2-05: a plain .select()...limit(N) with
    N > the cap silently truncates from the wrong end for large tables like
    price_bars). build_query must return a FRESH, already filtered/ordered
    query builder on every call (supabase-py query objects are single-use) —
    callers are responsible for including a stable .order() for deterministic
    pagination.
    """
    rows: list[dict] = []
    start = 0
    while True:
        page = build_query().range(start, start + page_size - 1).execute().data
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return rows
