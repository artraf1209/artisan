# v2-15 — execute-trade Edge Function Rewrite

**Depends on:** v2-01, v2-07 (sizing re-validation formulas), v2-11 (needs `recommendations` table)
**Touches:** `supabase/functions/execute-trade/index.ts` (existing — rewritten in place)

## Context

`execute-trade` is the only server-side code allowed to call the Alpaca API (per CLAUDE.md — this rebuild also removes the one Python module, `engine-py/artisan/execution/alpaca_executor.py`, that currently violates this rule). Today it writes to the legacy `trades`/`signals` tables and optionally touches `trade_intents`. This task rewrites it to work entirely against the v2 table set (`trade_intents`, `trade_executions`, `portfolio_positions`, `recommendations`, `decision_outcomes`) and adds the edit-before-execute override flow described in spec §16.1.

## Scope

Rewrite `supabase/functions/execute-trade/index.ts`.

### Contract

```typescript
POST /functions/v1/execute-trade
{
  trade_intent_id: string,
  overrides?: { shares?: number, stop_price?: number, target_price?: number }
}
```

### Steps

1. Fetch the `trade_intents` row by `trade_intent_id`, and the linked `recommendations` row (via `trade_intents.signal_id`, which now points at `recommendations` post v2-01).
2. Fetch current `strategy_params` from `strategies` (read the same 5 jsonb columns v2-02 seeded).
3. If `overrides` is present: re-validate the requested `shares`/`stop_price`/`target_price` against the sizing formula from v2-07's `compute_position_size()` (re-implemented in TypeScript here, or ported logic — Deno edge functions can't import the Python module directly) and the portfolio veto checks from `check_portfolio_vetos()`. Reject with a clear error message (`{success: false, error: "..."}`) if any limit is breached — do not silently clamp values. On success, store the overrides in `trade_intents.overrides` (jsonb column added in v2-01).
4. Fetch current Alpaca account equity (`GET /v2/account`) to confirm buying power covers the order.
5. Place a market order via the Alpaca paper API (existing order-placement code, reused, but now targeting `trade_intents`/`trade_executions` instead of the legacy `trades` table).
6. On fill: write a `trade_executions` row (`intent_id`, `broker_order_id`, `filled_qty`, `filled_price`, `filled_at`, `status`), and `UPSERT` `portfolio_positions` (existing table, unique on `(account_id, symbol)`).
7. Flip the matching `decision_outcomes` row (linked via `source_id = recommendation.id`) from `mode='shadow'` to `mode='real'`, and update `entry_price_reference` to the actual fill price (which may differ slightly from the recommended `entry_price` due to market movement).
8. Return `{success: true, trade_execution_id, fill_price, ...}` or a structured failure classification (reuse the existing `market_closed`/`insufficient_balance`/`other` classification already implemented).
9. Update `trade_intents.status` to `'filled'` (or `'submitted'` if not yet filled, matching the existing status lifecycle already supported by the `20260505000000_add_scheduled_status.sql` check constraint).

## Verification
1. Deploy to a Supabase preview/staging environment (`supabase functions deploy execute-trade` or local `supabase functions serve`), call it against a `trade_intents` row created by approving a recommendation via the not-yet-built `/queue` page (v2-16) — for now, insert a test `trade_intents` row directly and call the function manually with `curl`.
2. Test the override path: submit `overrides.shares` above what `compute_position_size()` allows, confirm the function rejects with a clear error and does *not* place an order.
3. Test the happy path: submit without overrides, confirm `trade_executions` and `portfolio_positions` are written correctly and the linked `decision_outcomes` row flips to `mode='real'` with the actual fill price.
