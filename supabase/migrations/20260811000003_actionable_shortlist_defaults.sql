UPDATE public.strategies
SET screening_params = jsonb_set(
  COALESCE(screening_params, '{}'::jsonb),
  '{shortlist_size}',
  '50'::jsonb,
  true
)
WHERE screening_params IS NULL
   OR (screening_params ->> 'shortlist_size') IS DISTINCT FROM '50';
