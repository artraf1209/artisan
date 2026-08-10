# Artisan v2 Rebuild — Task Index

Full rebuild of Artisan per `/artisan-v2-spec.md` (rev 5) and `/artisan-v2-agent-prompts.md`. The v1 task set and spec are archived at `/archive/tasks-v1/` and `/archive/specs-v1.md` — v2 supersedes all v1 decisions; do not assume any v1 component works correctly for v2 without re-verifying against the new spec.

Each task file below is self-contained and implementation-ready: context, exact scope, file paths, and a verification section. Work through them **in order** — later tasks depend on earlier ones (DB schema before code that reads it, agent infrastructure before individual agents, backend before the frontend pages that read its output).

## Build order

**Schema & config**
1. [v2-01-schema-migration.md](v2-01-schema-migration.md) — drop legacy tables, rename `signal_events`→`recommendations`, create 6 new tables, alter 4 existing ones
2. [v2-02-strategies-seed.md](v2-02-strategies-seed.md) — seed `strategies` jsonb config, typed `StrategyParams` reader

**Ingest**
3. [v2-03-nightly-ingest.md](v2-03-nightly-ingest.md) — rewrite `nightly_ingest.py`, add `pipeline_runs`/`portfolio_snapshots` writes

**Scoring & timing**
4. [v2-04-regime-classification.md](v2-04-regime-classification.md) — market regime (risk_on/neutral/risk_off)
5. [v2-05-factor-scoring.md](v2-05-factor-scoring.md) — factor weights/shortlist size from config
6. [v2-06-entry-gates-and-horizon.md](v2-06-entry-gates-and-horizon.md) — regime-aware gates, `effective_horizon_days`

**Risk**
7. [v2-07-risk-sizing.md](v2-07-risk-sizing.md) — position sizing, portfolio vetoes, trailing-stop ratchet

**Knowledge base**
8. [v2-08-knowledge-base.md](v2-08-knowledge-base.md) — `track_outcomes`, `expire_stale`, `query_decision_history`

**Agents**
9. [v2-09-agent-infrastructure.md](v2-09-agent-infrastructure.md) — shared agent plumbing, prompts, tool schemas
10. [v2-10-analyst-agents.md](v2-10-analyst-agents.md) — Fundamental / Technical / Sentiment agents
11. [v2-11-synthesis-agent.md](v2-11-synthesis-agent.md) — Synthesis (portfolio manager) agent
12. [v2-12-position-review-agent.md](v2-12-position-review-agent.md) — Position Review agent
13. [v2-13-briefing-agent.md](v2-13-briefing-agent.md) — Daily Briefing agent

**Orchestration & execution**
14. [v2-14-daily-pipeline.md](v2-14-daily-pipeline.md) — chained 6-job GitHub Actions workflow
15. [v2-15-execute-trade.md](v2-15-execute-trade.md) — rewrite `execute-trade` edge function

**Frontend**
16. [v2-16-frontend-queue.md](v2-16-frontend-queue.md) — `/queue` (edit-before-execute approval)
17. [v2-17-frontend-positions.md](v2-17-frontend-positions.md) — `/positions`
18. [v2-18-frontend-account.md](v2-18-frontend-account.md) — `/account`
19. [v2-19-frontend-orders.md](v2-19-frontend-orders.md) — `/orders`
20. [v2-20-frontend-history.md](v2-20-frontend-history.md) — `/history` (decision knowledge base, browsable)
21. [v2-21-frontend-strategy.md](v2-21-frontend-strategy.md) — `/strategy` (regime + shortlist + gates)
22. [v2-22-frontend-settings.md](v2-22-frontend-settings.md) — `/settings` (editable strategy config)
23. [v2-23-frontend-briefings.md](v2-23-frontend-briefings.md) — `/briefings`

**Bot & docs**
24. [v2-24-telegram-bot.md](v2-24-telegram-bot.md) — push notifications, `/pause`/`/resume` on `strategies.paused_until`
25. [v2-25-update-claude-md.md](v2-25-update-claude-md.md) — rewrite `/CLAUDE.md`'s DB/data-flow sections (do this last)

## Legacy cleanup (not a numbered task — folded into the tasks above at the point each item becomes obsolete)

DB tables dropped in v2-01: `signals`, `trades`, `positions`, `logs`, `composite_scores`, `social_signals`, `llm_analyses`. Code deleted: `/engine/` (legacy TS engine), `engine-py/artisan/jobs/{daily_score_signal,process_intents}.py`, `engine-py/artisan/llm/`, `engine-py/artisan/pipeline/`, `engine-py/artisan/scorers/{composite,fundamental,sentiment,technical}.py`, `engine-py/artisan/execution/`, `supabase/functions/process-signal/`, and the frontend components/routes listed in the full rebuild plan at `/Users/artemrafaielian/.claude/plans/hybrid-trade-decision-curious-sloth.md`.

Full plan reference (context, rationale, ground-truthed schema audit): see the plan file linked above.
