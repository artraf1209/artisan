# v2-09 — Agent Infrastructure

**Depends on:** v2-01, v2-08
**Touches:** `engine-py/artisan/agents/` (new package — confirmed no existing directory of this name)

## Context

All 6 v2 agents (Fundamental Analyst, Technical Analyst, Sentiment Analyst, Synthesis, Position Review, Daily Briefing) share the same infrastructure: load a versioned prompt from `artisan-v2-agent-prompts.md`, force a specific `submit_*` tool via the Anthropic API's `tool_choice` (structured output, not open-ended JSON), make `query_decision_history` available as a callable tool, and log token usage/cost to `agent_analyses`. This task builds that shared plumbing once so v2-10 through v2-13 only implement each agent's specific input assembly and output handling.

## Scope

```
engine-py/artisan/agents/
├── __init__.py
├── base.py          # shared: client init, cache headers, run tool loop, parse output
├── tools.py          # query_decision_history (built in v2-08) + get_fundamentals_detail
├── orchestrator.py   # runs all 6 agents in sequence within a pipeline run, writes agent_analyses
└── prompts/
    ├── fundamental_analyst.md   # copied verbatim from artisan-v2-agent-prompts.md §1
    ├── technical_analyst.md     # §2
    ├── sentiment_analyst.md     # §3
    ├── synthesis.md             # §4
    ├── position_review.md       # §5
    └── daily_briefing.md        # §6
```

### `base.py`

- `load_prompt(agent_name: str) -> str` — reads `prompts/<agent_name>.md`.
- `prompt_version(agent_name: str) -> str` — sha256 hex digest of the prompt file contents, logged on every call so prompt changes are traceable in `agent_analyses.prompt_version`.
- `run_agent(client, model, system_prompt, user_content, tools, forced_tool_name) -> dict` — runs the Anthropic Messages API tool-use loop: sends the system prompt (static, placed first for prompt caching via `cache_control`) + per-call user content (symbol data, appended last since it varies per call), forces `tool_choice={"type": "tool", "name": forced_tool_name}` so the model must call the specified `submit_*` tool, handles intermediate tool calls (e.g. `query_decision_history`) by executing them and feeding results back, and returns the final parsed tool-call arguments as a dict once the forced submit tool is invoked.
- The `submit_*` tool JSON schemas (one per agent) are defined here, matching the `output_format` section of each agent's prompt in `artisan-v2-agent-prompts.md` field-for-field — every required field (including `historical_precedent`, mandatory on all 6 agents per the spec) must be present in the schema's `required` array so the API itself enforces completeness.

### `orchestrator.py`

Coordinates the full agent sequence for one pipeline run: computes `available_risk_budget` after Position Review, calls the 3 analyst agents in parallel per shortlisted symbol, then Synthesis, then (separately, earlier in the pipeline per v2-14's job ordering) Position Review, then Briefing. Every agent call writes exactly one `agent_analyses` row: `{run_id, symbol, agent_type, output (jsonb), prompt_version, model, prompt_tokens, output_tokens, cache_read_tokens, cost_usd}`.

### Model assignments (spec §2.2)

- Haiku 4.5 (`claude-haiku-4-5-20251001`): Fundamental, Technical, Sentiment, Daily Briefing agents
- Sonnet 5 (`claude-sonnet-5`): Synthesis, Position Review agents

## Verification
1. `engine-py/tests/test_agents_base.py` (new): mock the Anthropic client, verify `run_agent()` correctly forces the tool, handles one round of `query_decision_history` tool-call-then-response, and returns parsed output matching the schema.
2. Verify `prompt_version()` changes when a prompt file's content changes (hash sensitivity) and stays stable across identical re-reads.
3. Confirm all 6 prompt files under `prompts/` exactly match the corresponding sections of `artisan-v2-agent-prompts.md` (diff them character-for-character, not paraphrased).
