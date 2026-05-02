# Artisan — Claude Code Context

## What this is
AI/ML-powered autonomous trading application. Four workspaces in one monorepo:
trades US equities and crypto via Alpaca, runs AI/ML signals, shows a Next.js dashboard,
and communicates via Telegram bot.

## Workspace map
| Path        | Runtime          | Purpose                                      |
|-------------|------------------|----------------------------------------------|
| `/app`      | Next.js 15 + Bun | Trading dashboard UI, API routes             |
| `/bot`      | Bun + grammy     | Telegram bot for notifications and control   |
| `/engine`   | Bun (TS)         | Trading engine, broker adapters, ML models   |
| `/supabase` | Deno v2          | DB migrations, edge functions                |

## Key conventions
- All DB types come from `supabase/types.ts` — never write raw SQL in TS files
- Engine writes signals to `signals` table; `process-signal` edge function picks them up
- `execute-trade` edge function is the ONLY code that calls the Alpaca API server-side
- Paper trading is always the default; set `PAPER_TRADING=false` only in production
- Telegram alerts are sent exclusively via the `send-alert` edge function
- Use `SUPABASE_SERVICE_ROLE_KEY` only in engine, bot, and edge functions — never browser

## Database tables
| Table       | Purpose                                      |
|-------------|----------------------------------------------|
| `signals`   | AI/ML model outputs (created before trades)  |
| `trades`    | Executed order records, FK → signals         |
| `positions` | Current open positions, upserted by engine   |
| `logs`      | Structured engine/system logs                |
| `alerts`    | Telegram notification history                |

## Data flow
1. Engine polls market data → runs model → emits Signal → writes to `signals`
2. `process-signal` edge function validates confidence threshold
3. If above threshold → calls `execute-trade` edge function
4. `execute-trade` submits order to Alpaca, writes result to `trades`
5. `send-alert` edge function POSTs Telegram notification
6. Next.js dashboard subscribes to `trades`, `positions`, `signals` via Supabase Realtime

## Broker adapter pattern
All brokers implement `IBroker` in `engine/src/broker/index.ts`.
Add new brokers in `engine/src/broker/<name>.ts`.
Current adapters: `alpaca.ts`, `paper.ts`

## Hosting
| Service | Platform |
|---------|----------|
| Frontend | Vercel (auto-deploy from main) |
| Database / Edge Functions | Supabase |
| Engine + Bot | fly.io (artisan-engine, artisan-bot) |

## Make targets
Run `make help` for all available targets.

## Do not
- Commit `.env` files or `supabase/types.ts` (generated)
- Call broker API directly from Next.js frontend or bot
- Use `SUPABASE_SERVICE_ROLE_KEY` in browser-side code
- Set `PAPER_TRADING=false` without explicit production intent
