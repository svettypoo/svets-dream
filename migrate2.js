const projectRef = 'xocfduqugghailalzlqy';
const accessToken = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03';

const tables = [
`create table if not exists agent_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  type text not null default 'fact',
  content text not null,
  importance int not null default 3,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)`,
`alter table agent_memories enable row level security`,
`create policy if not exists "Users manage own agent memories" on agent_memories for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
`create index if not exists agent_memories_lookup on agent_memories(user_id, agent_id, importance desc, created_at desc)`,

`create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  date date not null default current_date,
  content text not null default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, agent_id, date)
)`,
`alter table agent_logs enable row level security`,
`create policy if not exists "Users manage own agent logs" on agent_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  instructions text,
  tool_definition jsonb not null,
  api_calls jsonb,
  env_vars jsonb,
  is_builtin boolean default false,
  created_at timestamptz default now(),
  unique(user_id, slug)
)`,
`alter table skills enable row level security`,
`create policy if not exists "Users manage own skills" on skills for all using (auth.uid() = user_id or user_id is null) with check (auth.uid() = user_id)`,

`create table if not exists agent_skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  skill_id uuid not null references skills(id) on delete cascade,
  primary key (user_id, agent_id, skill_id)
)`,
`alter table agent_skills enable row level security`,
`create policy if not exists "Users manage own agent skills" on agent_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists heartbeat_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_snapshot jsonb not null,
  org_snapshot jsonb,
  interval_minutes int not null default 30,
  prompt text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz default now(),
  unique(user_id, agent_id)
)`,
`alter table heartbeat_configs enable row level security`,
`create policy if not exists "Users manage own heartbeat configs" on heartbeat_configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists gateway_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  credentials jsonb not null default '{}',
  default_agent_id text,
  default_org_snapshot jsonb,
  enabled boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, channel)
)`,
`alter table gateway_settings enable row level security`,
`create policy if not exists "Users manage own gateway settings" on gateway_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists channel_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  channel_user_id text not null,
  agent_id text,
  created_at timestamptz default now(),
  unique(user_id, channel, channel_user_id)
)`,
`alter table channel_users enable row level security`,
`create policy if not exists "Users manage own channel users" on channel_users for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists channel_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  channel_user_id text not null,
  agent_id text not null,
  messages jsonb not null default '[]',
  updated_at timestamptz default now(),
  unique(user_id, channel, channel_user_id, agent_id)
)`,
`alter table channel_conversations enable row level security`,
`create policy if not exists "Users manage own channel conversations" on channel_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,

`create table if not exists agent_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_label text,
  messages jsonb not null default '[]',
  org_snapshot jsonb,
  updated_at timestamptz default now(),
  unique(user_id, agent_id)
)`,
`alter table agent_conversations enable row level security`,
`create policy if not exists "Users manage own agent conversations" on agent_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
];

async function run() {
  let ok = 0, fail = 0;
  for (const stmt of tables) {
    const res = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/database/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: stmt })
    });
    const data = await res.json();
    if (res.ok) { ok++; process.stdout.write('.'); }
    else { console.log('\nFAIL:', stmt.slice(0,60), '|', data.message || data.error || JSON.stringify(data)); fail++; }
  }
  console.log('\nDone:', ok, 'ok,', fail, 'failed');
}
run();
