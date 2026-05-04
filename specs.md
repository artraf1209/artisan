# Artisan — Technical Specification

## Status: PHASE 0 POC

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                               │
│                                                                      │
│  nightly-ingest.yml         daily-score-signal.yml     daily-briefing.yml   │
│  (9pm UTC / 4pm EST)     (10pm UTC / 5pm EST)  (10pm UTC / 5pm EST)│
│  Sun-Thu after FMP reset   Mon-Fri after ingest   Mon-Fri after ingest │
│                                                                      │
│  Python engine-py/artisan:                                           │
│  - FMP quota guard (post-reset at 8pm UTC / 3pm EST)                 │
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
│  ┌──────────────────────┐          ┌──────────────────────────────┐  │
│  │  TypeScript Engine   │          │       Telegram Bot           │  │
│  │  (Bun, legacy)       │          │       (Bun + grammy)         │  │
│  │                      │          │                              │  │
│  │  SMA crossover model │          │  /status /trades             │  │
│  │  → signals table     │          │  /pause /resume              │  │
│  └──────────┬───────────┘          └──────────────┬───────────────┘  │
└─────────────┼─────────────────────────────────────┼──────────────────┘
              │ writes (legacy tables)              │ reads positions/trades
              ▼                                     ▼
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
1. nightly-ingest (9pm UTC / 4pm EST Sun-Thu):
   - FMP quota guard blocks pre-reset (before 9pm UTC)
   - alpaca_prices → price_bars
   - fmp_fundamentals → fundamentals (includes earnings_date)
   - finnhub_news → news_articles (VADER scored inline)

2. daily-briefing (10pm UTC / 5pm EST Mon-Fri):
   - Uses data from prior evening's ingest
   - Claude Haiku → llm_analyses (analysis_type='briefing')

3. daily-score-signal (10pm UTC / 5pm EST Mon-Fri):
   - Uses data from prior evening's ingest
   - indicator_values ← computed from price_bars (RSI, MACD, ATR, BB, SMA, ADX, OBV, vol_ratio)
   - composite_scores ← F+T+S weighted sum
   - factor_scores ← sector-neutral multi-factor model (Value, Quality, Momentum, Low Vol, Growth)
   - entry_signals ← ranked-shortlist timing gates and sizing
   - confluence_gate + veto_rules → signal_events (status='pending')
   - Claude Haiku → llm_analyses (analysis_type='thesis') per signal
   - → read approved trade_intents from prior run
   - AlpacaAdapter.place_order → trade_executions, portfolio_positions

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
| `universes` | Dynamic screened symbol universe per strategy (`active`, `screened_at`) |
| `assets` | Symbol metadata (sector, exchange) |
| `price_bars` | Daily OHLCV, partitioned by month |
| `fundamentals` | Annual FMP fundamentals history, including FCF, balance-sheet, and earnings metadata |
| `news_articles` | Finnhub headlines with VADER compound scores |
| `social_signals` | Placeholder for Phase 1 Reddit/StockTwits data |
| `indicator_values` | Computed technical indicators (RSI, MACD, ATR, BB, SMA, ADX, OBV, vol_ratio) |
| `composite_scores` | F/T/S scores + weighted composite per symbol per run |
| `factor_scores` | Sector-neutral five-factor z-scores, composite rank, and hard-filter status |
| `entry_signals` | Ranked-shortlist timing gates, setup detection, and position sizing |
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

## 9. Strategy Page — Multi-Factor Enhancement

**Route:** `/strategy`  
**Nav label:** Strategy  
**Purpose:** Single-page control room for the active strategy, combining factor selection, entry timing, and the existing hybrid trade pipeline.

### 9.0 Context And Constraints

The legacy Strategy page is built around the existing three-pillar model:

- `composite_scores` = fundamental + technical + sentiment
- `signal_events` = confluence-passed paper-trading signals
- a static 10-symbol universe for Phase 0

The multi-factor enhancement adds a second quantitative layer without replacing the legacy hybrid engine. The existing F/T/S model, `composite_scores`, and `signal_events` remain intact.

Required constraints:

- FMP free-tier budget is approximately 250 calls/day
- `SPY` is required as the market benchmark for both factor and timing logic
- the strategy surface must support future multi-strategy selection from a dropdown
- the page must render four blocks in order: Strategy Summary, Stocks to Trade, When to Trade, Trade Pipeline

---

### 9.1 Page Structure

The page renders four blocks in order:

1. **Strategy Summary** — active strategy selector, universe definition, hard filters, factor weights, goal metadata, and the live funnel (`screened → hard-filter pass → ranked → in portfolio`).
2. **Stocks to Trade** — ranked factor table for the latest `factor_scores` run.
3. **When to Trade** — top-ranked shortlist from `entry_signals`, including gate state, setup, risk levels, and sizing.
4. **Trade Pipeline** — existing Waiting / In Market / Closed lifecycle view.

