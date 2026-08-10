# v2-16 — /queue Page

**Depends on:** v2-01, v2-11, v2-12, v2-15
**Touches:** `app/src/app/trades/queue/page.tsx` (existing — rewritten), `app/src/components/queue/RecommendationCard.tsx` (new), `app/src/components/queue/PositionActionCard.tsx` (new), `app/src/app/api/queue/[id]/approve/route.ts` (existing — rewritten), `app/src/app/api/queue/[id]/reject/route.ts` (existing — rewritten)

## Context

`/trades/queue` already exists as the approval-queue page, backed by `components/trades/ApprovalQueue.tsx`/`SignalApprovalCard.tsx` (both deleted in Legacy Cleanup) and the existing `api/queue/[id]/approve|reject` routes. This task replaces its contents with the v2 edit-before-execute flow spanning two distinct queues: new entry recommendations and position management actions.

## Scope

### Page: two sections

1. **New Recommendations** — query `recommendations` where `status='pending'` AND `run_id` = the latest `pipeline_runs.id`.
2. **Position Actions** — query `position_reviews` where `status='pending'` AND `run_id` = the latest. (Recall from v2-12: CLOSE/TRIM/TIGHTEN_STOP apply automatically in code and never reach `status='pending'` — only ADD and stop-loosening actions land here awaiting approval.)

### `components/queue/RecommendationCard.tsx`

- Symbol, `action` (ENTER badge), `conviction`, `thesis` text.
- Computed fields already on the row: `entry_price`, `stop_price`, `target_price`, `atr_at_signal`, `effective_horizon_days`. Compute `shares`/`dollar_risk` client-side by calling a small `/api/queue/[id]/preview-size` helper (or precompute server-side when the page loads) using the same formula as `compute_position_size()` (v2-07) so the displayed numbers match what `execute-trade` will actually validate.
- `historical_precedent` — collapsible section, collapsed by default.
- Three actions: **Approve** (POST `/api/queue/[id]/approve` with no `overrides`), **Edit & Approve** (inline inputs for `shares`/`stop_price`/`target_price`, then POST with `overrides`), **Reject** (POST `/api/queue/[id]/reject`).

### `components/queue/PositionActionCard.tsx`

- Symbol, `recommended_action` (ADD or a stop-loosening case — CLOSE/TRIM/TIGHTEN_STOP never appear here per v2-12), `reasoning`, original thesis (join back to the position's linked `recommendations` row via `portfolio_positions.signal_id`), `historical_precedent` collapsible.
- Approve/Reject buttons — Approve on an ADD re-validates against `execute-trade`'s override path (v2-15); Approve on a stop change directly updates `portfolio_positions`.

### API routes

- `app/src/app/api/queue/[id]/approve/route.ts` — for a `recommendations` row: creates a `trade_intents` row and calls the `execute-trade` edge function (v2-15), passing through any `overrides` from the request body. For a `position_reviews` row: applies the action directly or re-validates via the same sizing/veto checks. On success, sets `status='approved'` and `reviewed_at`/`reviewed_by`.
- `app/src/app/api/queue/[id]/reject/route.ts` — sets `status='rejected'`, `reviewed_at`, optional `review_note` from the request body.

## Verification
1. `cd app && bun run build` passes.
2. With a real pending `recommendations` row (from a v2-11 run), load `/trades/queue`, confirm the card renders all fields correctly including `historical_precedent`.
3. Test Approve → confirm a `trade_executions` row and `portfolio_positions` upsert appear, and the card disappears from the pending list.
4. Test Edit & Approve with an over-limit override → confirm the UI surfaces the rejection error from `execute-trade` rather than silently failing.
5. Test Reject → confirm `status` flips and the row disappears.
