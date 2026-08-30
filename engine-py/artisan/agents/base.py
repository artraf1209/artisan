from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Callable

from artisan.agents.tools import get_fundamentals_detail, query_decision_history
from artisan.db.client import get_client

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

AGENT_CONFIG_TYPES: dict[str, str] = {
    "fundamental_analyst": "fundamental_analyst",
    "technical_analyst": "technical_analyst",
    "sentiment_analyst": "sentiment_analyst",
    "daily_briefing": "briefing",
    "synthesis": "synthesis",
    "position_review": "position_review",
}

_anthropic_client: Any = None
_agent_config_cache: dict[int, dict[str, dict[str, str]]] = {}


def get_anthropic_client() -> Any:
    """Lazily constructs the shared Anthropic client (singleton, mirrors
    artisan/db/client.py's get_client() pattern). Import is deferred so the
    anthropic package is only required at call time, not at module import."""
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic

        from artisan.config import settings

        _anthropic_client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


class AgentOutputError(ValueError):
    """Raised when an agent's parsed tool-call output is missing a required field —
    treated as an error, never a silently-accepted partial result."""


def validate_required_fields(output: dict[str, Any], required_fields: tuple[str, ...], agent_name: str) -> None:
    missing = [f for f in required_fields if f not in output]
    if missing:
        raise AgentOutputError(f"{agent_name} output missing required field(s): {', '.join(missing)}")


def clear_agent_config_cache(db: Any | None = None) -> None:
    if db is None:
        _agent_config_cache.clear()
        return

    _agent_config_cache.pop(id(db), None)


def _load_static_prompt(agent_name: str) -> str:
    return (PROMPTS_DIR / f"{agent_name}.md").read_text()


def _agent_config_cache_key(db: Any | None) -> int:
    return 0 if db is None else id(db)


def _resolve_agent_config_type(agent_name: str) -> str:
    return AGENT_CONFIG_TYPES.get(agent_name, agent_name)


def _load_active_agent_configs(db: Any | None = None) -> dict[str, dict[str, str]]:
    cache_key = _agent_config_cache_key(db)
    cached = _agent_config_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        client = db or get_client()
        rows = (
            client.table("agent_configs")
            .select("agent_type,model_id,prompt_text,prompt_version")
            .eq("is_active", True)
            .execute()
            .data
        )
    except Exception:
        logger.info("Falling back to static agent config for prompt/model resolution.", exc_info=True)
        rows = []

    configs = {
        row["agent_type"]: {
            "model_id": row["model_id"],
            "prompt_text": row["prompt_text"],
            "prompt_version": row["prompt_version"],
        }
        for row in rows or []
        if row.get("agent_type") and row.get("model_id") and row.get("prompt_text") and row.get("prompt_version")
    }
    _agent_config_cache[cache_key] = configs
    return configs


def get_agent_config(agent_name: str, db: Any | None = None) -> dict[str, str]:
    agent_type = _resolve_agent_config_type(agent_name)
    active_config = _load_active_agent_configs(db).get(agent_type)
    if active_config is not None:
        return {
            "model_id": active_config["model_id"],
            "prompt_text": active_config["prompt_text"],
            "prompt_version": active_config["prompt_version"],
            "source": "database",
        }

    prompt_text = _load_static_prompt(agent_name)
    return {
        "model_id": AGENT_MODELS.get(agent_name, MODEL_HAIKU),
        "prompt_text": prompt_text,
        "prompt_version": hashlib.sha256(prompt_text.encode("utf-8")).hexdigest(),
        "source": "static",
    }


def model_for_agent(agent_name: str, db: Any | None = None) -> str:
    return get_agent_config(agent_name, db).get("model_id", AGENT_MODELS.get(agent_name, MODEL_HAIKU))


def load_prompt(agent_name: str, db: Any | None = None) -> str:
    """Loads the active DB-backed prompt when present, otherwise falls back to
    prompts/<agent_name>.md so local/dev runs keep working without Supabase."""
    return get_agent_config(agent_name, db)["prompt_text"]


def prompt_version(agent_name: str, db: Any | None = None) -> str:
    """Stable prompt version logged on every call. DB-backed configs use the
    saved prompt_version string; static fallback uses a sha256 content hash."""
    return get_agent_config(agent_name, db)["prompt_version"]


# ── Tool schemas ───────────────────────────────────────────────────────────
# Every agent gets query_decision_history; only the Fundamental Analyst also
# gets get_fundamentals_detail (per its <tools> section). The forced submit_*
# schema matches each prompt's <output_format> field-for-field. Position Review's
# prompt describes a top-level JSON array, but Anthropic tool inputs must be a
# JSON object — wrapped here in a single named array property
# ("position_reviews") to satisfy that. Synthesis also uses an object wrapper so
# it can return both per-symbol recommendations and a run-level summary.

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
        "headline": {"type": "string", "description": "About 15 words; a clear one-line verdict."},
        "sentiment_note": {"type": "string", "description": "About 20 words."},
        "technical_note": {"type": "string", "description": "About 20 words."},
        "fundamental_note": {"type": "string", "description": "About 20 words."},
        "thesis": {"type": "string"},
        "invalidation_conditions": {"type": "array", "items": {"type": "string"}},
        "redundancy_note": {"type": "string"},
        "historical_precedent": {"type": "string"},
    },
    "required": [
        "symbol", "action", "conviction", "headline", "sentiment_note", "technical_note", "fundamental_note",
        "thesis", "invalidation_conditions", "redundancy_note", "historical_precedent",
    ],
}