Strategy selection must scope all four blocks to the chosen `strategies` row. For rows that cannot be attributed cleanly to a non-default strategy, the UI may either hide legacy fallback data or label it as legacy/global context.

---

### 9.2 Universe Funnel And Hard Filters

The strategy universe is no longer defined as a permanently hardcoded basket. It is driven by a nightly screener and a hard-filter stage:

```text
FMP screener (~500-2000 tickers)
  → top candidates by market cap
      → hard filter: FCF > 0, net_debt / EBITDA < 4
          → sector-neutral factor scoring
              → rank all survivors
                  → top max_positions names go to When to Trade
```

Universe requirements:

- active US-listed equities only
- market cap > $1B
- average daily volume > $5M
- listed for 5+ years
- exchanges limited to NASDAQ and NYSE

Operational requirements:

- screener results update `universes`
- newly screened names are upserted with `active = true`
- names dropped by the screener are retained historically but marked `active = false`
- `screened_at` records the latest screener timestamp
- the active screened universe target is configurable and defaults to 40 names to stay within the FMP free-tier budget

Hard-filter requirements:

- `FCF > 0`
- `net_debt / EBITDA < 4`
- symbols failing hard filters do not receive ranks and do not appear in `entry_signals`
- `factor_scores.hard_filter_pass` records pass/fail status for auditability and funnel display

---

### 9.3 FMP Budget And Ingest Requirements

The screener and fundamentals pipeline must explicitly respect the FMP free-tier budget instead of assuming unlimited daily refreshes.

- broad screener pass: 1 call/day
- target screened universe: default 40 active names
- expected fundamentals inputs: profile, key metrics, ratios, income statement, cash-flow statement, balance-sheet statement
- annual history is needed for revenue, EPS, and FCF growth calculations

Budget behavior requirements:

- `SCREENER_TOP_N` must be configurable in engine config
- a separate fundamentals refresh cap must be configurable so nightly ingest can refresh only the stalest or missing subset instead of all active names every run
- daily scoring must run from DB-resident fundamentals and price history, not by fetching live FMP history during scoring
- if the configured FMP screener endpoint is unavailable for the account, the pipeline must record a degraded state explicitly rather than silently pretending the screener succeeded

`nightly_ingest.py` requirements:

- append `SPY` to the price ingest symbol list
- ingest enough price history to support both `Momentum 12m-1m` and `Beta_60m`
- persist annual fundamentals history, not just the latest snapshot

---

### 9.4 Factor Model Methodology

The factor model is cross-sectional and sector-relative.

Methodology rules:

- all factor components are winsorized at the 1st / 99th percentile within sector
- all factor components are sector-neutral z-scored
- z-scores are clipped to `[-3, 3]`
- each factor score is the mean of its available component z-scores
- the composite factor score is a weighted sum of the five factor z-scores

Factor weights:

| Factor | Weight |
|--------|--------|
| Value | 25% |
| Quality | 25% |
| Momentum | 25% |
| Low Vol | 10% |
| Growth | 15% |

#### Value

`Value_score` is the mean of the available sector-neutral z-scores for:

- `EarningsYield = net_income / market_cap`
- `BookYield = book_equity / market_cap`
- `SalesYield = revenue / market_cap`
- `FCFYield = fcf / enterprise_value`
- `EBITDAYield = ebitda / enterprise_value`

Where:

- `enterprise_value = market_cap + total_debt - cash`
- higher yield = cheaper = better

#### Quality

`Quality_score` is the mean of the available sector-neutral z-scores for:

- `GrossProfitability = gross_profit / total_assets`
- `ROA = net_income / total_assets`
- `ROE`
- `CashFlowMargin = operating_cash_flow / revenue`
- `Accruals = -(net_income - operating_cash_flow) / total_assets`
- `Leverage = -total_debt / total_assets`
- `InterestCoverage = ebitda / interest_expense`
- `NetDebtToEBITDA = -(total_debt - cash) / ebitda`

Stability-style quality factors that require deeper quarterly history are explicitly out of scope for the free-tier build.

#### Momentum

`Momentum_score` is the sector-neutral z-score of:

- `Mom_12_1 = (price[t-21] / price[t-252]) - 1`

This is a 12-month return with the most recent month skipped to avoid short-term reversal noise. It uses existing `price_bars` data only.

#### Low Vol

`LowVol_score` is the mean of:

- `-z(RealizedVol_252)`
- `-z(Beta_60m)`

Where:

