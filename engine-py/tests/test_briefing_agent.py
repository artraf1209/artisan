from __future__ import annotations

import pytest

import artisan.agents.daily_briefing as daily_briefing


class _Query:
    def __init__(self, rows: list[dict], insert_sink: list[dict] | None = None) -> None:
        self.rows = rows
        self.insert_sink = insert_sink
        self._filters: dict[str, object] = {}
        self._neq_filters: dict[str, object] = {}
        self._gte_filters: dict[str, object] = {}
        self._insert_row: dict | None = None

    def select(self, _fields: str):
        return self

    def eq(self, column: str, value):
        self._filters[column] = value
        return self

    def neq(self, column: str, value):
        self._neq_filters[column] = value
        return self

    def gte(self, column: str, value):
        self._gte_filters[column] = value
        return self

    def order(self, column: str, desc: bool = False):
        self.rows = sorted(self.rows, key=lambda r: r.get(column) or "", reverse=desc)
        return self

    def limit(self, n: int):
        self.rows = self.rows[:n]
        return self

    def insert(self, row: dict):
        self._insert_row = row
        return self

    def _matches(self, row: dict) -> bool:
        for k, v in self._filters.items():
            if row.get(k) != v:
                return False
        for k, v in self._neq_filters.items():
            if row.get(k) == v:
                return False
        for k, v in self._gte_filters.items():
            if (row.get(k) or "") < v:
                return False
        return True

    def execute(self):
        if self._insert_row is not None:
            row = dict(self._insert_row)
            row.setdefault("id", f"generated-{len(self.insert_sink) if self.insert_sink is not None else 0}")
            if self.insert_sink is not None:
                self.insert_sink.append(row)
            return type("Response", (), {"data": [row]})()
        matched = [r for r in self.rows if self._matches(r)]
        return type("Response", (), {"data": matched})()


class FakeDB:
    def __init__(self, table_rows: dict[str, list[dict]]) -> None:
        self.table_rows = table_rows
        self.briefings_inserted: list[dict] = []
        self.agent_analyses_inserted: list[dict] = []

    def table(self, name: str):
        sinks = {"briefings": self.briefings_inserted, "agent_analyses": self.agent_analyses_inserted}
        return _Query(self.table_rows.get(name, []), sinks.get(name))


RUN_ID = "run-1"
RUN_DATE = "2026-06-01"


def _base_tables() -> dict[str, list[dict]]:
    return {
        "regime_snapshots": [
            {"run_id": RUN_ID, "regime": "risk_on", "date": "2026-06-01"},
            {"run_id": "run-0", "regime": "neutral", "date": "2026-05-31"},
        ],
        "recommendations": [
            {"symbol": "NVDA", "action": "enter", "conviction": "medium", "thesis": "pullback in AI leader", "run_id": RUN_ID},
            {"symbol": "AAPL", "action": "watch", "conviction": "low", "thesis": "not ready", "run_id": RUN_ID},
        ],
        "position_reviews": [
            {"symbol": "MSFT", "recommended_action": "hold", "reasoning": "thesis intact", "run_id": RUN_ID},
            {"symbol": "TSLA", "recommended_action": "close", "reasoning": "hit invalidation", "run_id": RUN_ID},
        ],
        "decision_outcomes": [
            {"symbol": "GOOG", "mode": "real", "resolution": "hit_target", "r_multiple": 2.1, "resolved_at": "2026-06-01T10:00:00+00:00"},
            {"symbol": "META", "mode": "shadow", "resolution": "hit_stop", "r_multiple": -1.0, "resolved_at": "2026-06-01T09:00:00+00:00"},
            {"symbol": "OLD", "mode": "real", "resolution": "hit_target", "r_multiple": 1.0, "resolved_at": "2026-05-20T09:00:00+00:00"},  # not today
        ],
        "portfolio_snapshots": [
            {"equity": 105_000.0, "drawdown_from_high_pct": -0.03, "trailing_return_pct": 0.12, "snapshot_date": "2026-06-01"},
        ],
    }


VALID_OUTPUT = {
    "urgent_flags": ["TSLA position closed on invalidation trigger"],
    "regime_line": "Regime is risk_on, unchanged from yesterday.",
    "new_recommendations_summary": "1 new recommendation: NVDA (medium conviction).",
    "position_actions_summary": "TSLA closed on invalidation; all other positions held.",
    "outcomes_note": "GOOG hit target (+2.1R real); META (shadow) hit stop (-1.0R).",
    "portfolio_state_line": "Equity $105,000, drawdown 3% (tolerance 18%), trailing return 12% (target 25%).",
    "full_text": "Full formatted briefing text goes here, several paragraphs long.",
}


def _run_agent_result(output: dict) -> dict:
    return {"output": output, "tool_calls": [], "prompt_tokens": 1200, "output_tokens": 500, "cache_read_tokens": 300}


