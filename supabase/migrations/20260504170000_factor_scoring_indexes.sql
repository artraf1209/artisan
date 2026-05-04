-- Add query-path indexes for multi-factor latest-run reads.

CREATE INDEX IF NOT EXISTS factor_scores_strategy_scored_at_idx
  ON factor_scores (strategy_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS entry_signals_strategy_evaluated_at_idx
  ON entry_signals (strategy_id, evaluated_at DESC);