- `RealizedVol_252` = annualized standard deviation of daily log returns over the last 252 bars
- `Beta_60m = cov(stock_monthly_ret, SPY_monthly_ret) / var(SPY_monthly_ret)` over the last 60 monthly observations
- lower realized volatility and lower beta are better, so signs are flipped before z-scoring

Idiosyncratic volatility requiring Fama-French factor data is out of scope.

#### Growth

`Growth_score` is the mean of the available sector-neutral z-scores for:

- `SalesGrowth_3y = (revenue[t] / revenue[t-3y])^(1/3) - 1`
- `EPSGrowth_3y = (eps[t] / eps[t-3y])^(1/3) - 1`
- `FCFGrowth_3y = (fcf[t] / fcf[t-3y])^(1/3) - 1`

Rules:

- use annual history with at least four observations (`t`, `t-1`, `t-2`, `t-3`)
- only compute CAGR-style growth metrics when current and past values are both positive
- forward EPS growth and analyst revision factors are out of scope for the free-tier build

---

### 9.5 Entry Timing Model

`entry_signals` stores timing output for the ranked shortlist only, defaulting to `rank <= strategy.max_positions`.

Gate model:

- **Gate 0: Market regime** — SPY above SMA200 and SMA50 above SMA200
- **Gate 1: Trend** — close > SMA200, SMA50 > SMA200, SMA200 slope positive, ADX > 20
- **Gate 2: Setup** — pullback, breakout, or squeeze
- **Gate 3: Confirmation** — RSI below 70, MACD histogram rising, volume confirmation, OBV rising, relative strength vs SPY
- **Gate 4: Risk levels** — ATR-based entry, stop, target, and `R`
- **Gate 5: Position sizing** — shares and dollar risk from strategy sizing rules

Timing implementation requirements:

- `actionable = true` only when all gates pass
- market regime is global because it depends on `SPY`
- timing rows are generated only for the ranked shortlist, not for the entire screened universe
- setup labels must be one of `pullback`, `breakout`, `squeeze`, or `null`

Indicator requirements:

- reuse existing `rsi_14`, `macd_hist`, `sma_50`, `sma_200`, `atr_14`
- add `adx_14`
- add `obv`
- add `vol_ratio = volume / SMA50(volume)`

---

### 9.6 Backend Data Contracts

The enhancement introduces or extends these tables:

- `universes`: add `active`, `screened_at`
- `fundamentals`: add `fcf`, `operating_cash_flow`, `gross_profit`, `total_assets`, `total_debt`, `book_equity`, `cash`, `ebitda`, `market_cap`, `interest_expense`
- `indicator_values`: add `adx_14`, `obv`, `vol_ratio`
- `factor_scores`: sector-neutral factor output and ranking
- `entry_signals`: shortlist timing output

`factor_scores` requirements:

- one row per `symbol`, `strategy_id`, `scored_at`
- raw z-score columns: `value_z`, `quality_z`, `momentum_z`, `low_vol_z`, `growth_z`
- previous-run columns for delta display: `value_prev`, `quality_prev`, `momentum_prev`, `low_vol_prev`, `growth_prev`
- ranking columns: `composite_z`, `rank`, `is_new`
- funnel/audit columns: `hard_filter_pass`, `sector`

`entry_signals` requirements:

- one row per `symbol`, `strategy_id`, `evaluated_at`
- gate columns: `gate_market`, `gate_trend`, `setup_type`, `gate_confirmed`
- risk columns: `entry_price`, `stop_price`, `target_price`, `atr`, `r_multiple`
- sizing columns: `shares`, `dollar_risk`
- final state: `actionable`

Nightly ingest expectations:

- include `SPY` in `price_bars`
- keep the active universe capped by config
- refresh only a budgeted subset of the stalest or missing fundamentals per run
- persist trailing annual fundamentals history so daily scoring is DB-backed, not live-FMP-backed

Daily scoring expectations:

- preserve existing F/T/S scoring and `signal_events`
- compute factor ranks from DB-resident fundamentals and price history
- evaluate entry timing only for the ranked shortlist
- use `factor_scores` as the canonical output for the multi-factor layer

---

### 9.7 Frontend Requirements

