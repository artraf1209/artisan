-- Backfill quarterly price_bars partitions for the extended factor-model lookback.
-- The initial Phase 0 schema only created 2026 partitions, but nightly ingest now
-- stores roughly 5 years of history for momentum and beta calculations.

DO $$
DECLARE
  current_start date := date '2021-01-01';
  current_end date;
  partition_limit date := date '2029-01-01';
  partition_name text;
BEGIN
  WHILE current_start < partition_limit LOOP
    current_end := (current_start + interval '3 months')::date;
    partition_name := format(
      'price_bars_%s_q%s',
      extract(year from current_start)::int,
      ((extract(month from current_start)::int - 1) / 3) + 1
    );

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.price_bars FOR VALUES FROM (%L) TO (%L);',
      partition_name,
      current_start,
      current_end
    );

    current_start := current_end;
  END LOOP;
END $$;
