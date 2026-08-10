from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Callable

from artisan.agents.tools import get_fundamentals_detail, query_decision_history

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"
MAX_TOOL_ITERATIONS = 5
DEFAULT_MAX_TOKENS = 4096

# Model assignments per spec §2.2.
MODEL_HAIKU = "claude-haiku-4-5-20251001"
MODEL_SONNET = "claude-sonnet-5"

AGENT_MODELS: dict[str, str] = {
    "fundamental_analyst": MODEL_HAIKU,
    "technical_analyst": MODEL_HAIKU,
    "sentiment_analyst": MODEL_HAIKU,
    "daily_briefing": MODEL_HAIKU,
    "synthesis": MODEL_SONNET,
    "position_review": MODEL_SONNET,
}


def load_prompt(agent_name: str) -> str:
    """Reads prompts/<agent_name>.md — copied verbatim from artisan-v2-agent-prompts.md."""
    return (PROMPTS_DIR / f"{agent_name}.md").read_text()


def prompt_version(agent_name: str) -> str:
    """sha256 hex digest of the prompt file contents, logged on every call
    (agent_analyses.prompt_version) so prompt changes are traceable."""
    return hashlib.sha256(load_prompt(agent_name).encode("utf-8")).hexdigest()


# ── Tool schemas ───────────────────────────────────────────────────────────
# Every agent gets query_decision_history; only the Fundamental Analyst also
# gets get_fundamentals_detail (per its <tools> section). The forced submit_*
# schema matches each prompt's <output_format> field-for-field. Synthesis/
# Position Review's prompts describe a top-level JSON array, but Anthropic
# tool inputs must be a JSON object — wrapped here in a single named array
# property ("recommendations" / "position_reviews") to satisfy that.

QUERY_DECISION_HISTORY_TOOL: dict[str, Any] = {
    "name": "query_decision_history",
    "description": (
        "Look up aggregate win-rate/R-multiple/days-to-resolution stats and recent "
        "individual records from the decision_outcomes knowledge base, filtered by "
        "any combination of symbol/setup_type/regime. Omit all filters for "
        "portfolio-wide aggregate stats."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "setup_type": {"type": "string", "enum": ["pullback", "breakout", "squeeze"]},
            "regime": {"type": "string", "enum": ["risk_on", "neutral", "risk_off"]},
            "limit": {"type": "integer", "default": 20},
        },
    },
}

GET_FUNDAMENTALS_DETAIL_TOOL: dict[str, Any] = {
    "name": "get_fundamentals_detail",
    "description": (
        "Pull specific fundamentals line items or a longer history than what's "
        "already pre-loaded in context for a symbol."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "fields": {"type": "array", "items": {"type": "string"}},
            "years": {"type": "integer", "default": 5},
        },
        "required": ["symbol"],
    },
}

SUBMIT_FUNDAMENTAL_ANALYSIS_TOOL: dict[str, Any] = {
    "name": "submit_fundamental_analysis",
    "description": "Submit the completed fundamental analysis for this symbol.",
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "summary": {"type": "string"},
            "key_drivers": {"type": "array", "items": {"type": "string"}},
            "quality_assessment": {"type": "string", "enum": ["high", "medium", "low", "concerning"]},
            "red_flags": {"type": "array", "items": {"type": "string"}},
            "trend_vs_prior_run": {
                "type": "string",
                "enum": ["improving", "stable", "deteriorating", "no_prior_data"],
            },
            "historical_precedent": {"type": "string"},
        },
        "required": [
            "symbol", "summary", "key_drivers", "quality_assessment",
            "red_flags", "trend_vs_prior_run", "historical_precedent",
        ],
    },
}

SUBMIT_TECHNICAL_ANALYSIS_TOOL: dict[str, Any] = {
    "name": "submit_technical_analysis",
    "description": "Submit the completed technical analysis for this symbol.",
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "summary": {"type": "string"},
            "setup_quality": {"type": "string", "enum": ["strong", "adequate", "marginal", "poor"]},
            "confirmation_strength": {"type": "string"},
            "technical_invalidation_note": {"type": "string"},
            "regime_fit": {"type": "string"},
            "historical_precedent": {"type": "string"},
        },
        "required": [
            "symbol", "summary", "setup_quality", "confirmation_strength",
            "technical_invalidation_note", "regime_fit", "historical_precedent",
        ],
    },
}

