from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

from artisan.config import settings
from artisan.db.client import get_client

logger = logging.getLogger(__name__)


def _is_retryable_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or exc.response.status_code >= 500
    return isinstance(exc, httpx.TransportError)


class FinnhubNewsAdapter:
    def __init__(
        self,
        db=None,
        http_client: httpx.Client | None = None,
        base_url: str = "https://finnhub.io/api/v1",
    ) -> None:
        self.db = db or get_client()
        self.http_client = http_client or httpx.Client(timeout=30.0)
        self.base_url = base_url.rstrip("/")
        self.analyzer = SentimentIntensityAnalyzer()

    @retry(
        retry=retry_if_exception(_is_retryable_error),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _request_news(self, symbol: str, start: date, end: date) -> list[dict[str, Any]]:
        response = self.http_client.get(
            f"{self.base_url}/company-news",
            params={
                "symbol": symbol,
                "from": start.isoformat(),
                "to": end.isoformat(),
                "token": settings.finnhub_api_key,
            },
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, list) else []

    @staticmethod
    def _published_at(unix_seconds: int | float | None) -> str:
        if unix_seconds is None:
            return datetime.now(timezone.utc).isoformat()
        return datetime.fromtimestamp(unix_seconds, tz=timezone.utc).isoformat()

    def score_headline(self, headline: str, summary: str | None = None) -> float:
        text = headline if not summary else f"{headline}\n{summary}"
        score = self.analyzer.polarity_scores(text)["compound"]
        return float(score)

    def fetch_news(self, symbol: str, start: date, end: date) -> list[dict]:
        payload = self._request_news(symbol, start, end)
        rows: list[dict] = []

        for article in payload:
            headline = article.get("headline")
            url = article.get("url")
            if not headline or not url:
                continue

            summary = article.get("summary")
            rows.append(
                {
                    "symbol": symbol,
                    "headline": headline,
                    "summary": summary,
                    "source": article.get("source"),
                    "url": url,
                    "published_at": self._published_at(article.get("datetime")),
                    "vader_compound": self.score_headline(headline, summary),
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                }
            )

        logger.info("Fetched %s news articles for %s", len(rows), symbol)
        return rows

    def save_articles(self, rows: list[dict]) -> int:
        if not rows:
            return 0

        self.db.table("news_articles").upsert(rows, on_conflict="symbol,url").execute()
        logger.info("Upserted %s news articles", len(rows))
        return len(rows)
