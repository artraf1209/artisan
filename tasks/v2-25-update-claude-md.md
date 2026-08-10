# v2-25 — Update CLAUDE.md

**Depends on:** v2-01 through v2-24 (all of them — this is the closing task, documenting the rebuild's actual final shape)
**Touches:** `/CLAUDE.md`

## Context

`CLAUDE.md` at the project root currently documents the v1 architecture verbatim: the workspace map, the 5-table `signals`/`trades`/`positions`/`logs`/`alerts` list, and the `process-signal`/`execute-trade`/`send-alert` data flow. Once this rebuild lands, that documentation becomes actively misleading — `signals`/`trades`/`positions`/`logs` are dropped in v2-01, and `process-signal` is deleted entirely. Since CLAUDE.md is loaded into every future Claude Code session working on this repo, leaving it stale would actively mislead future work.

## Scope

Rewrite two sections of `CLAUDE.md`, leaving the rest intact:

### "Database tables" section

Replace the 5-row legacy table with the actual v2 table set, grouped logically:
- **Pipeline anchor:** `pipeline_runs`
- **Scoring/timing:** `regime_snapshots`, `factor_scores`, `entry_signals`
- **Decisions:** `recommendations` (renamed from `signal_events`), `position_reviews`, `decision_outcomes`
- **Execution:** `trade_intents`, `trade_executions`, `portfolio_positions`, `portfolio_snapshots`
- **AI output:** `agent_analyses`, `briefings`
- **Reference/audit:** `universes`, `assets`, `price_bars`, `fundamentals`, `news_articles`, `indicator_values`, `strategies`, `audit_log`, `alerts`, `users`, `accounts`

### "Data flow" section

Replace the old 6-step v1 flow with the actual v2 pipeline:
1. `nightly_ingest.yml` refreshes universe/prices/fundamentals/news, writes a `pipeline_runs` row and a `portfolio_snapshots` row.
2. On success, `daily_pipeline.yml` runs 6 chained jobs: `score` (regime + factor scoring + gates + effective horizon) → `track_outcomes` → `expire_stale` → `review_positions` (trailing-stop ratchet + Position Review agent) → `synthesize` (3 analyst agents + Synthesis agent) → `briefing`.
3. New entries and position actions requiring approval land in `recommendations`/`position_reviews` with `status='pending'`, surfaced on `/queue`.
4. User approves (optionally editing shares/stop/target) or rejects via `/queue` → `execute-trade` edge function is the only path that calls Alpaca, places the order, and updates `trade_executions`/`portfolio_positions`.
5. `send-alert` edge function pushes the daily briefing summary to Telegram.
6. The Next.js dashboard and dedicated pages (`/positions`, `/account`, `/orders`, `/history`, `/strategy`, `/settings`, `/briefings`) read directly from the tables above; `/settings` writes back to `strategies`' jsonb config columns, picked up by the next pipeline run.

### Sections to leave unchanged

- Workspace map, key conventions, broker adapter pattern, hosting table, Make targets — all still accurate.
- "Do not" list — still accurate; consider adding one line formalizing what v2-15 already enforces: *"Do not call the Alpaca API from `engine-py` directly — `execute-trade` is the only order-placement path."* (This was being violated by the now-deleted `engine-py/artisan/execution/alpaca_executor.py`.)

## Verification
1. Read the rewritten `CLAUDE.md` top to bottom and confirm every table/workflow/function name it mentions actually exists in the post-rebuild codebase (grep to confirm, don't just eyeball it).
2. Confirm no v1-only concept (`signals`, `trades`, `positions`, `logs`, `process-signal`, `signal_events`, `llm_analyses`) is mentioned anywhere in the file.