SUBMIT_SENTIMENT_ANALYSIS_TOOL: dict[str, Any] = {
    "name": "submit_sentiment_analysis",
    "description": "Submit the completed sentiment analysis for this symbol.",
    "input_schema": {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "summary": {"type": "string"},
            "sentiment_direction": {"type": "string", "enum": ["positive", "neutral", "negative", "mixed"]},
            "materiality": {"type": "string", "enum": ["high", "medium", "low", "none"]},
            "catalysts_identified": {"type": "array", "items": {"type": "string"}},
            "red_flags": {"type": "array", "items": {"type": "string"}},
            "historical_precedent": {"type": "string"},
        },
        "required": [
            "symbol", "summary", "sentiment_direction", "materiality",
            "catalysts_identified", "red_flags", "historical_precedent",
        ],
    },
}

_RECOMMENDATION_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {"type": "string"},
        "action": {"type": "string", "enum": ["enter", "watch", "skip"]},
        "conviction": {"type": "string", "enum": ["high", "medium", "low"]},
        "thesis": {"type": "string"},
        "invalidation_conditions": {"type": "array", "items": {"type": "string"}},
        "redundancy_note": {"type": "string"},
        "historical_precedent": {"type": "string"},
    },
    "required": [
        "symbol", "action", "conviction", "thesis",
        "invalidation_conditions", "redundancy_note", "historical_precedent",
    ],
}

SUBMIT_RECOMMENDATIONS_TOOL: dict[str, Any] = {
    "name": "submit_recommendations",
    "description": "Submit the final ranked set of recommendations for this run.",
    "input_schema": {
        "type": "object",
        "properties": {"recommendations": {"type": "array", "items": _RECOMMENDATION_ITEM_SCHEMA}},
        "required": ["recommendations"],
    },
}

_POSITION_REVIEW_ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "position_id": {"type": "string"},
        "symbol": {"type": "string"},
        "recommended_action": {
            "type": "string",
            "enum": ["hold", "trim", "add", "close", "tighten_stop", "widen_target"],
        },
        "reasoning": {"type": "string"},
        "suggested_new_stop": {"type": ["number", "null"]},
        "suggested_new_target": {"type": ["number", "null"]},
        "historical_precedent": {"type": "string"},
    },
    "required": [
        "position_id", "symbol", "recommended_action", "reasoning",
        "suggested_new_stop", "suggested_new_target", "historical_precedent",
    ],
}

SUBMIT_POSITION_REVIEWS_TOOL: dict[str, Any] = {
    "name": "submit_position_reviews",
    "description": "Submit the completed position reviews for every open position.",
    "input_schema": {
        "type": "object",
        "properties": {"position_reviews": {"type": "array", "items": _POSITION_REVIEW_ITEM_SCHEMA}},
        "required": ["position_reviews"],
    },
}

SUBMIT_BRIEFING_TOOL: dict[str, Any] = {
    "name": "submit_briefing",
    "description": "Submit the completed daily briefing.",
    "input_schema": {
        "type": "object",
        "properties": {
            "urgent_flags": {"type": "array", "items": {"type": "string"}},
            "regime_line": {"type": "string"},
            "new_recommendations_summary": {"type": "string"},
            "position_actions_summary": {"type": "string"},
            "outcomes_note": {"type": "string"},
            "portfolio_state_line": {"type": "string"},
            "full_text": {"type": "string"},
        },
        "required": [
            "urgent_flags", "regime_line", "new_recommendations_summary",
            "position_actions_summary", "outcomes_note", "portfolio_state_line", "full_text",
        ],
    },
}

# Local Python implementations for tools an agent can call mid-loop (never the
# forced submit_* tool, which terminates the loop rather than being "executed").
_CALLABLE_TOOLS: dict[str, Callable[..., Any]] = {
    "query_decision_history": query_decision_history,
    "get_fundamentals_detail": get_fundamentals_detail,
}


