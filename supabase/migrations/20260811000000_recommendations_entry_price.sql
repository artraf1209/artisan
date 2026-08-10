-- Discovered while implementing v2-11 (Synthesis agent): recommendations kept
-- stop_price/target_price/atr_at_signal from the old v1 signal_events shape but
-- never had an entry_price column, and had no columns for the sized share count /
-- dollar risk Synthesis computes for ENTER recommendations. The v2 /queue page
-- (v2-16) needs all of these present on the recommendation row without an extra
-- join back to entry_signals for every render.

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS entry_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS shares int,
  ADD COLUMN IF NOT EXISTS dollar_risk numeric(12,2);
