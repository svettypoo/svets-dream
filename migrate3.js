const projectRef = 'xocfduqugghailalzlqy';
const accessToken = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03';

const policies = [
  `create policy "Users manage own agent memories" on agent_memories for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own agent logs" on agent_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own skills" on skills for all using (auth.uid() = user_id or user_id is null) with check (auth.uid() = user_id)`,
  `create policy "Users manage own agent skills" on agent_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own heartbeat configs" on heartbeat_configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own gateway settings" on gateway_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own channel users" on channel_users for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own channel conversations" on channel_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create policy "Users manage own agent conversations" on agent_conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id)`,
  `create index if not exists agent_memories_lookup on agent_memories(user_id, agent_id, importance desc, created_at desc)`,
];

async function run() {
  let ok = 0, fail = 0;
  for (const stmt of policies) {
    const res = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/database/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: stmt })
    });
    const data = await res.json();
    if (res.ok) { ok++; process.stdout.write('.'); }
    else { console.log('\nFAIL:', stmt.slice(0,60), '|', data.message || data.error); fail++; }
  }
  console.log('\nDone:', ok, 'ok,', fail, 'failed');
}
run();
