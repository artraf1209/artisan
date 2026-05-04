# Phase 0 Dev Tasks

Each file is one coding session. Work them in order — later tasks depend on earlier ones.

| # | Task | Status | Depends on |
|---|------|--------|------------|
| 00 | specs.md updated | ✅ done | — |
| 01 | [Supabase migration](./01-supabase-migration.md) | ⬜ pending | — |
| 02 | [Python engine scaffold](./02-python-scaffold.md) | ⬜ pending | 01 |
| 03 | [Adapter: Alpaca prices](./03-adapter-alpaca-prices.md) | ⬜ pending | 02 |
| 04 | [Adapter: FMP fundamentals](./04-adapter-fmp-fundamentals.md) | ⬜ pending | 02 |
| 05 | [Adapter: Finnhub news](./05-adapter-finnhub-news.md) | ⬜ pending | 02 |
| 06 | [Job: nightly ingest](./06-job-nightly-ingest.md) | ⬜ pending | 03 04 05 |
| 07 | [Scorer: technical](./07-scorer-technical.md) | ⬜ pending | 06 |
| 08 | [Scorer: fundamental](./08-scorer-fundamental.md) | ⬜ pending | 06 |
| 09 | [Scorer: sentiment](./09-scorer-sentiment.md) | ⬜ pending | 06 |
| 10 | [Scorer: composite](./10-scorer-composite.md) | ⬜ pending | 07 08 09 |
| 11 | [Signals pipeline](./11-signals-pipeline.md) | ⬜ pending | 10 |
| 12 | [Job: daily score + signal](./12-job-daily-score-signal.md) | ⬜ pending | 11 |
| 13 | [LLM: thesis analyst](./13-llm-thesis.md) | ⬜ pending | 12 |
| 14 | [LLM: daily briefing](./14-llm-briefing.md) | ⬜ pending | 12 |
| 15 | [Execution: Alpaca executor](./15-execution-alpaca.md) | ⬜ pending | 12 |
| 16 | [Frontend: types + approval queue](./16-frontend-queue.md) | ⬜ pending | 11 |
| 17 | [Frontend: notes + briefings pages](./17-frontend-notes-briefings.md) | ⬜ pending | 13 14 16 |
| 18 | [Frontend: navbar + smoke test](./18-frontend-navbar-e2e.md) | ⬜ pending | 15 16 17 |
| 19 | [Strategy overview page](./19-feature-strategy-page.md) | ⬜ pending | 01 (partial: 11 15) |

## Status legend
- ✅ done
- 🔄 in progress
- ⬜ pending
