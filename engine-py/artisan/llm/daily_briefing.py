from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import anthropic

from artisan.config import settings
from artisan.db.client import get_client
from artisan.jobs.nightly_ingest import write_audit_log
from artisan.llm.thesis_analyst import MODEL_NAME, _estimate_cost_usd, _first_text_block, _usage_value

logger = logging.getLogger(__name__)

BRIEFING_SYSTEM_PROMPT = """
You are preparing a morning market briefing for one human reviewer of a paper-trading system.
Summarize only the supplied data.
Do not invent prices, trades, or news.
Keep the tone clear, concise, and operational.
Cover:
1. What happened recently in signals and executions.
2. Which names look strongest or weakest based on the supplied evidence.
3. The main news context to watch today.
Stay advisory only.
""".strip()


class DailyBriefingAnalyst:
    def __init__(self, db=None, client: Any | None = None) -> None:
        self.db = db or get_client()
        self.client = client or anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.system_prompt = BRIEFING_SYSTEM_PROMPT

    def fetch_recent_signals(self, since: str) -> list[dict[str, Any]]:
        response = (
            self.db.table("signal_events")
            .select("id, symbol, status, direction, composite_score, f_score, t_score, s_score, created_at")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data

    def fetch_recent_intents(self, since: str) -> list[dict[str, Any]]:
        response = (
            self.db.table("trade_intents")
            .select("id, symbol, side, quantity, dollar_value, status, created_at")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data

    def fetch_recent_executions(self, since: str) -> list[dict[str, Any]]:
        response = (
            self.db.table("trade_executions")
            .select("id, broker_order_id, status, filled_qty, filled_price, filled_at, intent_id")
            .gte("created_at", since)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data

    def fetch_recent_headlines(self, since: str) -> list[dict[str, Any]]:
        response = (
            self.db.table("news_articles")
            .select("symbol, headline, source, vader_compound, published_at")
            .gte("published_at", since)
            .order("published_at", desc=True)
            .limit(12)
            .execute()
        )
        return response.data

    @staticmethod
    def build_user_prompt(
        *,
        briefing_date: date,
        signals: list[dict[str, Any]],
        intents: list[dict[str, Any]],
        executions: list[dict[str, Any]],
        headlines: list[dict[str, Any]],
    ) -> str:
        signal_lines = [
            (
                f"- {row['symbol']} {row['direction']} | status={row['status']} | "
                f"composite={float(row['composite_score']):.4f} | "
                f"F={float(row['f_score']):.4f} T={float(row['t_score']):.4f} S={float(row['s_score']):.4f}"
            )
            for row in signals[:8]
        ]
        intent_lines = [
            f"- {row['symbol']} {row['side']} | qty={row['quantity']} | value={row['dollar_value']} | status={row['status']}"
            for row in intents[:8]
        ]
        execution_lines = [
            f"- intent={row['intent_id']} | status={row['status']} | qty={row.get('filled_qty')} | price={row.get('filled_price')}"
            for row in executions[:8]
        ]
        headline_lines = [
            f"- {row['symbol']}: {row['headline']} ({row.get('source') or 'unknown'}, sentiment {float(row.get('vader_compound') or 0):.2f})"
            for row in headlines[:10]
        ]

        return f"""
Prepare a daily briefing for {briefing_date.isoformat()}.

Recent signals:
{chr(10).join(signal_lines) if signal_lines else "- No recent signals."}

Recent trade intents:
{chr(10).join(intent_lines) if intent_lines else "- No recent trade intents."}

Recent executions:
{chr(10).join(execution_lines) if execution_lines else "- No recent executions."}

Recent news:
{chr(10).join(headline_lines) if headline_lines else "- No recent headlines."}

Requirements:
- Summarize the most important recent activity.
- Mention the strongest and weakest names only if the provided data supports it.
- Highlight the main headlines that could affect today’s review queue.
- Keep it concise and readable in the UI.
""".strip()

    def generate_briefing(
        self,
        *,
        briefing_date: date,
        signals: list[dict[str, Any]],
        intents: list[dict[str, Any]],
        executions: list[dict[str, Any]],
        headlines: list[dict[str, Any]],
    ) -> dict[str, Any]:
        message = self.client.messages.create(
            model=MODEL_NAME,
            max_tokens=500,
            system=self.system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": self.build_user_prompt(
                        briefing_date=briefing_date,
                        signals=signals,
                        intents=intents,
                        executions=executions,
                        headlines=headlines,
                    ),
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

        return {
            "analysis_type": "briefing",
            "symbol": None,
            "signal_id": None,
            "model": getattr(message, "model", MODEL_NAME),
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "cache_read_tokens": cache_read_tokens,
            "cost_usd": _estimate_cost_usd(prompt_tokens, output_tokens),
            "content": _first_text_block(getattr(message, "content", "")),
        }

    def save_briefing(self, row: dict[str, Any]) -> dict[str, Any]:
        payload = {
            **row,
            "cost_usd": str(row["cost_usd"]) if row.get("cost_usd") is not None else None,
        }
        response = self.db.table("llm_analyses").insert(payload).execute()
        return response.data[0] if response.data else payload

    def run(self, *, now: datetime | None = None) -> dict[str, Any]:
        now = now or datetime.now(UTC)
        since = (now - timedelta(days=1)).isoformat()

        signals = self.fetch_recent_signals(since)
        intents = self.fetch_recent_intents(since)
        executions = self.fetch_recent_executions(since)
        headlines = self.fetch_recent_headlines(since)

        briefing = self.generate_briefing(
            briefing_date=now.date(),
            signals=signals,
            intents=intents,
            executions=executions,
            headlines=headlines,
        )
        saved = self.save_briefing(briefing)

        write_audit_log(
            self.db,
            actor="github-actions",
            action="briefing_create",
            entity="llm_analyses",
            payload={
                "analysis_type": "briefing",
                "model": saved["model"],
                "signal_count": len(signals),
                "intent_count": len(intents),
                "execution_count": len(executions),
                "headline_count": len(headlines),
            },
        )

        summary = {
            "briefing_created": True,
            "signal_count": len(signals),
            "intent_count": len(intents),
            "execution_count": len(executions),
            "headline_count": len(headlines),
            "run_at": now.isoformat(),
        }
        logger.info("Daily briefing summary: %s", summary)
        return summary


def main() -> None:
    DailyBriefingAnalyst().run()


if __name__ == "__main__":
    main()
