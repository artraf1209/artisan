# Task 16 — Frontend: Types + Approval Queue

**Status:** ⬜ pending  
**Depends on:** 11  
**Estimated effort:** 3–5 hours  

---

## Goal
Add the hybrid-engine frontend types plus the `/trades/queue` approval workflow so pending signal events can be reviewed and approved by the admin.

---

## Files to create

```text
app/src/types/hybrid.ts
app/src/app/trades/queue/page.tsx
app/src/components/trades/ApprovalQueue.tsx
app/src/components/trades/SignalApprovalCard.tsx
app/src/app/api/queue/[id]/approve/route.ts
app/src/app/api/queue/[id]/reject/route.ts
```

---

## Implementation notes

- Add frontend-safe types for:
  - `signal_events`
  - `composite_scores`
  - `trade_intents`
  - `llm_analyses` thesis rows
- Build a queue page that lists pending signals with:
  - symbol
  - composite score
  - F/T/S breakdown
  - stop and target
  - thesis note if present
- Add approve and reject actions.
- Approval behavior:
  - set `signal_events.status='approved'`
  - set `reviewed_at`
  - set `reviewed_by=ADMIN_USER_ID`
  - create one `trade_intents` row with `status='pending'`
- Rejection behavior:
  - set `signal_events.status='rejected'`
  - save optional `review_note`
- Use server-side route handlers for writes.

---

## UX requirements

- Keep the queue readable on laptop-width screens.
- Make pending status visually obvious.
- Show empty-state messaging when there are no pending signals.

---

## Acceptance criteria

- [ ] `/trades/queue` renders pending signals from the new tables
- [ ] Approve creates a `trade_intents` row and updates signal status
- [ ] Reject updates signal status and allows a note
- [ ] New frontend types cover the hybrid tables used by the queue
