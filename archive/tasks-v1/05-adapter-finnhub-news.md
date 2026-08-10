# Task 05 — Adapter: Finnhub News

**Status:** ⬜ pending  
**Depends on:** 02  
**Estimated effort:** 2–3 hours  

---

## Goal
Create the news adapter that fetches company headlines from Finnhub, scores sentiment with VADER, and stores results in `news_articles`.

---

## Files to create

```text
engine-py/artisan/adapters/finnhub_news.py
engine-py/tests/test_finnhub_news.py
```

---

## Implementation notes

- Create a `FinnhubNewsAdapter` class using `FINNHUB_API_KEY`.
- Fetch company news by symbol and date range.
- Score each headline with `vaderSentiment` and save the compound score to `vader_compound`.
- Normalize rows to:
  - `symbol`
  - `headline`
  - `summary`
  - `source`
  - `url`
  - `published_at`
  - `vader_compound`
  - `fetched_at`
- Add methods:
  - `fetch_news(symbol: str, start: date, end: date) -> list[dict]`
  - `score_headline(headline: str, summary: str | None = None) -> float`
  - `save_articles(rows: list[dict]) -> int`
- Upsert into `news_articles` on `(symbol, url)`.
- Skip rows without a URL or headline.
- Keep request pacing compatible with Finnhub free-tier limits.

---

## Sentiment rules

- Score at least the headline.
- If a summary is present, combine headline and summary into the scored text.
- Persist raw VADER compound values in the range `[-1, 1]`.
- Do not normalize to `[0, 1]` here; normalization happens in Task 09.

---

## Testing

- Mock a Finnhub payload with multiple headlines.
- Verify duplicates by URL are ignored through upsert behavior.
- Verify positive and negative sample headlines produce expected relative scores.

---

## Acceptance criteria

- [ ] News rows are stored for each symbol with `vader_compound`
- [ ] Duplicate articles are idempotent on rerun
- [ ] Adapter skips malformed articles safely
- [ ] Free-tier request limits are respected
- [ ] Unit tests cover transform and sentiment scoring
