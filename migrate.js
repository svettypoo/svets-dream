const fs = require('fs');
const projectRef = 'xocfduqugghailalzlqy';
const accessToken = 'sbp_803303e69c9d5ad01cf12adcc6ad17747bd38d03';

const sql = fs.readFileSync('supabase-schema.sql', 'utf8');
const newTables = ['agent_memories', 'agent_logs', 'skills', 'agent_skills', 'heartbeat_configs', 'gateway_settings', 'channel_users', 'channel_conversations', 'agent_conversations'];

const statements = sql.split(';').map(s => s.trim()).filter(function(s) {
  return s.length > 5 && s.indexOf('--') !== 0;
});

const newStatements = statements.filter(function(s) {
  if (!s) return false;
  const lower = s.toLowerCase();
  return newTables.some(function(t) { return lower.indexOf(t) !== -1; });
});

console.log('Running', newStatements.length, 'new statements...');

async function run() {
  let ok = 0, fail = 0;
  for (const stmt of newStatements) {
    try {
      const res = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/database/query', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: stmt })
      });
      const data = await res.json();
      if (res.ok) { ok++; process.stdout.write('.'); }
      else { console.log('\nFAIL:', stmt.slice(0,80), '|', data.message || data.error || JSON.stringify(data)); fail++; }
    } catch(e) { console.log('\nERR:', e.message); fail++; }
  }
  console.log('\nDone:', ok, 'ok,', fail, 'failed');
}
run();
