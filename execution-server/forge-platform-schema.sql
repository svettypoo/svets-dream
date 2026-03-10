-- Forge Platform Schema
-- Run this in the Svet's Dream Supabase project (xocfduqugghailalzlqy)
-- This tracks tenants, their apps, billing, and usage

-- ── Tenants ────────────────────────────────────────────────────────────────────
create table if not exists forge_tenants (
  id text primary key,                          -- e.g. "tenant-1749012345"
  app_name text not null,
  slug text unique not null,                    -- subdomain: slug.svets-dream.app
  status text default 'active',                 -- active | suspended | cancelled
  plan text default 'starter',                  -- starter | pro | export
  repo_url text,                                -- private GitHub repo URL
  railway_service_id text,                      -- Railway service ID for this app
  deployed_url text,                            -- https://slug.svets-dream.app
  workspace_id text,                            -- Forge workspace that built it
  config jsonb default '{}',                    -- original build config (blocks, entities, etc.)
  owner_email text,                             -- customer email
  owner_user_id uuid references auth.users(id), -- if they have a Svet's Dream account
  stripe_customer_id text,                      -- for billing
  stripe_subscription_id text,
  next_billing_date timestamptz,
  monthly_price_cents int default 2900,         -- $29/mo default
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Usage metering ─────────────────────────────────────────────────────────────
create table if not exists forge_usage (
  id uuid primary key default gen_random_uuid(),
  tenant_id text references forge_tenants(id) on delete cascade,
  type text not null,       -- 'email' | 'sms' | 'storage_mb' | 'ai_tokens' | 'api_call'
  quantity int default 1,
  meta jsonb default '{}',  -- e.g. { recipient, subject } for email
  recorded_at timestamptz default now()
);

-- ── Billing events ─────────────────────────────────────────────────────────────
create table if not exists forge_billing (
  id uuid primary key default gen_random_uuid(),
  tenant_id text references forge_tenants(id) on delete cascade,
  type text not null,           -- 'charge' | 'refund' | 'credit'
  amount_cents int not null,
  description text,
  stripe_invoice_id text,
  status text default 'pending', -- pending | paid | failed
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz default now()
);

-- ── Usage aggregation view ─────────────────────────────────────────────────────
create or replace view forge_usage_summary as
select
  tenant_id,
  type,
  date_trunc('month', recorded_at) as month,
  sum(quantity) as total,
  count(*) as events
from forge_usage
group by tenant_id, type, date_trunc('month', recorded_at);

-- ── Pricing rules ──────────────────────────────────────────────────────────────
-- We use these to calculate overage charges
create table if not exists forge_pricing (
  plan text not null,
  resource text not null,           -- 'email' | 'sms' | 'storage_mb' | 'ai_tokens'
  included_qty int default 0,       -- free tier per month
  overage_price_cents numeric(8,4), -- per unit above included
  primary key (plan, resource)
);

insert into forge_pricing (plan, resource, included_qty, overage_price_cents) values
  ('starter', 'email',      1000,  0.01),   -- 1k emails free, then $0.01 each (we pay $0.001)
  ('starter', 'sms',        50,    2.0),    -- 50 SMS free, then $0.02 each (we pay $0.004)
  ('starter', 'storage_mb', 500,   0.05),   -- 500MB free
  ('starter', 'ai_tokens',  50000, 0.001),  -- 50k tokens free
  ('pro',     'email',      10000, 0.008),
  ('pro',     'sms',        500,   1.5),
  ('pro',     'storage_mb', 5000,  0.03),
  ('pro',     'ai_tokens',  500000, 0.0008)
on conflict do nothing;

-- ── Indexes ────────────────────────────────────────────────────────────────────
create index if not exists idx_forge_usage_tenant_type on forge_usage(tenant_id, type, recorded_at);
create index if not exists idx_forge_tenants_slug on forge_tenants(slug);
create index if not exists idx_forge_tenants_owner on forge_tenants(owner_user_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────
alter table forge_tenants enable row level security;
alter table forge_usage enable row level security;
alter table forge_billing enable row level security;

-- Only service role can write; customers can read their own tenant
create policy "Service role full access tenants" on forge_tenants using (true) with check (true);
create policy "Service role full access usage" on forge_usage using (true) with check (true);
create policy "Service role full access billing" on forge_billing using (true) with check (true);
