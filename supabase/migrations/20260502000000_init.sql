-- Bootstrap migration: create all core tables
-- Order matters: signals must exist before trades (FK reference)

-- signals: AI/ML model outputs
create table public.signals (
  id            uuid primary key default gen_random_uuid(),
  model         text not null,
  symbol        text not null,
  direction     text not null check (direction in ('long','short','flat')),
  confidence    numeric(5,4) not null check (confidence between 0 and 1),
  metadata      jsonb,
  executed      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- trades: every executed order
create table public.trades (
  id              uuid primary key default gen_random_uuid(),
  symbol          text not null,
  side            text not null check (side in ('buy','sell')),
  quantity        numeric(18,8) not null,
  price           numeric(18,8) not null,
  status          text not null default 'pending'
                    check (status in ('pending','filled','cancelled','rejected')),
  broker_order_id text,
  signal_id       uuid references public.signals(id),
  paper           boolean not null default true,
  created_at      timestamptz not null default now(),
  filled_at       timestamptz
);

-- positions: current open positions (engine upserts on fill)
create table public.positions (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null unique,
  quantity          numeric(18,8) not null,
  avg_entry_price   numeric(18,8) not null,
  current_price     numeric(18,8),
  unrealized_pnl    numeric(18,8),
  paper             boolean not null default true,
  updated_at        timestamptz not null default now()
);

-- logs: structured engine/system logs
create table public.logs (
  id          uuid primary key default gen_random_uuid(),
  level       text not null check (level in ('debug','info','warn','error')),
  source      text not null,
  message     text not null,
  context     jsonb,
  created_at  timestamptz not null default now()
);

-- alerts: Telegram notification history
create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  chat_id    text not null,
  message    text not null,
  trigger    text,
  trade_id   uuid references public.trades(id),
  sent       boolean not null default false,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);

-- RLS: enable on all tables (default deny)
alter table public.signals   enable row level security;
alter table public.trades    enable row level security;
alter table public.positions enable row level security;
alter table public.logs      enable row level security;
alter table public.alerts    enable row level security;

-- Realtime: subscribe dashboard to live updates
alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.logs;
