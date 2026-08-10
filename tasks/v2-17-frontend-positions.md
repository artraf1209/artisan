# v2-17 — /positions Page

**Depends on:** v2-01, v2-07, v2-12
**Touches:** `app/src/app/positions/page.tsx` (new), `app/src/app/api/positions/route.ts` (existing — rewritten)

## Context

No dedicated `/positions` page exists today — `components/dashboard/ActivePositions.tsx` shows a compact widget on the dashboard, which is kept as-is as a summary. This task builds the full page: every open position with entry/current/target/stop context, days remaining against the effective horizon and the 30-day hard ceiling, and the latest Position Review verdict inline.

## Scope

### `app/src/app/api/positions/route.ts` (rewrite in place)

Currently reads `portfolio_positions` directly. Extend to also join, per symbol: the latest `price_bars` row (current price if not already tracked live), the linked `recommendations` row (original thesis, `effective_horizon_days`, `setup_type`), and the most recent `position_reviews` row (verdict, `reasoning`).

### `app/src/app/positions/page.tsx`

Per open position row:
- Symbol, `entry_price`, current price, `unrealized_pnl` ($ and %), `quantity`.
- R-multiple achieved so far: `(current_price - entry_price) / (entry_price - stop_price)`.
- Days held (`now - opened_at`) vs `effective_horizon_days` (from the linked recommendation) and vs the hard 30-day ceiling (`strategy_params.max_holding_period_days`) — render as a progress bar with two thresholds.
- Distance to stop / target, in both % and $.
- Latest Position Review verdict inline (HOLD / TRIM / CLOSE / ADD / TIGHTEN_STOP), with `reasoning` as a tooltip or expandable line.
- Trailing-stop indicator (small badge) if the position's `stop_price` has moved since `opened_at`, meaning the v2-07 ratchet has fired at least once — detect by comparing current `stop_price` to the entry recommendation's original `stop_price`.

Highlight (visually distinct row style) when: fewer than 5 days remain to the 30-day ceiling, or the latest Position Review verdict is CLOSE or TRIM.

## Verification
1. `cd app && bun run build` passes.
2. With a real open `portfolio_positions` row (created via v2-15/v2-16's approve flow), load `/positions`, confirm all computed fields (R-multiple, days remaining, distance to stop/target) match manual calculation.
3. Manually set a test position's `opened_at` to 27+ days ago, confirm the 30-day-ceiling highlight triggers.
4. Confirm the dashboard's existing `ActivePositions.tsx` widget still renders correctly (unaffected by this page's API route changes, since it queries the same extended `/api/positions` response — verify it doesn't break on the new joined fields).
