from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from artisan.agents.base import (
    AGENT_MODELS,
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_SENTIMENT_ANALYSIS_TOOL,
    compute_cost_usd,
    get_anthropic_client,
    load_prompt,
    prompt_version,
    run_agent,
    validate_required_fields,
)
from artisan.agents.orchestrator import write_agent_analysis
from artisan.db.client import get_client

logger = logging.getLogger(__name__)

AGENT_NAME = "sentiment_analyst"
AGENT_TYPE = "sentiment"
REQUIRED_FIELDS = (
    "symbol", "summary", "sentiment_direction", "materiality",
    "catalysts_identified", "red_flags", "historical_precedent",
)

NEWS_LOOKBACK_DAYS = 10
NEWS_LIMIT = 20


def _load_context(db: Any, symbol: str, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    since = (now - timedelta(days=NEWS_LOOKBACK_DAYS)).isoformat()
    return (
        db.table("news_articles")
        .select("headline,summary,source,published_at,vader_compound")
        .eq("symbol", symbol)
        .gte("published_at", since)
        .order("published_at", desc=True)
        .limit(NEWS_LIMIT)
        .execute()
        .data
    )


def _build_user_content(symbol: str, articles: list[dict[str, Any]]) -> str:
    lines = [f"Symbol: {symbol}", f"Articles in the last {NEWS_LOOKBACK_DAYS} days: {len(articles)}", ""]
    if not articles:
        lines.append("(no articles in the provided window)")
    for article in articles:
        lines.append(
            f"- [{article.get('published_at')}] ({article.get('source')}, "
            f"lexicon_score={article.get('vader_compound')}) {article.get('headline')}"
        )
        if article.get("summary"):
            lines.append(f"  {article['summary']}")
    return "\n".join(lines)


async def analyze(
    symbol: str,
    *,
    run_id: str,
    db: Any = None,
    client: Any = None,
) -> dict[str, Any]:
    """Runs the Sentiment Analyst for one symbol and persists the result to
    agent_analyses. See fundamental_analyst.analyze for the concurrency pattern."""
    db = db or get_client()
    client = client or get_anthropic_client()

    articles = _load_context(db, symbol)
    system_prompt = load_prompt(AGENT_NAME)
    user_content = _build_user_content(symbol, articles)
    model = AGENT_MODELS[AGENT_NAME]

    result = await asyncio.to_thread(
        run_agent,
        client,
        model,
        system_prompt,
        user_content,
        [QUERY_DECISION_HISTORY_TOOL, SUBMIT_SENTIMENT_ANALYSIS_TOOL],
        "submit_sentiment_analysis",
    )

    output = result["output"]
    validate_required_fields(output, REQUIRED_FIELDS, AGENT_NAME)

    cost_usd = compute_cost_usd(model, result["prompt_tokens"], result["output_tokens"], result["cache_read_tokens"])
    write_agent_analysis(
        db,
        run_id=run_id,
        symbol=symbol,
        agent_type=AGENT_TYPE,
        output=output,
        prompt_version=prompt_version(AGENT_NAME),
        model=model,
        prompt_tokens=result["prompt_tokens"],
        output_tokens=result["output_tokens"],
        cache_read_tokens=result["cache_read_tokens"],
        cost_usd=cost_usd,
    )

    logger.info("sentiment_analyst: %s -> direction=%s materiality=%s", symbol, output.get("sentiment_direction"), output.get("materiality"))
    return output