@pytest.mark.asyncio
async def test_writes_briefing_row_and_pushes_condensed_telegram_message(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(daily_briefing, "run_agent", lambda *a, **k: _run_agent_result(VALID_OUTPUT))
    sent: list[dict] = []

    result = await daily_briefing.write_briefing(
        run_id=RUN_ID, strategy_id="strategy-1", strategy_params=strategy_params, run_date=RUN_DATE,
        db=db, client=object(), telegram_sender=lambda output: sent.append(output),
    )

    assert result["run_id"] == RUN_ID
    assert result["briefing_date"] == RUN_DATE
    assert result["regime_line"] == VALID_OUTPUT["regime_line"]
    assert result["urgent_flags"] == VALID_OUTPUT["urgent_flags"]
    assert result["full_text"] == VALID_OUTPUT["full_text"]
    assert result["cost_usd"] is not None
    assert len(db.briefings_inserted) == 1
    assert len(db.agent_analyses_inserted) == 1
    assert db.agent_analyses_inserted[0]["agent_type"] == "briefing"

    assert len(sent) == 1
    assert sent[0] == VALID_OUTPUT  # telegram_sender receives the raw output; formatting is a separate concern


def test_format_telegram_message_never_includes_full_text() -> None:
    message = daily_briefing._format_telegram_message(VALID_OUTPUT)

    assert VALID_OUTPUT["full_text"] not in message
    assert "See /briefings" in message
    assert "⚠️ TSLA position closed on invalidation trigger" in message
    assert VALID_OUTPUT["regime_line"] in message
    assert VALID_OUTPUT["new_recommendations_summary"] in message
    assert VALID_OUTPUT["portfolio_state_line"] in message


def test_format_telegram_message_no_warning_lines_when_no_urgent_flags() -> None:
    output = {**VALID_OUTPUT, "urgent_flags": []}
    message = daily_briefing._format_telegram_message(output)

    assert "⚠️" not in message


@pytest.mark.asyncio
async def test_send_telegram_false_skips_notification(monkeypatch, strategy_params) -> None:
    db = FakeDB(_base_tables())
    monkeypatch.setattr(daily_briefing, "run_agent", lambda *a, **k: _run_agent_result(VALID_OUTPUT))
    sent: list[dict] = []

    await daily_briefing.write_briefing(
        run_id=RUN_ID, strategy_id="strategy-1", strategy_params=strategy_params, run_date=RUN_DATE,
        db=db, client=object(), send_telegram=False, telegram_sender=lambda output: sent.append(output),
    )

    assert sent == []


@pytest.mark.asyncio
async def test_missing_field_raises(monkeypatch, strategy_params) -> None:
    from artisan.agents.base import AgentOutputError

    db = FakeDB(_base_tables())
    bad_output = {k: v for k, v in VALID_OUTPUT.items() if k != "portfolio_state_line"}
    monkeypatch.setattr(daily_briefing, "run_agent", lambda *a, **k: _run_agent_result(bad_output))

    with pytest.raises(AgentOutputError, match="portfolio_state_line"):
        await daily_briefing.write_briefing(
            run_id=RUN_ID, strategy_id="strategy-1", strategy_params=strategy_params, run_date=RUN_DATE,
            db=db, client=object(), telegram_sender=lambda output: None,
        )


def test_assemble_context_detects_regime_change(strategy_params) -> None:
    db = FakeDB(_base_tables())
    context = daily_briefing.assemble_context(db, run_id=RUN_ID, run_date=RUN_DATE, expired_counts=daily_briefing.DEFAULT_EXPIRED_COUNTS)

    assert context["regime"]["regime"] == "risk_on"
    assert context["regime"]["prior_regime"] == "neutral"
    assert context["regime"]["changed"] is True


def test_assemble_context_filters_new_recommendations_to_enter_only(strategy_params) -> None:
    db = FakeDB(_base_tables())
    context = daily_briefing.assemble_context(db, run_id=RUN_ID, run_date=RUN_DATE, expired_counts=daily_briefing.DEFAULT_EXPIRED_COUNTS)

    symbols = {r["symbol"] for r in context["new_recommendations"]}
    assert symbols == {"NVDA"}  # AAPL is watch, excluded


def test_assemble_context_filters_position_actions_to_non_hold(strategy_params) -> None:
    db = FakeDB(_base_tables())
    context = daily_briefing.assemble_context(db, run_id=RUN_ID, run_date=RUN_DATE, expired_counts=daily_briefing.DEFAULT_EXPIRED_COUNTS)

    symbols = {p["symbol"] for p in context["position_actions"]}
    assert symbols == {"TSLA"}  # MSFT held, excluded


def test_assemble_context_filters_resolved_outcomes_to_today(strategy_params) -> None:
    db = FakeDB(_base_tables())
    context = daily_briefing.assemble_context(db, run_id=RUN_ID, run_date=RUN_DATE, expired_counts=daily_briefing.DEFAULT_EXPIRED_COUNTS)

    symbols = {o["symbol"] for o in context["resolved_outcomes"]}
    assert symbols == {"GOOG", "META"}  # OLD resolved on a different day, excluded
