# Artisan — Technical Specification

## Status: PHASE 0 POC

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                               │
│                                                                      │
│  nightly-ingest.yml       daily-score-signal.yml  daily-briefing.yml │
│  (2 AM UTC weeknights)    (1:30 PM UTC weekdays)  (11:30 AM UTC)     │
│                                                                      │
│  Python engine-py/artisan:                                           │
│  - data adapters (Alpaca prices, FMP fundamentals, Finnhub news)     │
│  - F/T/S scoring (RSI, P/E, VADER)                                   │
│  - confluence gate + veto rules                                      │
│  - position sizing + ATR stops                                       │
│  - LLM analyst (Claude Haiku 4.5 — thesis + briefing)                │
│  - Alpaca paper executor                                             │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ writes via supabase-py (service role)
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         fly.io                                       │
│  ┌──────────────────────┐       ┌──────────────────────────────┐     │
│  │  TypeScript Engine   │       │       Telegram Bot           │     │
│  │  (Bun, legacy)       │       │       (Bun + grammy)         │     │
│  │                      │       │                              │     │
│  │  SMA crossover model │       │  /status /trades             │     │
│  │  → signals table     │       │  /pause /resume              │     │
│  └──────────┬───────────┘       └──────────────┬───────────────┘     │
└─────────────┼──────────────────────────────────┼─────────────────────┘
              │ writes (legacy tables)           │ reads positions/trades
              ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Supabase                                     │
│                                                                      │
│  Legacy tables (TS engine):                                          │
│    signals  trades  positions  logs  alerts                          │
│                                                                      │
│  Hybrid engine tables (Python):                                      │
│    users  accounts  strategies  universes  assets                    │
│    price_bars  fundamentals  news_articles  social_signals           │
│    indicator_values  composite_scores  signal_events                 │
│    trade_intents  trade_executions  portfolio_positions              │
│    llm_analyses  audit_log                                           │
│                                                                      │
│  Edge Functions (Deno):                                              │
│    process-signal  execute-trade  send-alert                         │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ Realtime + supabase-js
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Vercel (Next.js 15)                              │
│                                                                      │
│  Legacy pages: /dashboard  /trades  /signals  /logs                  │
│  Hybrid pages: /trades/queue  /trades/notes/[id]  /briefings         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Broker

- Provider: **Alpaca** (paper-api.alpaca.markets for non-production)
- Asset classes: US equities (NYSE/NASDAQ). Crypto deferred to Phase 1.
- Paper trading: required for all non-production environments (`PAPER_TRADING=true`)
- Order types: market (Phase 0), limit (Phase 1)
- Market data: Alpaca Data API v2 (IEX free tier)

**Python broker adapter** (`engine-py/artisan/execution/alpaca_executor.py`):
- Abstract `BrokerAdapter` class; `AlpacaAdapter` and `PaperAdapter` concrete implementations
- Execution entry point reads approved `trade_intents` rows, submits orders, writes `trade_executions`

**TypeScript broker** (legacy, `engine/src/broker/`):
- `IBroker` interface with `AlpacaBroker` and `PaperBroker` implementations
- Still runs on fly.io for the momentum model flow

---

## 3. AI/ML Signal Models

### Phase 0 — Hybrid Decision Engine (Python, GitHub Actions)

Three scoring pillars, each normalized to [0, 1]:

| Pillar | Weight | Signals used |
|--------|--------|-------------|
| Fundamental (F) | 0.50 | P/E ratio, P/B, ROE, debt/equity vs sector |
| Technical (T) | 0.25 | RSI-14, MACD, ATR-14, Bollinger Bands |
| Sentiment (S) | 0.25 | VADER compound score on Finnhub news headlines |

**Composite score** = `F*0.50 + T*0.25 + S*0.25`

**Confluence gate**: signal passes if ≥2 of the 3 pillars individually score above `strategy.threshold` (default 0.55).

**Veto rules**:
- `earnings_blackout_veto`: blocks signals within ±3 calendar days of earnings date
- `anomaly_placeholder`: always passes (IsolationForest model deferred to Phase 1)

