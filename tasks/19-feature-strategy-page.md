# Task 19 — Strategy Overview Page

**Status:** ⬜ pending  
**Depends on:** 01 (migration — goal columns in strategies), 11 (signal_events exist), 15 (portfolio_positions populated)  
**Can start partially:** yes — GoalPanel and TradePipeline "In Market"/"Closed" columns work with legacy tables before migration is applied  
**Estimated effort:** 4–6 hours  

---

## Goal
Build the `/strategy` page: a single-page control room showing what the strategy is trying to achieve (GoalPanel), which stocks are tracked and why (UniverseThesis), and the full trade lifecycle from signal to close (TradePipeline).

Full feature spec is in [specs.md §9](../specs.md#9-strategy-overview-page--feature-spec).

---

## Schema changes (add to Task 01 migration)

Add four columns to the `strategies` table:

```sql
alter table public.strategies
  add column if not exists goal_growth_pct  numeric(6,2)  not null default 25.0,
  add column if not exists goal_months      int           not null default 12,
  add column if not exists risk_level       text          not null default 'moderate'
    check (risk_level in ('conservative','moderate','aggressive')),
  add column if not exists start_equity     numeric(18,2);

update public.strategies
set goal_growth_pct = 25.0, goal_months = 12, risk_level = 'moderate'
where name = 'long_term_v0';
```

If the migration has already been applied, run this as a separate migration:
`supabase/migrations/20260504000000_strategies_goal_fields.sql`

---

## Types to update

In `app/src/types/index.ts`, add to `strategies.Row`:
```typescript
goal_growth_pct: number | null
goal_months: number | null
risk_level: 'conservative' | 'moderate' | 'aggressive' | null
start_equity: number | null
```

Add new table types (if not already present):
- `universes` — `{ id, strategy_id, symbol, added_at }`
- `indicator_values` — `{ id, symbol, computed_at, rsi_14, macd_line, macd_signal, macd_hist, bb_upper, bb_mid, bb_lower, atr_14, sma_50, sma_200 }`

---

## Files to create

```
app/src/
├── app/
│   ├── strategy/
│   │   └── page.tsx                          Server Component, fetches both API routes
│   └── api/
│       └── strategy/
│           ├── overview/route.ts             GET: strategy goal + universe + scores + trends
│           └── trades/route.ts               GET: { waiting, in_market, closed }
└── components/
    └── strategy/
        ├── GoalPanel.tsx                     Progress bar, equity, risk badge
        ├── UniverseThesis.tsx                Responsive table with score bars + trend
        ├── TradePipeline.tsx                 Three-column kanban container
        └── TradeCard.tsx                     Shared card for all three columns
```

---

## Files to modify

- `app/src/components/shared/Navbar.tsx` — add `{ href: '/strategy', label: 'Strategy', icon: Target }`
- `app/src/types/index.ts` — add goal fields + new table types

---

## API route: `/api/strategy/overview`

```typescript
// Fetch in parallel:
const [strategy, account, universeRows, allScores, allIndicators] = await Promise.all([
  supabase.from('strategies').select('*').eq('active', true).single(),
  supabase.from('accounts').select('equity, cash').eq('paper', true).single(),
  supabase.from('universes').select('symbol, added_at').eq('strategy_id', STRATEGY_ID),
  supabase.from('composite_scores')
    .select('symbol, f_score, t_score, s_score, composite, pillars_passed, scored_at')
    .eq('strategy_id', STRATEGY_ID)
    .order('scored_at', { ascending: false })
    .limit(200),          // dedupe by symbol in JS
  supabase.from('indicator_values')
    .select('symbol, rsi_14, macd_line, macd_hist, atr_14, sma_50, sma_200, computed_at')
    .in('symbol', symbols)
    .order('computed_at', { ascending: false })
    .limit(100),
])

// For price trend since added: get two price bars per symbol
// (first bar at or after added_at, and latest bar)
// Fetch from price_bars: latest per symbol + earliest per symbol in universe window
```

**Error handling:** If `strategies` returns no data (pre-migration), return a default shape with fallback values so the page renders without crashing.

**Price trend logic (JS side):**
```typescript
// Dedupe scores and indicators by taking the first (most recent) per symbol
const latestScores = dedupeBySymbol(allScores.data ?? [])
const latestIndicators = dedupeBySymbol(allIndicators.data ?? [])

// Compute trend: fetch price_bars for each symbol
// For simplicity in Phase 0: compare latest close to close 30 days ago
// (exact "since added" requires per-symbol date filter — do in Phase 1)
```

---

## API route: `/api/strategy/trades`

```typescript
// Prefer hybrid tables; fall back to legacy when empty
const [signalsPending, portfolioPositions, executions, legacyPositions, legacyTrades] =
  await Promise.all([
    // Waiting
    supabase.from('signal_events')
      .select('*, trade_intents(id, status)')
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false }),

    // In Market (hybrid)
    supabase.from('portfolio_positions')
      .select('*')
      .order('opened_at', { ascending: false }),

    // Closed (hybrid) — join through intent to get entry price
    supabase.from('trade_executions')
      .select('*, trade_intents(symbol, side, quantity, dollar_value, stop_price)')
      .eq('status', 'filled')
      .order('filled_at', { ascending: false })
      .limit(50),

    // Fallback: legacy positions
    supabase.from('positions').select('*').order('updated_at', { ascending: false }),

    // Fallback: legacy trades
    supabase.from('trades').select('*').eq('status', 'filled')
      .order('filled_at', { ascending: false }).limit(50),
  ])

const inMarket = (portfolioPositions.data?.length ?? 0) > 0
  ? portfolioPositions.data
  : legacyPositions.data?.map(adaptLegacyPosition)

const closed = (executions.data?.length ?? 0) > 0
  ? executions.data?.map(adaptExecution)
  : legacyTrades.data?.map(adaptLegacyTrade)
```

---

## Component specs

### `GoalPanel.tsx`
- Inputs: `strategy`, `equity: number | null`
- Renders: risk badge (colour: conservative=blue, moderate=amber, aggressive=red), target description, progress bar, equity numbers
- Progress bar: use a simple `div` with `width: X%` on a track div — no external library needed
- If `start_equity` is null: show "Baseline not set" with a note to set it in settings

### `UniverseThesis.tsx`
- Inputs: `rows: UniverseRow[]` where each has `symbol, sector, added_at, score, indicators, trend_pct`
- Score bars: inline `div` with coloured background and width proportional to score value
- Score colour: `score >= 0.65 → text-profit`, `score >= 0.45 → text-yellow-400`, `score < 0.45 → text-loss`
- Key indicator column: format the most significant indicator from `indicator_values`:
  ```typescript
  function topIndicator(iv: IndicatorValues): string {
    const parts = []
    if (iv.rsi_14 != null) parts.push(`RSI ${iv.rsi_14.toFixed(0)}`)
    if (iv.macd_hist != null) parts.push(iv.macd_hist > 0 ? 'MACD ↑' : 'MACD ↓')
    return parts.slice(0, 2).join(' · ') || '—'
  }
  ```
- Empty state: if no rows, show "Run first ingestion to populate" notice

### `TradePipeline.tsx`
- Three-column `grid grid-cols-1 sm:grid-cols-3 gap-4` layout
- Each column: header (label + count badge) + scrollable list of `TradeCard` components
- Empty column: show "No [waiting/open/closed] trades" placeholder

### `TradeCard.tsx`
- Shared card for all three columns; varies by `kind: 'waiting' | 'in_market' | 'closed'`
- Always shows: symbol (bold), direction/side badge
- Waiting: entry_price (stop_price), target_price, stop_price, composite_score badge, time since signal
- In Market: avg_entry_price, current_price, unrealized_pnl (coloured `$X.XX / +2.1%`), stop_price, days held
- Closed: entry_price, exit_price (filled_price), realized_pnl `$` and `%`, filled_at date

---

## Acceptance criteria

- [ ] `/strategy` page loads without error when no hybrid data exists yet (pre-migration or pre-ingest)
- [ ] GoalPanel shows default goal (25% / 12 months / Moderate) from seeded strategy row
- [ ] UniverseThesis shows 10 hardcoded symbols with "—" scores pre-ingest; shows real scores post-ingest
- [ ] TradePipeline "In Market" column shows data from legacy `positions` table (existing open positions)
- [ ] TradePipeline "Closed" column shows data from legacy `trades` table (existing filled trades)
- [ ] TradePipeline "Waiting" column shows signal_events post-migration, empty otherwise
- [ ] Progress bar math is correct: `0%` when `start_equity` = `current_equity`, `100%` at target
- [ ] Navbar shows "Strategy" link that routes to `/strategy`
- [ ] Page is mobile-responsive (pipeline stacks vertically, thesis table scrolls horizontally)
