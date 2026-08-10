# Task 09 — Scorer: Sentiment

**Status:** ⬜ pending  
**Depends on:** 06  
**Estimated effort:** 1–2 hours  

---

## Goal
Create the sentiment pillar scorer that rolls up recent `news_articles.vader_compound` values into a normalized `s_score`.

---

## Files to create

```text
engine-py/artisan/scorers/sentiment.py
engine-py/tests/test_sentiment_scorer.py
```

---

## Implementation notes

- Read recent news per symbol from `news_articles`.
- Use a rolling window suitable for daily decisioning:
  - default to the last 72 hours
- Aggregate recent headline sentiment into one pillar score.
- Suggested method:
  - recency-weighted average of `vader_compound`
  - transform from `[-1, 1]` to `[0, 1]`
- Return both:
  - normalized `s_score`
  - headline count and average raw compound
- If no recent news exists, return a neutral default such as `0.50`.

---

## Acceptance criteria

- [ ] `s_score` is normalized to `[0, 1]`
- [ ] Score uses recent article windows rather than lifetime averages
- [ ] No-news symbols return a neutral score, not an error
- [ ] Unit tests cover positive, negative, mixed, and empty inputs
