-- Records that reconciliation has successfully produced the initial Position Review.
ALTER TABLE public.portfolio_positions
  ADD COLUMN initial_reviewed_at timestamptz;

-- Repair the known historical ABNB fill that predated the reconciliation worker.
-- The identifiers and later-than-fill predicate make this migration idempotent and scoped.
UPDATE public.portfolio_positions AS position
SET opened_at = execution.filled_at
FROM public.trade_intents AS intent
JOIN public.trade_executions AS execution ON execution.intent_id = intent.id
WHERE position.account_id = intent.account_id
  AND position.symbol = intent.symbol
  AND intent.id = '21302495-824d-40f6-a61d-7f426147ae3f'
  AND execution.status = 'filled'
  AND execution.filled_at = '2026-08-10T13:34:13.679696+00:00'
  AND position.opened_at > execution.filled_at;
