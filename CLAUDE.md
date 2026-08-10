# Artisan — Claude Code Context

## What this is
AI/ML-powered autonomous trading application. Four workspaces in one monorepo:
handles US equities and crypto via Alpaca-backed data/account adapters, runs the v2 daily scoring and recommendation pipeline, shows a Next.js dashboard,
and communicates via Telegram bot.

## Workspace map
| Path        | Runtime          | Purpose                                      |
|-------------|------------------|----------------------------------------------|
| `/app`      | Next.js 15 + Bun | Trading dashboard UI, API routes             |
| `/bot`      | Bun + grammy     | Telegram bot for notifications and control   |
| `/engine-py`| Python 3.12 + uv | Ingest, scoring, agents, risk logic, jobs    |
| `/supabase` | Deno v2          | DB migrations, edge functions                |

## Key conventions
- App-side DB typing lives in `app/src/types/index.ts` — prefer typed Supabase queries over ad-hoc SQL in TS files
- `nightly-ingest.yml` creates the shared `pipeline_runs` row; `daily_pipeline.yml` reuses that row from `score` through `briefing`
- Strategy thresholds live in `strategies` jsonb config columns and are read through `engine-py/artisan/strategy_params.py`
- `execute-trade` edge function is the ONLY code that calls the Alpaca API server-side
- Paper trading is always the default; set `PAPER_TRADING=false` only in production
- Telegram alerts are sent exclusively via the `send-alert` edge function
- Use `SUPABASE_SERVICE_ROLE_KEY` only in engine, bot, and edge functions — never browser

## Database tables
- Pipeline anchor: `pipeline_runs`
- Scoring and timing: `regime_snapshots`, `factor_scores`, `entry_signals`
- Decisions: `recommendations`, `position_reviews`, `decision_outcomes`
- Execution: `trade_intents`, `trade_executions`, `portfolio_positions`, `portfolio_snapshots`
- AI output: `agent_analyses`, `briefings`
- Reference and audit: `universes`, `assets`, `price_bars`, `fundamentals`, `news_articles`, `indicator_values`, `strategies`, `audit_log`, `alerts`, `users`, `accounts`

## Data flow
1. `nightly-ingest.yml` refreshes the universe, prices, fundamentals, and news, then writes the shared `pipeline_runs` row plus the daily `portfolio_snapshots` row.
2. On success, `daily_pipeline.yml` runs six chained jobs: `score` (regime, factor scoring, entry gates, effective horizon) -> `track_outcomes` -> `expire_stale` -> `review_positions` -> `synthesize` -> `briefing`.
3. New entry ideas and approval-required position actions land in `recommendations` and `position_reviews` with `status='pending'`, then surface in the approval queue.
4. Human approval or rejection flows through the queue UI and API routes; `execute-trade` is the only path that places Alpaca orders and updates `trade_executions` plus `portfolio_positions`.
5. `send-alert` pushes the condensed daily briefing summary to Telegram.
6. The Next.js pages (`/positions`, `/account`, `/orders`, `/history`, `/strategy`, `/settings`, `/briefings`) read directly from the v2 tables above, and `/settings` writes back to `strategies` so the next pipeline run picks up the new config.

## Broker adapter pattern
Market-data and account adapters live under `engine-py/artisan/adapters`.
Current adapters: `alpaca_account.py`, `alpaca_prices.py`, `fmp_fundamentals.py`, `fmp_screener.py`, `finnhub_news.py`

## Hosting
| Service | Platform |
|---------|----------|
| Frontend | Vercel (auto-deploy from main) |
| Database / Edge Functions | Supabase |
| Engine + Bot | fly.io (artisan-engine, artisan-bot) |

## Make targets
Run `make help` for all available targets.

## Do not
- Commit `.env` files
- Call broker API directly from Next.js frontend or bot
- Call the Alpaca API directly from `engine-py` — `execute-trade` is the only order-placement path
- Use `SUPABASE_SERVICE_ROLE_KEY` in browser-side code
- Set `PAPER_TRADING=false` without explicit production intent
