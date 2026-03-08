-- Run this in Supabase SQL Editor to set up all tables

-- User billing settings (credit card + daily budget)
create table if not exists user_billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_budget_usd numeric(10,4) not null default 10,
  card_last4 text,
  card_brand text,
  card_exp text,
  card_encrypted text,  -- AES-256-GCM encrypted card data
  updated_at timestamptz default now()
);

alter table user_billing enable row level security;

create policy "Users manage own billing"
  on user_billing for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- AI API transaction log
create table if not exists api_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  model text not null default 'claude-opus-4-6',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12,8) not null default 0,
  agent_name text,
  reason text
);

alter table api_transactions enable row level security;

create policy "Users read own transactions"
  on api_transactions for select
  using (auth.uid() = user_id);

-- Service role bypass (for server-side inserts via service key)
-- The service client bypasses RLS automatically

-- User API keys (for storing Anthropic, GitHub, etc. keys)
create table if not exists user_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,     -- 'anthropic', 'github', 'aws', etc.
  key_encrypted text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, service)
);

alter table user_api_keys enable row level security;

create policy "Users manage own api keys"
  on user_api_keys for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast transaction queries
create index if not exists api_transactions_user_created
  on api_transactions(user_id, created_at desc);
