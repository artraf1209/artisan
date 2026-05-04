# Task 13 — LLM: Thesis Analyst

**Status:** ⬜ pending  
**Depends on:** 12  
**Estimated effort:** 2–3 hours  

---

## Goal
Generate one concise thesis note per pending signal using Claude Haiku 4.5 and store it in `llm_analyses` as `analysis_type='thesis'`.

---

## Files to create

```text
engine-py/artisan/llm/__init__.py
engine-py/artisan/llm/thesis_analyst.py
engine-py/tests/test_thesis_analyst.py
```

---

## Implementation notes

- Use model `claude-haiku-4-5-20251001`.
- Build a structured prompt from:
  - symbol
  - pillar scores
  - composite score
  - ATR / stop / target
  - recent headlines
  - earnings blackout status
- Output should be analyst-only:
  - why the signal exists
  - key supporting evidence
  - invalidation conditions
- The LLM must not change scores, execute trades, or invent actions outside the signal record.
- Store metadata fields when available:
  - `model`
  - `prompt_tokens`
  - `output_tokens`
  - `cache_read_tokens`
  - `cost_usd`
  - `content`
- Cache or reuse the system prompt within a single run if the SDK supports it.

---

## Content constraints

- Keep each thesis concise enough for UI display.
- Prefer plain English over jargon-heavy output.
- Include at least one explicit invalidation condition.

---

## Acceptance criteria

- [ ] One thesis analysis row is created per pending signal
- [ ] Rows are stored in `llm_analyses` with `analysis_type='thesis'`
- [ ] Thesis content references the actual score inputs for that signal
- [ ] The LLM remains advisory only
