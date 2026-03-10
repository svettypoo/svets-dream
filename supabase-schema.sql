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

-- Virtual machines (Docker containers managed per user)
create table if not exists user_vms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  container_id text,            -- Docker container ID
  image text not null default 'ubuntu:22.04',
  status text not null default 'stopped',  -- stopped, running, error
  memory_mb integer not null default 512,
  created_at timestamptz default now(),
  last_used_at timestamptz
);

alter table user_vms enable row level security;

create policy "Users manage own vms"
  on user_vms for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_vms_user_id
  on user_vms(user_id, created_at desc);

-- ── PHASE 1: Agent Memory System ──────────────────────────────────────────────

-- Long-term curated facts per agent (persists across all sessions)
create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  type text not null default 'fact',  -- fact | preference | goal | context
  content text not null,
  importance int not null default 3,  -- 1 (minor) to 5 (critical)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table agent_memories enable row level security;

create policy "Users manage own agent memories"
  on agent_memories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists agent_memories_lookup
  on agent_memories(user_id, agent_id, importance desc, created_at desc);

-- Daily append-only activity logs per agent
create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  date date not null default current_date,
  content text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, agent_id, date)
);

alter table agent_logs enable row level security;

create policy "Users manage own agent logs"
  on agent_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── PHASE 2: Skill Registry ────────────────────────────────────────────────────

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,  -- null = built-in
  slug text not null,
  name text not null,
  description text not null,
  instructions text,                  -- injected into system prompt when skill is active
  tool_definition jsonb not null,     -- JSON schema for the tool (name, description, input_schema)
  api_calls jsonb,                    -- list of HTTP calls the skill makes
  env_vars jsonb,                     -- { "KEY_NAME": "Human description" }
  is_builtin boolean default false,
  created_at timestamptz default now(),
  unique(user_id, slug)
);

alter table skills enable row level security;

create policy "Users manage own skills"
  on skills for all
  using (auth.uid() = user_id or user_id is null)
  with check (auth.uid() = user_id);

-- Many-to-many: which agents have which skills enabled
create table if not exists agent_skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  skill_id uuid not null references skills(id) on delete cascade,
  primary key (user_id, agent_id, skill_id)
);

alter table agent_skills enable row level security;

create policy "Users manage own agent skills"
  on agent_skills for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── PHASE 3: Heartbeat Scheduler ──────────────────────────────────────────────

create table if not exists heartbeat_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_snapshot jsonb not null,      -- full agent object (label, role, description, etc.)
  org_snapshot jsonb,                 -- full org context
  interval_minutes int not null default 30,
  prompt text not null,               -- what the agent does on each heartbeat
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, agent_id)
);

alter table heartbeat_configs enable row level security;

create policy "Users manage own heartbeat configs"
  on heartbeat_configs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── PHASE 4: Multi-channel Gateway ────────────────────────────────────────────

-- Stores credentials and default agent for each channel
create table if not exists gateway_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,              -- 'slack' | 'whatsapp' | 'telegram'
  credentials jsonb not null default '{}',  -- encrypted tokens/keys
  default_agent_id text,
  default_org_snapshot jsonb,
  enabled boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, channel)
);

alter table gateway_settings enable row level security;

create policy "Users manage own gateway settings"
  on gateway_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Maps external channel user IDs to app users
create table if not exists channel_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  channel_user_id text not null,      -- e.g. Slack member ID, WhatsApp phone
  agent_id text,                       -- override agent for this specific user
  created_at timestamptz default now(),
  unique(user_id, channel, channel_user_id)
);

alter table channel_users enable row level security;

create policy "Users manage own channel users"
  on channel_users for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Conversation history per gateway channel user
create table if not exists channel_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  channel_user_id text not null,
  agent_id text not null,
  messages jsonb not null default '[]',
  updated_at timestamptz default now(),
  unique(user_id, channel, channel_user_id, agent_id)
);

alter table channel_conversations enable row level security;

create policy "Users manage own channel conversations"
  on channel_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Agent conversations (web UI chat history)
create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_label text,
  messages jsonb not null default '[]',
  org_snapshot jsonb,
  updated_at timestamptz default now(),
  unique(user_id, agent_id)
);

alter table agent_conversations enable row level security;

create policy "Users manage own agent conversations"
  on agent_conversations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
