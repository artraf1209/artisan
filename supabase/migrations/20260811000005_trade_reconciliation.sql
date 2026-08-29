-- Trade execution reconciliation: new terminal statuses, retry/claim bookkeeping,
-- nullable signal_id for engine-created sell intents, and bracket-order leg tracking.

ALTER TABLE public.trade_intents DROP CONSTRAINT IF EXISTS trade_intents_status_check;
ALTER TABLE public.trade_intents ADD CONSTRAINT trade_intents_status_check
  CHECK (status in ('pending', 'scheduled', 'submitting', 'submitted', 'partial', 'filled', 'cancelled', 'rejected', 'expired', 'failed'));

ALTER TABLE public.trade_executions DROP CONSTRAINT IF EXISTS trade_executions_status_check;
ALTER TABLE public.trade_executions ADD CONSTRAINT trade_executions_status_check
  CHECK (status in ('pending', 'filled', 'partial', 'cancelled', 'rejected', 'expired', 'failed'));

ALTER TABLE public.trade_intents ADD COLUMN retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.trade_intents ADD COLUMN last_attempted_at timestamptz;

-- Engine-created sell intents (position_review.py's auto-applied CLOSE) may have no
-- resolvable originating recommendation.
ALTER TABLE public.trade_intents ALTER COLUMN signal_id DROP NOT NULL;

CREATE INDEX trade_executions_open_status_idx ON public.trade_executions (status)
  WHERE status IN ('pending', 'partial');

-- order_class is a distinct dimension from order_type/Alpaca's `type`: order_type
-- controls how the entry leg executes (market/limit), order_class controls whether
-- take-profit/stop-loss legs are attached (simple/bracket).
ALTER TABLE public.trade_intents ADD COLUMN order_class text NOT NULL DEFAULT 'simple'
  CHECK (order_class in ('simple', 'bracket'));

-- Links an open position back to its live broker order(s) so tighten_stop/widen_target/close
-- can PATCH or cancel the correct resting order at Alpaca.
ALTER TABLE public.portfolio_positions ADD COLUMN entry_order_id text;
ALTER TABLE public.portfolio_positions ADD COLUMN stop_order_id text;
ALTER TABLE public.portfolio_positions ADD COLUMN target_order_id text;

-- Distinguishes a bracket order's entry/stop-loss/take-profit legs from each other;
-- null for today's plain, non-bracket orders.
ALTER TABLE public.trade_executions ADD COLUMN leg_type text
  CHECK (leg_type in ('entry', 'stop_loss', 'take_profit'));