**LLM analyst** (Claude Haiku 4.5, `claude-haiku-4-5-20251001`):
- **Thesis**: per-signal narrative articulating why scores point this direction + invalidation conditions. System prompt cached across symbols in a single run.
- **Daily briefing**: morning summary of yesterday's signals + top news headlines by sentiment.
- LLM is analyst-only — never modifies scores, never calls broker APIs.

### Phase 1 additions (deferred)
- LightGBM direction classifier (ML pillar, weight 0.20; F/T/S weights rebalanced)
- FinBERT replacing VADER for sentiment
- IsolationForest anomaly detector (activates anomaly_placeholder veto)
- HMM regime detector
- Alpha/Beta pillar (rolling vs SPY)

### Legacy TypeScript engine (fly.io)
- Rule-based SMA crossover: 10-bar vs 30-bar. `long` if ratio > 1.02, `short` if < 0.98.
- Confidence: `MIN_CONFIDENCE (0.65) + spread * 10`, capped at 0.95
- Writes to legacy `signals` table; edge function `process-signal` picks it up

---

## 4. Data Flow

### Python hybrid engine (Phase 0)

```
1. nightly-ingest (2 AM UTC weeknights):
   alpaca_prices → price_bars
   fmp_fundamentals → fundamentals (includes earnings_date)
   finnhub_news → news_articles (VADER scored inline)

2. daily-briefing (11:30 AM UTC / 6:30 AM ET):
   Claude Haiku → llm_analyses (analysis_type='briefing')

3. daily-score-signal (1:30 PM UTC / 9:30 AM ET):
   indicator_values ← computed from price_bars (RSI, MACD, ATR, BB)
   composite_scores ← F+T+S weighted sum
   confluence_gate + veto_rules → signal_events (status='pending')
   Claude Haiku → llm_analyses (analysis_type='thesis') per signal
   → read approved trade_intents from prior run
   → AlpacaAdapter.place_order → trade_executions, portfolio_positions

4. Human approval (Next.js /trades/queue):
   POST /api/queue/[id]/approve
   → signal_events.status = 'approved'
   → trade_intents row created (status='pending')
   → picked up by next daily-score-signal run
```

### Legacy TypeScript engine data flow
```
1. Engine polls Alpaca Data API every 60s
2. MomentumModel evaluates bars → writes Signal to signals table
3. process-signal edge function fires on INSERT to signals
4. If confidence >= 0.70 AND engine not paused → invoke execute-trade
5. execute-trade submits order to Alpaca → writes to trades table
6. send-alert fires on trade fill → POSTs Telegram message
7. Dashboard subscribes via Realtime to trades, positions, signals
```

---

## 5. Database Tables

### Legacy tables (TS engine — do not modify)
| Table | Purpose |
|-------|---------|
| `signals` | Momentum model outputs |
| `trades` | Alpaca order records (FK → signals) |
| `positions` | Current positions (upserted by TS engine) |
| `logs` | Engine/bot structured logs |
| `alerts` | Telegram notification history |

### Hybrid engine tables (Python — Phase 0)
| Table | Purpose |
|-------|---------|
| `users` | Single admin user (UUID seeded in migration) |
| `accounts` | Alpaca paper account link |
| `strategies` | Strategy config: weights, thresholds, sizing rules |
| `universes` | Symbol universe per strategy (10 large-caps for Phase 0) |
| `assets` | Symbol metadata (sector, exchange) |
| `price_bars` | Daily OHLCV, partitioned by month |
| `fundamentals` | Point-in-time ratios from FMP (P/E, P/B, ROE, earnings_date) |
| `news_articles` | Finnhub headlines with VADER compound scores |
| `social_signals` | Placeholder for Phase 1 Reddit/StockTwits data |
| `indicator_values` | Computed technical indicators (RSI, MACD, ATR, BB, SMA) |
| `composite_scores` | F/T/S scores + weighted composite per symbol per run |
| `signal_events` | Confluence-passed signals awaiting human approval |
| `trade_intents` | Approved trade orders pending execution (FK → signal_events) |
| `trade_executions` | Actual fills from Alpaca paper (FK → trade_intents) |
| `portfolio_positions` | Current Python-engine positions (upserted by executor) |
| `llm_analyses` | Claude outputs: thesis and daily briefing |
| `audit_log` | Every pipeline action (ingest, score, signal, execute) |

