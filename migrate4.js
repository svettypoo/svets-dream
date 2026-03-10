// Add agent_profiles table for persistent SOUL.md + AGENTS.md per agent
const projectRef = 'xocfduqugghailalzlqy';
const accessToken = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03';

const statements = [
`create table if not exists agent_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  agent_label text,
  soul_md text not null default '',
  agents_md text not null default '',
  updated_at timestamptz default now(),
  unique(user_id, agent_id)
)`,
`alter table agent_profiles enable row level security`,
`create policy "Users manage own agent profiles" on agent_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
`create index if not exists agent_profiles_lookup on agent_profiles(user_id, agent_id)`,
];

async function run() {
  let ok = 0, fail = 0;
  for (const stmt of statements) {
    const res = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/database/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: stmt })
    });
    const data = await res.json();
    if (res.ok) { ok++; process.stdout.write('.'); }
    else { console.log('\nFAIL:', stmt.slice(0, 60), '|', data.message || data.error); fail++; }
  }
  console.log('\nDone:', ok, 'ok,', fail, 'failed');
}
run();
