-- Phase 0 hybrid engine schema.
-- Creates Python-engine tables alongside the existing legacy TS-engine tables.

create table public.users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null default 'admin' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

insert into public.users (id, email)
values ('00000000-0000-0000-0000-000000000001', 'admin@artisan.local')
on conflict (id) do nothing;

create table public.accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id),
  broker     text not null default 'alpaca',
  paper      boolean not null default true,
  equity     numeric(18, 2),
  cash       numeric(18, 2),
  updated_at timestamptz not null default now()
);

insert into public.accounts (id, user_id, broker, paper)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'alpaca',
  true
)
on conflict (id) do nothing;

create table public.strategies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  horizon       text not null check (horizon in ('long', 'swing', 'intraday')),
  f_weight      numeric(4, 3) not null default 0.50,
  t_weight      numeric(4, 3) not null default 0.25,
  s_weight      numeric(4, 3) not null default 0.25,
  threshold     numeric(4, 3) not null default 0.55,
  max_positions int not null default 10,
  position_frac numeric(4, 3) not null default 0.05,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.strategies (
  id,
  name,
  horizon,
  f_weight,
  t_weight,
  s_weight,
  threshold,
  max_positions,
  position_frac
)
values (
  '00000000-0000-0000-0000-000000000010',
  'long_term_v0',
  'long',
  0.50,
  0.25,
  0.25,
  0.55,
  10,
  0.05
)
on conflict (name) do nothing;

create table public.universes (
  id          uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies(id),
  symbol      text not null,
  added_at    timestamptz not null default now(),
  unique (strategy_id, symbol)
);

insert into public.universes (strategy_id, symbol)
values
  ('00000000-0000-0000-0000-000000000010', 'AAPL'),
  ('00000000-0000-0000-0000-000000000010', 'MSFT'),
  ('00000000-0000-0000-0000-000000000010', 'GOOGL'),
  ('00000000-0000-0000-0000-000000000010', 'AMZN'),
  ('00000000-0000-0000-0000-000000000010', 'META'),
  ('00000000-0000-0000-0000-000000000010', 'NVDA'),
  ('00000000-0000-0000-0000-000000000010', 'JPM'),
  ('00000000-0000-0000-0000-000000000010', 'UNH'),
  ('00000000-0000-0000-0000-000000000010', 'V'),
  ('00000000-0000-0000-0000-000000000010', 'XOM')
on conflict (strategy_id, symbol) do nothing;

create table public.assets (
  symbol      text primary key,
  name        text,
  exchange    text,
  asset_class text not null default 'equity'
                check (asset_class in ('equity', 'etf', 'crypto')),
  sector      text,
  industry    text,
  updated_at  timestamptz not null default now()
);

create table public.price_bars (
  symbol   text not null,
  bar_time timestamptz not null,
  open     numeric(18, 4) not null,
  high     numeric(18, 4) not null,
  low      numeric(18, 4) not null,
  close    numeric(18, 4) not null,
  volume   bigint not null,
  vwap     numeric(18, 4),
  source   text not null default 'alpaca',
  primary key (symbol, bar_time)
) partition by range (bar_time);

create table public.price_bars_2026_q1 partition of public.price_bars
  for values from ('2026-01-01') to ('2026-04-01');
create table public.price_bars_2026_q2 partition of public.price_bars
  for values from ('2026-04-01') to ('2026-07-01');
create table public.price_bars_2026_q3 partition of public.price_bars
  for values from ('2026-07-01') to ('2026-10-01');
create table public.price_bars_2026_q4 partition of public.price_bars
  for values from ('2026-10-01') to ('2027-01-01');

create index price_bars_symbol_bar_time_idx on public.price_bars (symbol, bar_time desc);

create table public.fundamentals (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null references public.assets(symbol),
  period_end    date not null,
  period_type   text not null default 'annual'
                  check (period_type in ('annual', 'quarter')),
  pe_ratio      numeric(10, 4),
  pb_ratio      numeric(10, 4),
  roe           numeric(10, 4),
  debt_equity   numeric(10, 4),
  revenue       numeric(20, 2),
  net_income    numeric(20, 2),
  eps           numeric(10, 4),
  earnings_date date,
  source        text not null default 'fmp',
  fetched_at    timestamptz not null default now(),
  unique (symbol, period_end, period_type)
);

create index fundamentals_symbol_period_end_idx on public.fundamentals (symbol, period_end desc);

create table public.news_articles (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  headline       text not null,
  summary        text,
  source         text,
  url            text,
  published_at   timestamptz not null,
  vader_compound numeric(6, 4),
  fetched_at     timestamptz not null default now(),
  unique (symbol, url)
);

create index news_articles_symbol_published_at_idx on public.news_articles (symbol, published_at desc);

create table public.social_signals (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null references public.assets(symbol),
  platform    text not null default 'placeholder',
  score       numeric(6, 4),
  mentions    int,
  captured_at timestamptz not null default now()
);

create table public.indicator_values (
  id          uuid primary key default gen_random_uuid(),
  symbol      text not null,
  computed_at timestamptz not null default now(),
  rsi_14      numeric(8, 4),
  macd_line   numeric(12, 6),
  macd_signal numeric(12, 6),
  macd_hist   numeric(12, 6),
  bb_upper    numeric(12, 4),
  bb_mid      numeric(12, 4),
  bb_lower    numeric(12, 4),
  atr_14      numeric(12, 4),
  sma_50      numeric(12, 4),
  sma_200     numeric(12, 4),
  unique (symbol, computed_at)
);

