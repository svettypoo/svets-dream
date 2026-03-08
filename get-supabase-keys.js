// Run this once after logging into Supabase in your browser:
//   node get-supabase-keys.js
// It opens a headed browser (already logged in), grabs the API keys,
// and patches .env.local automatically.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'osmpxmoqowkbnusfdajk';
const ENV_FILE = path.join(__dirname, '.env.local');

(async () => {
  console.log('Opening browser to fetch Supabase API keys...');
  const browser = await chromium.launchPersistentContext(
    'C:/Users/pargo_pxnd4wa/AppData/Local/ms-playwright/mcp-chrome-cf6db81',
    { headless: false, args: ['--no-first-run'] }
  );
  const page = browser.pages()[0] || await browser.newPage();

  let anonKey = null, serviceKey = null;

  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes(PROJECT_ID) && url.includes('api-keys')) {
      try {
        const body = await res.text();
        if (body.includes('eyJ')) {
          const tokens = body.match(/eyJ[A-Za-z0-9._-]{80,}/g);
          if (tokens && tokens.length >= 2) {
            anonKey = tokens[0];
            serviceKey = tokens[1];
          }
        }
      } catch(e) {}
    }
  });

  await page.goto(`https://supabase.com/dashboard/project/${PROJECT_ID}/settings/api-keys/legacy`, { timeout: 30000 });

  // Wait up to 30s for keys to appear
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (anonKey && serviceKey) break;

    // Also try extracting from inputs
    const vals = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => i.value).filter(v => v && v.startsWith('eyJ'));
    });
    if (vals.length >= 2) { anonKey = vals[0]; serviceKey = vals[1]; break; }
    if (vals.length === 1) { anonKey = vals[0]; }

    // Try sb_ format too
    const sbVals = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(i => i.value).filter(v => v && v.startsWith('sb_'));
    });
    if (sbVals.length >= 2) { anonKey = sbVals[0]; serviceKey = sbVals[1]; break; }
  }

  await browser.close();

  if (!anonKey) {
    console.error('Could not find API keys. Make sure you are logged into Supabase.');
    process.exit(1);
  }

  let env = fs.readFileSync(ENV_FILE, 'utf8');
  env = env.replace('NEXT_PUBLIC_SUPABASE_ANON_KEY="PENDING"', `NEXT_PUBLIC_SUPABASE_ANON_KEY="${anonKey}"`);
  if (serviceKey) {
    env = env.replace('SUPABASE_SERVICE_ROLE_KEY="PENDING"', `SUPABASE_SERVICE_ROLE_KEY="${serviceKey}"`);
  }
  fs.writeFileSync(ENV_FILE, env);
  console.log('✓ .env.local updated with Supabase API keys!');
  console.log('  anon key:', anonKey.substring(0, 30) + '...');
  if (serviceKey) console.log('  service key:', serviceKey.substring(0, 30) + '...');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
