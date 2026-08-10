# v2-19 — /orders Page

**Depends on:** v2-01, v2-15
**Touches:** `app/src/app/orders/page.tsx` (new, replacing `app/src/app/trades/page.tsx`), `app/src/app/api/trades/route.ts` (existing — rewritten in place)

## Context

`app/src/app/trades/page.tsx` currently shows a table backed by `api/trades/route.ts`, which reads the legacy `trades` table — dropped in v2-01. This task replaces it with `/orders`, built around `trade_executions` joined with `trade_intents` and `recommendations`, and shows both the originally recommended sizing and any user edits made at approval time (v2-16's Edit & Approve flow).

## Scope

### `app/src/app/api/trades/route.ts` (rewrite in place — keep the route path so any existing links/bookmarks still resolve, or move it to `app/src/app/api/orders/route.ts` and update the page to match; either is fine as long as page and route agree)

Query `trade_executions` joined with `trade_intents` (for `overrides`) and `recommendations` (for the originally recommended `entry_price`/`stop_price`/`target_price`/`shares` implied by `dollar_risk`), and left-joined with `decision_outcomes` (via `recommendations.id = decision_outcomes.source_id`) for eventual resolution.

### `app/src/app/orders/page.tsx`

Table columns:
- Symbol, side, `filled_qty`, `filled_price`, `filled_at`.
- Originally recommended: implied shares/stop/target from the linked `recommendations` row.
- Edited values: if `trade_intents.overrides` is non-null, show a delta badge (e.g. "shares: 200 → 150") next to the relevant field.
- Eventual outcome: `resolution` + `r_multiple` from the linked `decision_outcomes` row once resolved; show "still open" otherwise.

Filters: date range, symbol, side (buy/sell).

## Verification
1. `cd app && bun run build` passes.
2. Delete/confirm removal of `app/src/app/trades/page.tsx` (per Legacy Cleanup) and verify no remaining internal links point at the old `/trades` route (check `Navbar.tsx`, updated in the Legacy Cleanup step).
3. With a real filled `trade_executions` row (from v2-15/v2-16), load `/orders`, confirm the recommended-vs-filled comparison renders correctly, and that an override made at approval time shows the correct delta badge.
4. Confirm a resolved `decision_outcomes` row correctly populates the outcome column, and an unresolved one shows "still open".
