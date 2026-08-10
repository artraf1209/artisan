-- The supabase_realtime publication has been empty since the v2 migration
-- dropped signals/trades/positions/logs (Postgres auto-drops tables from a
-- publication when they're dropped). Re-populate it with the v2 tables the
-- new frontend needs live updates for.
alter publication supabase_realtime add table public.recommendations;
alter publication supabase_realtime add table public.position_reviews;
alter publication supabase_realtime add table public.trade_executions;
alter publication supabase_realtime add table public.portfolio_positions;