create index indicator_values_symbol_computed_at_idx on public.indicator_values (symbol, computed_at desc);

create table public.composite_scores (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null,
  strategy_id    uuid not null references public.strategies(id),
  scored_at      timestamptz not null default now(),
  f_score        numeric(6, 4) not null,
  t_score        numeric(6, 4) not null,
  s_score        numeric(6, 4) not null,
  composite      numeric(6, 4) not null,
  pillars_passed int not null,
  unique (symbol, strategy_id, scored_at)
);

create index composite_scores_strategy_scored_at_composite_idx
  on public.composite_scores (strategy_id, scored_at desc, composite desc);

create table public.signal_events (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  strategy_id       uuid not null references public.strategies(id),
  score_id          uuid references public.composite_scores(id),
  direction         text not null check (direction in ('long', 'flat')),
  composite_score   numeric(6, 4) not null,
  f_score           numeric(6, 4) not null,
  t_score           numeric(6, 4) not null,
  s_score           numeric(6, 4) not null,
  pillars_passed    int not null,
  earnings_blackout boolean not null default false,
  stop_price        numeric(12, 4),
  target_price      numeric(12, 4),
  atr_at_signal     numeric(12, 4),
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'executed', 'expired')),
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.users(id),
  review_note       text
);

create index signal_events_status_created_at_idx on public.signal_events (status, created_at desc);
create index signal_events_strategy_created_at_idx on public.signal_events (strategy_id, created_at desc);

create table public.trade_intents (
  id           uuid primary key default gen_random_uuid(),
  signal_id    uuid not null references public.signal_events(id),
  account_id   uuid not null references public.accounts(id),
  symbol       text not null,
  side         text not null check (side in ('buy', 'sell')),
  quantity     numeric(18, 6) not null,
  dollar_value numeric(18, 2) not null,
  order_type   text not null default 'market' check (order_type in ('market', 'limit')),
  limit_price  numeric(12, 4),
  stop_price   numeric(12, 4),
  status       text not null default 'pending'
                 check (status in ('pending', 'submitted', 'filled', 'cancelled', 'rejected')),
  created_at   timestamptz not null default now()
);

create index trade_intents_status_created_at_idx on public.trade_intents (status, created_at desc);

create table public.trade_executions (
  id              uuid primary key default gen_random_uuid(),
  intent_id       uuid not null references public.trade_intents(id),
  broker_order_id text,
  filled_qty      numeric(18, 6),
  filled_price    numeric(12, 4),
  filled_at       timestamptz,
  fees            numeric(10, 4) default 0,
  status          text not null default 'pending'
                    check (status in ('pending', 'filled', 'partial', 'cancelled', 'rejected')),
  raw_response    jsonb,
  created_at      timestamptz not null default now()
);

create index trade_executions_intent_id_idx on public.trade_executions (intent_id);
create unique index trade_executions_broker_order_id_idx
  on public.trade_executions (broker_order_id)
  where broker_order_id is not null;

create table public.portfolio_positions (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id),
  symbol           text not null,
  quantity         numeric(18, 6) not null,
  avg_entry_price  numeric(12, 4) not null,
  current_price    numeric(12, 4),
  unrealized_pnl   numeric(18, 2),
  stop_price       numeric(12, 4),
  target_price     numeric(12, 4),
  signal_id        uuid references public.signal_events(id),
  opened_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, symbol)
);

create table public.llm_analyses (
  id                uuid primary key default gen_random_uuid(),
  analysis_type     text not null check (analysis_type in ('thesis', 'briefing')),
  symbol            text,
  signal_id         uuid references public.signal_events(id),
  model             text not null default 'claude-haiku-4-5-20251001',
  prompt_tokens     int,
  output_tokens     int,
  cache_read_tokens int,
  cost_usd          numeric(10, 6),
  content           text not null,
  created_at        timestamptz not null default now()
);

create index llm_analyses_type_created_at_idx on public.llm_analyses (analysis_type, created_at desc);
create index llm_analyses_signal_id_idx on public.llm_analyses (signal_id);

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  action     text not null,
  entity     text,
  entity_id  uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_at_idx on public.audit_log (created_at desc);
create index audit_log_entity_entity_id_idx on public.audit_log (entity, entity_id);

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.strategies enable row level security;
alter table public.universes enable row level security;
alter table public.assets enable row level security;
alter table public.price_bars enable row level security;
alter table public.fundamentals enable row level security;
alter table public.news_articles enable row level security;
alter table public.social_signals enable row level security;
alter table public.indicator_values enable row level security;
alter table public.composite_scores enable row level security;
alter table public.signal_events enable row level security;
alter table public.trade_intents enable row level security;
alter table public.trade_executions enable row level security;
alter table public.portfolio_positions enable row level security;
alter table public.llm_analyses enable row level security;
alter table public.audit_log enable row level security;

create policy "anon read signal_events"
  on public.signal_events
  for select
  to anon
  using (true);

create policy "anon read composite_scores"
  on public.composite_scores
  for select
  to anon
  using (true);

create policy "anon read llm_analyses"
  on public.llm_analyses
  for select
  to anon
  using (true);

create policy "anon read trade_intents"
  on public.trade_intents
  for select
  to anon
  using (true);

create policy "anon read trade_executions"
  on public.trade_executions
  for select
  to anon
  using (true);

create policy "anon read portfolio_positions"
  on public.portfolio_positions
  for select
  to anon
  using (true);

create policy "anon read strategies"
  on public.strategies
  for select
  to anon
  using (true);
