-- Add 'scheduled' status to trade_intents for market-closed queuing
-- This allows intents to be queued when market is closed and retried during market hours

ALTER TABLE public.trade_intents DROP CONSTRAINT IF EXISTS trade_intents_status_check;

ALTER TABLE public.trade_intents ADD CONSTRAINT trade_intents_status_check 
  CHECK (status in ('pending', 'submitted', 'filled', 'cancelled', 'rejected', 'scheduled'));