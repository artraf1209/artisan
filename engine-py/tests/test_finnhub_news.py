from __future__ import annotations

from datetime import date

import httpx

from artisan.adapters.finnhub_news import FinnhubNewsAdapter


class FakeQuery:
    def __init__(self, table_name: str, recorder: dict) -> None:
        self.table_name = table_name
        self.recorder = recorder

    def upsert(self, rows, on_conflict: str):
        self.recorder["table"] = self.table_name
        self.recorder["rows"] = rows
        self.recorder["on_conflict"] = on_conflict
        return self

    def execute(self):
        return type("Response", (), {"data": self.recorder["rows"]})()


class FakeDB:
    def __init__(self) -> None:
        self.recorder: dict = {}

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(table_name, self.recorder)


def test_fetch_news_scores_and_filters_articles() -> None:
    payload = [
        {
            "headline": "Apple beats earnings estimates",
            "summary": "Strong demand lifted revenue.",
            "source": "Reuters",
            "url": "https://example.com/apple-1",
            "datetime": 1777593600,
        },
        {
            "headline": "",
            "summary": "Missing headline",
            "source": "Reuters",
            "url": "https://example.com/bad",
            "datetime": 1777593600,
        },
        {
            "headline": "Apple faces product delays",
            "summary": "Launch timing slips.",
            "source": "Reuters",
            "url": "https://example.com/apple-2",
            "datetime": 1777680000,
        },
    ]

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    adapter = FinnhubNewsAdapter(
        db=FakeDB(),
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    rows = adapter.fetch_news("AAPL", date(2026, 5, 1), date(2026, 5, 2))

    assert len(rows) == 2
    assert rows[0]["url"] == "https://example.com/apple-1"
    assert rows[0]["published_at"].endswith("+00:00")
    assert rows[0]["vader_compound"] > rows[1]["vader_compound"]


def test_save_articles_uses_symbol_url_upsert_key() -> None:
    db = FakeDB()
    adapter = FinnhubNewsAdapter(
        db=db,
        http_client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[]))),
    )

    rows = [
        {
            "symbol": "AAPL",
            "headline": "Apple beats estimates",
            "summary": None,
            "source": "Reuters",
            "url": "https://example.com/apple-1",
            "published_at": "2026-05-01T00:00:00+00:00",
            "vader_compound": 0.7,
            "fetched_at": "2026-05-01T01:00:00+00:00",
        }
    ]

    saved = adapter.save_articles(rows)

    assert saved == 1
    assert db.recorder["table"] == "news_articles"
    assert db.recorder["on_conflict"] == "symbol,url"
