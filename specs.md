# Artisan — Technical Specification

## Status: DRAFT

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        fly.io                                    │
│  ┌──────────────────┐         ┌────────────────────────────┐   │
│  │  Trading Engine   │         │      Telegram Bot          │   │
│  │  (Bun + TS)       │         │      (Bun + grammy)        │   │
│  │                   │         │                            │   │
│  │  poll market data │         │  /status /trades           │   │
│  │  run ML models    │         │  /pause /resume            │   │
│  │  emit signals     │         │                            │   │
│  └────────┬──────────┘         └────────────┬───────────────┘   │
│           │                                 │                    │
└───────────┼─────────────────────────────────┼────────────────────┘
            │ writes signals/logs             │ reads positions/trades
            ▼                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Supabase                                  │
│                                                                  │
│  signals  trades  positions  logs  alerts                        │
│                                                                  │
│  Edge Functions:                                                 │
│  - process-signal (validate threshold → execute-trade)          │
│  - execute-trade (calls Alpaca API, writes trade)               │
│  - send-alert (POSTs Telegram message)                          │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Realtime subscriptions
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vercel (Next.js 15)                          │
│                                                                  │
│  /dashboard   /trades   /signals   /settings                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Broker
- Provider: **Alpaca** (paper-api.alpaca.markets for non-production)
- Asset classes: US equities (NYSE/NASDAQ) + crypto
- Paper trading: required for all non-production environments (`PAPER_TRADING=true`)
- Order types supported: market, limit (phase 1)
- Market data: Alpaca Data API v2 (IEX free tier or SIP paid)

## 3. AI/ML signal models
- Phase 1: rule-based momentum (SMA crossover, no external model needed)
- Phase 2: LLM-assisted signal scoring via Anthropic Claude
- Signal schema: `{ model, symbol, direction: 'long'|'short'|'flat', confidence: 0–1 }`
- Confidence threshold for auto-execution: **0.70** (configurable via settings)

## 4. Data flow (detailed)
1. Engine polls Alpaca Data API every 60s (configurable)
2. Model evaluates bars → emits Signal written to `signals` table
3. `process-signal` edge function triggers on INSERT to `signals`
4. If `confidence >= threshold` AND engine not paused → invoke `execute-trade`
5. `execute-trade` submits order to Alpaca, writes `{ status: 'filled', broker_order_id, filled_at }` to `trades`
6. `send-alert` edge function fires on trade fill → POSTs to Telegram
7. Next.js dashboard subscribes to `trades`, `positions`, `signals` via Supabase Realtime

## 5. Risk controls (phase 1)
- Max position size: **5%** of portfolio per symbol
- Max daily drawdown halt: **-3%** (engine writes pause flag to Supabase `settings` table)
- Manual pause/resume via Telegram `/pause` and `/resume` commands
- All risk thresholds configurable in `/settings` dashboard page

## 6. Auth
- Supabase Auth with email/password (magic link optional)
- Single-user mode (no multi-tenant for v1)
- RLS: all tables default-deny; service role used by engine/bot/edge functions only

## 7. Deployment
| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend  | Vercel   | Auto-deploy on push to `main` |
| DB + Edge Functions | Supabase | Hosted project |
| Engine    | fly.io (`artisan-engine`) | Single shared-cpu-1x, 256MB |
| Bot       | fly.io (`artisan-bot`)    | Single shared-cpu-1x, 256MB |

## 8. Environment variables
See `.env.example` for full list.

## 9. Open questions
- [ ] Market data tier: IEX (free) or SIP (paid) on Alpaca?
- [ ] Engine polling interval — 60s enough, or need streaming WebSocket?
- [ ] Crypto symbols to support (BTC/USD, ETH/USD, others)?
- [ ] Engine hosting region on fly.io (iad for US East proximity to Alpaca)?
- [ ] Multi-user support needed in v2?
