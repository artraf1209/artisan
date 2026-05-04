from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import anthropic

from artisan.config import settings
from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import write_audit_log

logger = logging.getLogger(__name__)

MODEL_NAME = "claude-haiku-4-5-20251001"
SYSTEM_PROMPT = """
You are an analyst for a paper-trading review queue.
Write a concise thesis for a single candidate trade.
You must stay advisory-only: do not change scores, do not recommend executing automatically, and do not invent data.
Use plain English.
Include:
1. Why the setup is interesting now.
2. The strongest supporting evidence from the scores and headlines provided.
3. At least one explicit invalidation condition.
Keep the response compact enough for a UI note.
""".strip()


def _first_text_block(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block["text"].strip())
            elif hasattr(block, "text"):  # Anthropic SDK TextBlock object
                parts.append(block.text.strip())
        return "\n".join(part for part in parts if part).strip()
    return ""


def _usage_value(usage: Any, key: str) -> int | None:
    if usage is None:
        return None
    if isinstance(usage, dict):
        value = usage.get(key)
    else:
        value = getattr(usage, key, None)
    if value is None:
        return None
    return int(value)


def _estimate_cost_usd(prompt_tokens: int | None, output_tokens: int | None) -> Decimal | None:
    if prompt_tokens is None and output_tokens is None:
        return None
    prompt_cost = Decimal(prompt_tokens or 0) * Decimal("0.000001")
    output_cost = Decimal(output_tokens or 0) * Decimal("0.000005")
    return (prompt_cost + output_cost).quantize(Decimal("0.000001"))


class ThesisAnalyst:
    def __init__(self, db=None, client: Any | None = None) -> None:
        self.db = db or get_client()
        self.client = client or anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.system_prompt = SYSTEM_PROMPT

    def fetch_pending_signals(self) -> list[dict[str, Any]]:
        response = (
            self.db.table("signal_events")
            .select("*")
            .eq("status", "pending")
            .order("created_at", desc=False)
            .execute()
        )
        return response.data

    def fetch_existing_thesis_signal_ids(self) -> set[str]:
        response = (
            self.db.table("llm_analyses")
            .select("signal_id")
            .eq("analysis_type", "thesis")
            .execute()
        )
        return {row["signal_id"] for row in response.data if row.get("signal_id")}

    def fetch_recent_headlines(self, symbol: str, now: datetime | None = None) -> list[dict[str, Any]]:
        now = now or datetime.now(UTC)
        since = (now - timedelta(hours=72)).isoformat()
        response = (
            self.db.table("news_articles")
            .select("headline, source, vader_compound, published_at")
            .eq("symbol", symbol)
            .gte("published_at", since)
            .order("published_at", desc=True)
            .limit(5)
            .execute()
        )
        return response.data

    @staticmethod
    def build_user_prompt(signal: dict[str, Any], headlines: list[dict[str, Any]]) -> str:
        headline_lines = []
        for row in headlines:
            source = row.get("source") or "unknown source"
            vader = row.get("vader_compound")
            vader_str = "n/a" if vader is None else f"{float(vader):.2f}"
            headline_lines.append(f"- {row['headline']} ({source}, sentiment {vader_str})")

        headlines_block = "\n".join(headline_lines) if headline_lines else "- No recent headlines available."

        return f"""
Write a brief thesis note for this pending paper-trading signal.

Symbol: {signal["symbol"]}
Direction: {signal["direction"]}
Composite score: {float(signal["composite_score"]):.4f}
Fundamental score: {float(signal["f_score"]):.4f}
Technical score: {float(signal["t_score"]):.4f}
Sentiment score: {float(signal["s_score"]):.4f}
Pillars passed: {signal["pillars_passed"]}
Stop price: {signal.get("stop_price")}
Target price: {signal.get("target_price")}
ATR at signal: {signal.get("atr_at_signal")}
Earnings blackout: {signal.get("earnings_blackout")}
Signal created at: {signal.get("created_at")}

Recent headlines:
{headlines_block}

Requirements:
- Explain why the setup exists using the supplied scores.
- Mention the most important supporting evidence.
- Include at least one explicit invalidation condition.
- Stay advisory only.
""".strip()

    def generate_thesis(self, signal: dict[str, Any], headlines: list[dict[str, Any]]) -> dict[str, Any]:
        message = self.client.messages.create(
            model=MODEL_NAME,
            max_tokens=350,
            system=self.system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": self.build_user_prompt(signal, headlines),
                }
            ],
        )

        usage = getattr(message, "usage", None)
        prompt_tokens = _usage_value(usage, "input_tokens")
        output_tokens = _usage_value(usage, "output_tokens")
        cache_read_tokens = (
            _usage_value(usage, "cache_read_input_tokens")
            or _usage_value(usage, "cache_read_tokens")
        )
        content = _first_text_block(getattr(message, "content", ""))

        return {
            "analysis_type": "thesis",
            "symbol": signal["symbol"],
            "signal_id": signal["id"],
            "model": getattr(message, "model", MODEL_NAME),
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cost_usd": _estimate_cost_usd(prompt_tokens, output_tokens),
            "content": content,
        }

    def save_thesis(self, row: dict[str, Any]) -> dict[str, Any]:
        payload = {
            **row,
            "cost_usd": str(row["cost_usd"]) if row.get("cost_usd") is not None else None,
        }
        response = self.db.table("llm_analyses").insert(payload).execute()
        return response.data[0] if response.data else payload

    def run(self, *, now: datetime | None = None, force: bool = False) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        pending_signals = self.fetch_pending_signals()
        existing_signal_ids = set() if force else self.fetch_existing_thesis_signal_ids()

        created = 0
        skipped = 0
        for signal in pending_signals:
            if signal["id"] in existing_signal_ids:
                skipped += 1
                continue

            headlines = self.fetch_recent_headlines(signal["symbol"], now=now)
            thesis_row = self.generate_thesis(signal, headlines)
            self.save_thesis(thesis_row)
            created += 1

            write_audit_log(
                self.db,
                actor="system",
                action="thesis_create",
                entity="llm_analyses",
                entity_id=signal["id"],
                payload={
                    "signal_id": signal["id"],
                    "symbol": signal["symbol"],
                    "model": thesis_row["model"],
                },
            )

        summary = {
            "pending_signals": len(pending_signals),
            "theses_created": created,
            "signals_skipped": skipped,
            "run_at": now.isoformat(),
        }
        logger.info("Thesis analyst summary: %s", summary)
        return summary


def main() -> None:
    ThesisAnalyst().run()


if __name__ == "__main__":
    main()