def _execute_tool(name: str, tool_input: dict[str, Any]) -> Any:
    fn = _CALLABLE_TOOLS.get(name)
    if fn is None:
        return {"error": f"unknown tool: {name}"}
    return fn(**tool_input)


def _accumulate_usage(totals: dict[str, int], usage: Any) -> None:
    totals["prompt_tokens"] += getattr(usage, "input_tokens", 0) or 0
    totals["output_tokens"] += getattr(usage, "output_tokens", 0) or 0
    totals["cache_read_tokens"] += getattr(usage, "cache_read_input_tokens", 0) or 0


def run_agent(
    client: Any,
    model: str,
    system_prompt: str,
    user_content: str,
    tools: list[dict[str, Any]],
    forced_tool_name: str,
    *,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    max_tool_iterations: int = MAX_TOOL_ITERATIONS,
    tool_executor: Callable[[str, dict[str, Any]], Any] | None = None,
) -> dict[str, Any]:
    """Runs the Anthropic Messages API tool-use loop for one agent call.

    The system prompt (static across a run) goes first, marked cacheable via
    cache_control; per-call user_content (symbol/position data, varies every
    call) is appended last as the user turn. The model may call any tool in
    `tools` freely (auto tool_choice) for up to max_tool_iterations-1 turns —
    this is what lets it call query_decision_history (and, for the Fundamental
    Analyst, get_fundamentals_detail) before finalizing, as the prompts
    require. On the final allowed turn, tool_choice is forced to
    forced_tool_name so a valid structured submission is guaranteed rather
    than an open-ended text reply.

    Returns {"output": <parsed forced-tool input>, "prompt_tokens": int,
    "output_tokens": int, "cache_read_tokens": int}.
    """
    executor = tool_executor or _execute_tool
    system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
    usage_totals = {"prompt_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0}

    for iteration in range(max_tool_iterations):
        is_last = iteration == max_tool_iterations - 1
        tool_choice: dict[str, Any] = (
            {"type": "tool", "name": forced_tool_name} if is_last else {"type": "auto"}
        )

        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
        )
        _accumulate_usage(usage_totals, response.usage)

        tool_use_blocks = [block for block in response.content if getattr(block, "type", None) == "tool_use"]
        forced_call = next((b for b in tool_use_blocks if b.name == forced_tool_name), None)
        if forced_call is not None:
            return {"output": forced_call.input, **usage_totals}

        if not tool_use_blocks:
            # Auto mode let the model reply without calling a tool — nudge it
            # to continue rather than treating this as a final answer.
            messages.append({"role": "assistant", "content": response.content})
            messages.append(
                {"role": "user", "content": "Please continue and call the required tool when ready."}
            )
            continue

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for block in tool_use_blocks:
            result = executor(block.name, block.input)
            tool_results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, default=str)}
            )
        messages.append({"role": "user", "content": tool_results})

    raise RuntimeError(f"Agent did not call {forced_tool_name} within {max_tool_iterations} iterations")


# ── Cost tracking ────────────────────────────────────────────────────────
# USD per million tokens. Approximate — verify against current Anthropic
# pricing before relying on cost_usd for anything beyond rough observability
# and the llm_daily_cost_cap_usd budget check (v2-11).
_PRICING_PER_MILLION_TOKENS: dict[str, dict[str, float]] = {
    MODEL_HAIKU: {"input": 1.00, "output": 5.00, "cache_read": 0.10},
    MODEL_SONNET: {"input": 3.00, "output": 15.00, "cache_read": 0.30},
}


def compute_cost_usd(model: str, prompt_tokens: int, output_tokens: int, cache_read_tokens: int) -> float | None:
    rates = _PRICING_PER_MILLION_TOKENS.get(model)
    if rates is None:
        return None
    non_cached_prompt_tokens = max(prompt_tokens - cache_read_tokens, 0)
    cost = (
        non_cached_prompt_tokens / 1_000_000 * rates["input"]
        + cache_read_tokens / 1_000_000 * rates["cache_read"]
        + output_tokens / 1_000_000 * rates["output"]
    )
    return round(cost, 6)