SUBMIT_RECOMMENDATIONS_TOOL: dict[str, Any] = {
    "name": "submit_recommendations",
    "description": "Submit the final ranked set of recommendations for this run.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recommendations": {"type": "array", "items": _RECOMMENDATION_ITEM_SCHEMA},
            "run_summary": {"type": "string"},
            "no_recommendation_reason": {"type": ["string", "null"]},
        },
        "required": ["recommendations", "run_summary", "no_recommendation_reason"],
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


def _required_tool_fields(name: str, tools: list[dict[str, Any]]) -> tuple[str, ...]:
    tool = next((tool for tool in tools if tool.get("name") == name), None)
    schema = tool.get("input_schema", {}) if tool else {}
    required = schema.get("required") or []
    return tuple(field for field in required if isinstance(field, str))


def _missing_tool_fields(name: str, tool_input: Any, tools: list[dict[str, Any]]) -> list[str]:
    """Every missing top-level required field, plus -- for array properties
    whose item schema declares its own `required` (e.g. submit_recommendations'
    `recommendations` array, submit_position_reviews' `position_reviews`
    array) -- every missing per-item field, reported as "arrayField[i].field"
    so a corrective retry can point the model at the exact gap. Checking only
    the top level here previously let a forced tool call through as "valid"
    even when every item in a required array was missing required fields --
    the outer keys were present, so nothing caught it until a much stricter,
    non-retrying check downstream (e.g. synthesis.py's validate_required_fields)
    raised a hard, unrecoverable error instead of ever asking the model to fix it."""
    if not isinstance(tool_input, dict):
        return ["<entire payload>"]

    tool = next((tool for tool in tools if tool.get("name") == name), None)
    schema = tool.get("input_schema", {}) if tool else {}
    properties = schema.get("properties") or {}

    missing = [field for field in _required_tool_fields(name, tools) if field not in tool_input]

    for prop_name, prop_schema in properties.items():
        if not isinstance(prop_schema, dict) or prop_schema.get("type") != "array":
            continue
        item_schema = prop_schema.get("items") or {}
        item_required = [f for f in (item_schema.get("required") or []) if isinstance(f, str)]
        if not item_required:
            continue
        items = tool_input.get(prop_name)
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                missing.append(f"{prop_name}[{index}]")
                continue
            missing.extend(f"{prop_name}[{index}].{field}" for field in item_required if field not in item)

    return missing


def _has_required_tool_fields(name: str, tool_input: Any, tools: list[dict[str, Any]]) -> bool:
    return not _missing_tool_fields(name, tool_input, tools)


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

    Returns {"output": <parsed forced-tool input>, "tool_calls": [{"name", "input"}, ...]
    (every intermediate tool call made before the forced submission, in order —
    lets callers like Synthesis audit "was query_decision_history actually
    called per candidate" post-hoc), "prompt_tokens": int, "output_tokens": int,
    "cache_read_tokens": int}.
    """
    executor = tool_executor or _execute_tool
    system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_content}]
    usage_totals = {"prompt_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0}
    tool_call_log: list[dict[str, Any]] = []

    total_iterations_allowed = max_tool_iterations
    invalid_forced_tool_retries_remaining = 1
    iteration = 0
    while iteration < total_iterations_allowed:
        is_last = iteration == total_iterations_allowed - 1
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
        tool_results = []
        if forced_call is not None:
            missing_fields = _missing_tool_fields(forced_tool_name, forced_call.input, tools)
            if not missing_fields:
                return {"output": forced_call.input, "tool_calls": tool_call_log, **usage_totals}

            missing_summary = ", ".join(missing_fields)
            logger.warning(
                "Ignoring %s call with missing required field(s): %s",
                forced_tool_name,
                missing_summary,
            )
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": forced_call.id,
                    "content": json.dumps(
                        {
                            "error": (
                                f"{forced_tool_name} is missing required field(s): {missing_summary}. "
                                f"Call {forced_tool_name} again with every required field populated on every item."
                            )
                        }
                    ),
                }
            )
            tool_use_blocks = [block for block in tool_use_blocks if block is not forced_call]
            if is_last and invalid_forced_tool_retries_remaining > 0:
                total_iterations_allowed += 1
                invalid_forced_tool_retries_remaining -= 1

        if not tool_use_blocks and not tool_results:
            # Auto mode let the model reply without calling a tool — nudge it
            # to continue rather than treating this as a final answer.
            messages.append({"role": "assistant", "content": response.content})
            reminder = (
                f"Please continue and call {forced_tool_name} with every required top-level field populated."
                if forced_call is not None
                else "Please continue and call the required tool when ready."
            )
            messages.append({"role": "user", "content": reminder})
            iteration += 1
            continue

        messages.append({"role": "assistant", "content": response.content})
        for block in tool_use_blocks:
            result = executor(block.name, block.input)
            tool_call_log.append({"name": block.name, "input": block.input})
            tool_results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, default=str)}
            )
        messages.append({"role": "user", "content": tool_results})
        iteration += 1

    raise RuntimeError(f"Agent did not call {forced_tool_name} within {total_iterations_allowed} iterations")


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
