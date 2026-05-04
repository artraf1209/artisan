# Phase 0 Dev Tasks

Each file is one coding session. Work them in order — later tasks depend on earlier ones.

The first table is the original Phase 0 build sequence. The second table captures the multi-factor strategy enhancement track introduced in [specs.md §9](../specs.md#9-strategy-page--multi-factor-enhancement).

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
| 19 | [Original strategy page task (superseded)](./19-feature-strategy-page.md) | ⬜ pending | 01 (partial: 11 15) |

## Multi-Factor Enhancement Track

These tasks replace the old GoalPanel / UniverseThesis strategy plan with the current multi-factor strategy build. They should be worked in dependency order below, not from Task 19.

| # | Task | Status | Depends on |
|---|------|--------|------------|
| 20 | [Factor layer migration](./20-enhancement-factor-layer-migration.md) | ⬜ pending | 01 |
| 21 | [Dynamic universe screener + budget controls](./21-enhancement-screener-budgeted-universe.md) | ⬜ pending | 04 06 20 |
| 22 | [Extended fundamentals history + SPY ingest](./22-enhancement-fundamentals-history-and-spy-ingest.md) | ⬜ pending | 04 06 20 21 |
| 23 | [Factor scoring suite](./23-enhancement-factor-scoring-suite.md) | ⬜ pending | 20 22 |
| 24 | [Technical enrichments + entry gates](./24-enhancement-technical-entry-gates.md) | ⬜ pending | 07 20 22 |
| 25 | [Daily score + signal multi-factor orchestration](./25-enhancement-daily-score-signal-multifactor.md) | ⬜ pending | 12 13 23 24 |
| 26 | [Strategy page multi-factor frontend](./26-enhancement-strategy-page-multifactor.md) | ⬜ pending | 16 18 20 25 |
| 27 | [Verification, contracts, and runtime alignment](./27-enhancement-verification-and-runtime-alignment.md) | ⬜ pending | 20 21 22 23 24 25 26 |

## Status legend
- ✅ done
- 🔄 in progress
- ⬜ pending
