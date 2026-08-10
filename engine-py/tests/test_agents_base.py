from __future__ import annotations

import pytest

import artisan.agents.base as base_module
from artisan.agents.base import (
    QUERY_DECISION_HISTORY_TOOL,
    SUBMIT_TECHNICAL_ANALYSIS_TOOL,
    compute_cost_usd,
    load_prompt,
    prompt_version,
    run_agent,
)


class FakeToolUseBlock:
    def __init__(self, name: str, input: dict, id: str) -> None:
        self.type = "tool_use"
        self.name = name
        self.input = input
        self.id = id


class FakeTextBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class FakeUsage:
    def __init__(self, input_tokens: int = 0, output_tokens: int = 0, cache_read_input_tokens: int = 0) -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.cache_read_input_tokens = cache_read_input_tokens


class FakeResponse:
    def __init__(self, content: list, usage: FakeUsage) -> None:
        self.content = content
        self.usage = usage


class FakeMessages:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class FakeClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.messages = FakeMessages(responses)


TECHNICAL_OUTPUT = {
    "symbol": "AAPL",
    "summary": "Clean pullback to the 50-day.",
    "setup_quality": "strong",
    "confirmation_strength": "volume and MACD both confirming",
    "technical_invalidation_note": "close below SMA50 invalidates",
    "regime_fit": "fits well in risk_on",
    "historical_precedent": "no relevant history found",
}


def test_run_agent_handles_intermediate_tool_call_then_forced_submit() -> None:
    responses = [
        FakeResponse(
            content=[FakeToolUseBlock("query_decision_history", {"symbol": "AAPL"}, "call-1")],
            usage=FakeUsage(input_tokens=500, output_tokens=50, cache_read_input_tokens=0),
        ),
        FakeResponse(
            content=[FakeToolUseBlock("submit_technical_analysis", TECHNICAL_OUTPUT, "call-2")],
            usage=FakeUsage(input_tokens=600, output_tokens=200, cache_read_input_tokens=400),
        ),
    ]
    client = FakeClient(responses)
    executed_calls: list[tuple[str, dict]] = []

    def tool_executor(name: str, tool_input: dict) -> dict:
        executed_calls.append((name, tool_input))
        return {"aggregate": {"win_rate": 0.6}}

    result = run_agent(
        client,
        model="claude-haiku-4-5-20251001",
        system_prompt="you are a technical analyst",
        user_content="AAPL data goes here",
        tools=[QUERY_DECISION_HISTORY_TOOL, SUBMIT_TECHNICAL_ANALYSIS_TOOL],
        forced_tool_name="submit_technical_analysis",
        max_tool_iterations=2,
        tool_executor=tool_executor,
    )

    assert executed_calls == [("query_decision_history", {"symbol": "AAPL"})]
    assert result["output"] == TECHNICAL_OUTPUT
    assert result["prompt_tokens"] == 1100
    assert result["output_tokens"] == 250
    assert result["cache_read_tokens"] == 400

    assert client.messages.calls[0]["tool_choice"] == {"type": "auto"}
    assert client.messages.calls[1]["tool_choice"] == {"type": "tool", "name": "submit_technical_analysis"}
    # static system prompt is first and cache-marked; per-call data is the user turn
    assert client.messages.calls[0]["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert client.messages.calls[0]["messages"][0]["content"] == "AAPL data goes here"


def test_run_agent_returns_immediately_when_forced_tool_called_on_first_turn() -> None:
    responses = [
        FakeResponse(
            content=[FakeToolUseBlock("submit_technical_analysis", TECHNICAL_OUTPUT, "call-1")],
            usage=FakeUsage(input_tokens=400, output_tokens=150, cache_read_input_tokens=0),
        ),
    ]
    client = FakeClient(responses)

    result = run_agent(
        client,
        model="claude-haiku-4-5-20251001",
        system_prompt="sys",
        user_content="data",
        tools=[SUBMIT_TECHNICAL_ANALYSIS_TOOL],
        forced_tool_name="submit_technical_analysis",
        max_tool_iterations=3,
        tool_executor=lambda name, tool_input: {},
    )

    assert result["output"] == TECHNICAL_OUTPUT
    assert len(client.messages.calls) == 1


def test_run_agent_raises_if_forced_tool_never_called() -> None:
    responses = [
        FakeResponse(content=[FakeTextBlock("I am thinking...")], usage=FakeUsage()),
        FakeResponse(content=[FakeTextBlock("Still thinking...")], usage=FakeUsage()),
    ]
    client = FakeClient(responses)

    with pytest.raises(RuntimeError, match="submit_technical_analysis"):
        run_agent(
            client,
            model="claude-haiku-4-5-20251001",
            system_prompt="sys",
            user_content="data",
            tools=[SUBMIT_TECHNICAL_ANALYSIS_TOOL],
            forced_tool_name="submit_technical_analysis",
            max_tool_iterations=2,
            tool_executor=lambda name, tool_input: {},
        )


def test_prompt_version_stable_across_rereads_and_sensitive_to_content(tmp_path, monkeypatch) -> None:
    prompts_dir = tmp_path / "prompts"
    prompts_dir.mkdir()
    (prompts_dir / "probe.md").write_text("version one")
    monkeypatch.setattr(base_module, "PROMPTS_DIR", prompts_dir)

    v1a = base_module.prompt_version("probe")
    v1b = base_module.prompt_version("probe")
    assert v1a == v1b

    (prompts_dir / "probe.md").write_text("version two")
    v2 = base_module.prompt_version("probe")
    assert v2 != v1a


@pytest.mark.parametrize(
    "agent_name,submit_tool_name",
    [
        ("fundamental_analyst", "submit_fundamental_analysis"),
        ("technical_analyst", "submit_technical_analysis"),
        ("sentiment_analyst", "submit_sentiment_analysis"),
        ("synthesis", "submit_recommendations"),
        ("position_review", "submit_position_reviews"),
        ("daily_briefing", "submit_briefing"),
    ],
)
def test_real_prompt_files_load_and_reference_their_submit_tool(agent_name: str, submit_tool_name: str) -> None:
    content = load_prompt(agent_name)
    assert content.startswith("<role>")
    assert content.rstrip().endswith("</output_format>")
    assert submit_tool_name in content
    if agent_name != "daily_briefing":
        # Briefing is the one agent that doesn't query_decision_history or make
        # a new judgment call -- it only summarizes what other agents already
        # decided, so it has no historical_precedent field (and no <tools>
        # section at all) in its output_format, unlike the other 5 agents.
        assert "historical_precedent" in content

    # deterministic, non-empty hash
    version = prompt_version(agent_name)
    assert len(version) == 64
    assert version == prompt_version(agent_name)


def test_compute_cost_usd_accounts_for_cache_discount() -> None:
    cost = compute_cost_usd(base_module.MODEL_HAIKU, prompt_tokens=1000, output_tokens=500, cache_read_tokens=800)
    # 200 non-cached input tokens @ $1/M + 800 cache-read @ $0.10/M + 500 output @ $5/M
    expected = (200 / 1_000_000 * 1.00) + (800 / 1_000_000 * 0.10) + (500 / 1_000_000 * 5.00)
    assert cost == round(expected, 6)


def test_compute_cost_usd_unknown_model_returns_none() -> None:
    assert compute_cost_usd("some-future-model", 100, 100, 0) is None
