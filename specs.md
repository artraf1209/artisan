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
| `strategies` | Strategy config: weights, thresholds, sizing rules, **goal parameters** |
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

## 9. Strategy Overview Page — Feature Spec

**Route:** `/strategy`  
**Nav label:** Strategy  
**Purpose:** Single-page control room showing what the strategy is trying to achieve, which stocks are in scope and why, and the full lifecycle of every trade from signal to close.

---

### 9.1 Panel A — Strategy Goal

Displays the high-level intent of the active strategy and tracks progress toward it.

**Data source:** `strategies` table (goal fields below) + `accounts` table (current equity).

**New columns added to `strategies` table** (included in Task 01 migration):

| Column | Type | Default | Meaning |
|--------|------|---------|---------|
| `goal_growth_pct` | `numeric(6,2)` | `25.0` | Target portfolio growth in percent (e.g. 25 = +25%) |
| `goal_months` | `int` | `12` | Months allocated to reach the target |
| `risk_level` | `text` | `'moderate'` | One of `conservative`, `moderate`, `aggressive` |
| `start_equity` | `numeric(18,2)` | `null` | Account equity when the strategy was activated (baseline) |

**Displayed fields:**

- **Target growth** — `goal_growth_pct`% in `goal_months` months (e.g. "25% in 12 months")
- **Risk level** — badge: Conservative / Moderate / Aggressive with distinct colour
- **Instruments** — derived from `risk_level`:
  - Conservative → large-cap equities only, max 10 positions
  - Moderate → large/mid-cap equities, max 15 positions
  - Aggressive → any universe symbol, max 20 positions, smaller ATR multiplier on stops
- **Current equity** — from `accounts.equity` (synced nightly by executor)
- **Target equity** — `start_equity * (1 + goal_growth_pct / 100)`
- **Progress bar** — `(current_equity - start_equity) / (target_equity - start_equity) * 100`, clamped to [0, 100]
- **Days remaining** — computed from `strategies.created_at + goal_months months - today`
- **P&L since start** — `current_equity - start_equity` in `$` and `%`

If `start_equity` is null (strategy not yet activated): show a "Set baseline" prompt. If `accounts.equity` is null (account not yet synced): show dashes.

---

### 9.2 Panel B — Universe Analysis Thesis

Structured view of every stock in the active strategy's universe. Explains **why** each stock is being tracked and **how it has performed** since inclusion.

**Data sources:**
- `universes` (universe membership + `added_at` date)
- `composite_scores` (latest F/T/S scores per symbol)
- `indicator_values` (latest computed indicators — used for the "indicator detail" tooltip)
- `price_bars` (close price at `added_at` date and most recent close — used for trend %)

**Table columns:**

| Column | Source | Notes |
|--------|--------|-------|
| Symbol | `universes.symbol` | Clickable — links to trade notes for that symbol |
| Sector | `assets.sector` | Shows "—" if asset metadata not yet loaded |
| Added | `universes.added_at` | Date the symbol was added to the universe |
| F-Score | `composite_scores.f_score` | Colour-coded bar: ≥0.65 green, 0.45–0.65 yellow, <0.45 red |
| T-Score | `composite_scores.t_score` | Same colour logic |
| S-Score | `composite_scores.s_score` | Same colour logic |
| Composite | `composite_scores.composite` | Bold. Pillars-passed indicator (e.g. "2/3") |
| Key indicators | `indicator_values` | Top signal per pillar: e.g. "RSI 71 · MACD ↑ · P/E 18x" |
| Trend since added | `price_bars` | `(latest_close − close_at_added) / close_at_added × 100` — shown as `+3.2%` / `-1.1%` with colour |
| Active signal | `signal_events` | Badge: Pending / Approved / None |

**Empty states:**
- If `universes` is empty (pre-migration): show the 10 hardcoded symbols with all scores as "—" and a "Run first ingestion to populate" notice.
- If scores exist but price data is missing: show scores with trend as "—".

**Interaction:** Clicking a row opens `/trades/notes/[signal_id]` for the latest signal for that symbol, or `/trades/queue` if one is pending approval.

---

### 9.3 Panel C — Trade Pipeline

Three-column Kanban showing every trade in its current lifecycle stage.

**Columns:**

#### Waiting
Signals that have been generated but not yet executed. Two sub-states shown inline:
- **Pending approval** — `signal_events.status = 'pending'`. Needs human decision in `/trades/queue`.
- **Approved, awaiting execution** — `signal_events.status = 'approved'` with a linked `trade_intents` row. Will be picked up on the next `daily-score-signal` GH Actions run.

**Card fields:** Symbol · Direction (Long) · Entry price (stop_price as stop / target_price as TP) · Composite score badge · Time since generated

#### In Market
Open positions — trades that have been executed and not yet closed.

**Primary data source:** `portfolio_positions` (Python hybrid engine).  
**Fallback:** legacy `positions` table (TypeScript engine) — used when `portfolio_positions` is empty.

**Card fields:** Symbol · Qty · Avg entry · Current price · Unrealized P&L in `$` and `%` (colour-coded) · Stop price · Target price · Days held (from `portfolio_positions.opened_at`)

#### Closed
Positions that have been fully exited.

**Primary data source:** `trade_executions` where `status = 'filled'`, joined with `trade_intents` to get entry price.  
**Fallback:** legacy `trades` table where `status = 'filled'` (TypeScript engine records).

**Card fields:** Symbol · Side (Buy / Sell) · Entry price · Exit price · Qty · Realized P&L in `$` and `%` (colour-coded) · Closed date

**Sorting:** Closed trades sorted by `filled_at desc` (most recent first). Max 50 shown with "Show all" link.

---

### 9.4 API Routes

| Route | Method | Returns |
|-------|--------|---------|
| `/api/strategy/overview` | GET | Strategy goal + account equity + universe list with latest scores, indicators, and trend % |
| `/api/strategy/trades` | GET | `{ waiting, in_market, closed }` — gracefully falls back to legacy tables |

Both routes use the server-side Supabase client (anon key with RLS `select` policies). No auth required for Phase 0.

---

### 9.5 Frontend Components

| Component | File | Notes |
|-----------|------|-------|
| `GoalPanel` | `components/strategy/GoalPanel.tsx` | Progress bar, equity numbers, risk badge |
| `UniverseThesis` | `components/strategy/UniverseThesis.tsx` | Responsive table; score bars rendered as inline divs |
| `TradePipeline` | `components/strategy/TradePipeline.tsx` | 3-column grid on desktop, stacked on mobile |
| `TradeCard` | `components/strategy/TradeCard.tsx` | Shared card for all three pipeline columns |
| `/strategy` page | `app/strategy/page.tsx` | Server Component; fetches both API routes, passes data to the three panels |

**Nav change:** Add `{ href: '/strategy', label: 'Strategy', icon: Target }` to `Navbar.tsx`. The `Target` icon is available in `lucide-react`.

---

### 9.6 Schema change summary (adds to Task 01 migration)

```sql
-- Add goal columns to strategies table
alter table public.strategies
  add column if not exists goal_growth_pct  numeric(6,2)  not null default 25.0,
  add column if not exists goal_months      int           not null default 12,
  add column if not exists risk_level       text          not null default 'moderate'
    check (risk_level in ('conservative','moderate','aggressive')),
  add column if not exists start_equity     numeric(18,2);

-- Update seed to include goal defaults
update public.strategies
set goal_growth_pct = 25.0,
    goal_months     = 12,
    risk_level      = 'moderate'
where name = 'long_term_v0';
```

---

## 10. Open Questions

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