---

## 6. Risk Controls

### Phase 0
- Position sizing: fixed fractional — `qty = floor((equity * 0.05) / price)` (5% of equity per position)
- Stop loss: `entry - 2 * ATR(14)`
- Take profit: `entry + 3 * ATR(14)`
- Earnings blackout: no new signals within ±3 calendar days of earnings date
- All new signals require human approval in the `/trades/queue` UI

### Phase 1 additions
- Max portfolio position: 5% per symbol (enforced by `portfolio_constraints_enforcer`)
- Max daily drawdown halt: -3% (kill switch via `risk_monitor/`)
- IsolationForest anomaly veto
- Auto-approve toggle for small positions (after 3-month paper track record)

---

## 7. Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend (legacy + hybrid pages) | Vercel | Auto-deploy on push to main |
| DB + Edge Functions | Supabase | Hosted project |
| Python hybrid engine | GitHub Actions | Cron-triggered; 3 workflows |
| TypeScript engine | fly.io (`artisan-engine`) | Single shared-cpu-1x, 256MB |
| Telegram bot | fly.io (`artisan-bot`) | Single shared-cpu-1x, 256MB |

---

## 8. Environment Variables

### Existing (reuse)
| Variable | Used by |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js frontend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js frontend |
| `SUPABASE_URL` | TS engine, Python engine, bot |
| `SUPABASE_SERVICE_ROLE_KEY` | TS engine, Python engine, bot, edge functions |
| `ALPACA_API_KEY` | TS engine, Python engine |
| `ALPACA_API_SECRET` | TS engine, Python engine |
| `ALPACA_BASE_URL` | TS engine, Python engine (paper URL) |
| `TELEGRAM_BOT_TOKEN` | Bot |
| `TELEGRAM_CHAT_ID` | Bot |

### New (Phase 0)
| Variable | Used by | Notes |
|----------|---------|-------|
| `FMP_API_KEY` | `fmp_fundamentals.py` | Free tier: 250 calls/day |
| `FINNHUB_API_KEY` | `finnhub_news.py` | Free tier: 60 req/min |
| `ANTHROPIC_API_KEY` | `thesis_analyst.py`, `daily_briefing.py` | Haiku 4.5: $1/$5 per MTok |
| `ALPACA_PAPER_ACCOUNT_ID` | `alpaca_executor.py` | From Alpaca paper dashboard |
| `ADMIN_USER_ID` | Next.js approve/reject API routes | Fixed: `00000000-0000-0000-0000-000000000001` |

All new variables added to: GitHub Actions repo secrets, `engine-py/.env` (gitignored), `app/.env.local` (gitignored).

---

## 9. Open Questions

### Answered
- ~~Market data tier?~~ → IEX free tier on Alpaca for Phase 0; Polygon Starter ($29/mo) when needed
- ~~Engine hosting region?~~ → fly.io iad (US East, closest to Alpaca paper API)
- ~~Crypto symbols?~~ → Deferred to Phase 1; Phase 0 is US equities only
- ~~Multi-user support?~~ → Single-user POC for Phase 0 (fixed admin UUID, no Auth)
- ~~Engine polling interval?~~ → Python engine runs on GH Actions cron (not real-time polling); TS engine keeps 60s polling

### Remaining
- [ ] FMP free tier (250 calls/day) — enough for 10 symbols? Monitor and plan Starter upgrade path
- [ ] Earnings blackout window: ±3 days sufficient, or should it be ±1 day pre-earnings?
- [ ] LLM budget cap per day (current plan: soft cap via `llm_analyses` aggregate query)
- [ ] When to enable auto-approve toggle (spec says after ≥3 months, ≥30 paper trades)
- [ ] Partition management: who creates next-month `price_bars` partitions? (pg_cron job in Phase 1)
