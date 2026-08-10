# v2-18 — /account Page

**Depends on:** v2-01, v2-03 (portfolio_snapshots)
**Touches:** `app/src/app/account/page.tsx` (new), `app/src/app/api/account/alpaca/route.ts` (new)

## Context

There is no account-level overview page today — equity, drawdown, and performance stats aren't visible anywhere in the app. This is the first place `portfolio_snapshots` (new in v2-01, populated by v2-03) becomes user-visible, and the first place `decision_outcomes` win-rate stats surface for real (not shadow) trades specifically.

## Scope

### `app/src/app/api/account/alpaca/route.ts` (new)

Proxies Alpaca's `GET /v2/account` server-side (never call Alpaca from the browser — this route is the boundary), returns equity, cash, buying power, day P/L. Uses the same Alpaca credentials already configured for the engine/edge functions.

### `app/src/app/account/page.tsx`

Three sections:

1. **Account state** — live data from `/api/account/alpaca`: equity, cash, buying power, day P/L.
2. **Equity curve** — chart of `portfolio_snapshots.equity` over time (one point per day, written daily by v2-03's ingest job) plotted against SPY over the same window (rebase SPY's `price_bars.close` to the same starting equity value for visual comparability). A sub-chart or overlay for `drawdown_from_high_pct`, with the current value shown against the `max_drawdown_tolerance_pct` (18%) line as a visual limit.
3. **Performance stats** — computed from `decision_outcomes` where `mode='real'` and `resolution != 'still_open'`:
   - Win rate: `count(resolution='hit_target') / count(resolution in ('hit_target','hit_stop'))`
   - Average R-multiple
   - Average days to resolution
   - A comparison block: the same three stats computed for `mode='shadow'` rows, labeled as "decisions you didn't take" — this is meant to show the user what recommendations they rejected or let expire would have done.

## Verification
1. `cd app && bun run build` passes.
2. Load `/account` after at least a few days of `portfolio_snapshots` history (or manually insert several rows spanning a date range for testing); confirm the equity curve renders and roughly tracks manually-computed values.
3. Confirm the SPY overlay is correctly rebased (both lines start at the same y-value on the chart's first date).
4. With at least one resolved `decision_outcomes` row in each of `mode='real'` and `mode='shadow'`, confirm both performance-stat blocks compute correctly and differ from each other.