| Component | File | Notes |
|-----------|------|-------|
| `StrategySummary` | `components/strategy/StrategySummary.tsx` | Strategy selector, funnel, universe rules, hard filters, factor weights, risk level, goal metadata |
| `StocksToTrade` | `components/strategy/StocksToTrade.tsx` | Ranked factor table with symbol, sector, five factor z-scores, previous-run deltas, composite rank, and `NEW` chip |
| `WhenToTrade` | `components/strategy/WhenToTrade.tsx` | Ranked-shortlist timing table with gate pills, setup label, entry/stop/target, `R`, shares, and dollar risk |
| `TradePipeline` | `components/strategy/TradePipeline.tsx` | Existing pipeline view; preserve lifecycle presentation while scoping hybrid rows by selected strategy where possible |
| `TradeCard` | `components/strategy/TradeCard.tsx` | Shared Waiting / In Market / Closed card presentation |
| `StrategyDropdown` | `components/strategy/StrategyDropdown.tsx` | Client-side selector used by Strategy Summary |

Frontend behavior requirements:

- Block 1 shows the live funnel: `screened → hard-filtered → scored → in portfolio`
- Block 2 only shows names with `hard_filter_pass = true`
- Block 2 sorts by `composite_z` descending and displays a rank badge plus `NEW` chip when `is_new = true`
- Block 2 shows factor deltas from the previous run using the `*_prev` columns
- Block 3 only shows names where `rank <= N`, where `N` defaults to `strategy.max_positions`
- Block 3 highlights `actionable = true`; other rows remain visible as waiting-for-setup candidates
- Block 4 keeps the existing Trade Pipeline experience

---

### 9.8 API Data Assessment

| Factor / Input | Source | Requirement Status |
|----------------|--------|--------------------|
| `EarningsYield` | FMP income statement + profile market cap | required |
| `BookYield` | FMP balance sheet + profile market cap | required |
| `SalesYield` | FMP income statement + profile market cap | required |
| `FCFYield` | FMP cash-flow statement | required |
| `EBITDAYield` | FMP income statement | required |
| `ROE` | FMP key metrics | required |
| `ROA` | FMP balance sheet | required |
| `GrossProfitability` | FMP income statement | required |
| `CashFlowMargin` | FMP cash-flow statement | required |
| `Leverage` | FMP balance sheet | required |
| `Momentum 12m-1m` | Alpaca `price_bars` | required |
| `RealizedVol_252` | Alpaca `price_bars` | required |
| `Beta_60m vs SPY` | Alpaca `price_bars` + `SPY` benchmark bars | required |
| `Revenue growth 3y` | annual income history | required |
| `EPS growth 3y` | annual income history | required |
| `FCF growth 3y` | annual fundamentals / cash-flow history | required |
| `Forward EPS growth` | analyst consensus | out of scope |
| `EPS revisions` | analyst consensus history | out of scope |
| `IdioVol (FF3)` | Fama-French factor data | out of scope |
| `Earnings stability` | deep quarterly EPS history | out of scope |
| `ADX`, `OBV`, `vol_ratio` | computed from Alpaca `price_bars` | required |

---

### 9.9 Acceptance Criteria

1. `uv run python -m artisan.jobs.nightly_ingest` populates the extended fundamentals fields (`fcf`, `total_assets`, `book_equity`, `cash`, `ebitda`, and related fields) and ingests `SPY` bars.
2. `uv run python -m artisan.jobs.daily_score_signal` produces `factor_scores` rows with non-null factor z-scores for qualifying names.
3. `entry_signals` contains timing rows only for the ranked shortlist, and `gate_market` is consistent across names because it derives from the same `SPY` regime check.
4. `/strategy` renders all four blocks and the strategy selector.
5. Stocks to Trade is sorted by `composite_z`, shows rank and delta information, and marks new ranked names with `NEW`.
6. When to Trade shows gate pills, setup labels, risk levels, and actionable highlighting for shortlist names only.
7. Trade Pipeline remains intact alongside the new multi-factor blocks.

---

## 10. Open Questions

### Answered
- ~~Market data tier?~~ → IEX free tier on Alpaca for Phase 0; Polygon Starter ($29/mo) when needed
- ~~Engine hosting region?~~ → fly.io iad (US East, closest to Alpaca paper API)
- ~~Crypto symbols?~~ → Deferred to Phase 1; Phase 0 is US equities only
- ~~Multi-user support?~~ → Single-user POC for Phase 0 (fixed admin UUID, no Auth)
- ~~Engine polling interval?~~ → Python engine runs on GH Actions cron (not real-time polling); TS engine keeps 60s polling

### Remaining
- [ ] FMP free tier (250 calls/day) — enough for the 40-name screened universe with budgeted refreshes? Monitor and plan Starter upgrade path
- [ ] Earnings blackout window: ±3 days sufficient, or should it be ±1 day pre-earnings?
- [ ] LLM budget cap per day (current plan: soft cap via `llm_analyses` aggregate query)
- [ ] When to enable auto-approve toggle (spec says after ≥3 months, ≥30 paper trades)
- [ ] Partition management: who creates next-month `price_bars` partitions? (pg_cron job in Phase 1)
