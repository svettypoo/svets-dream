const https = require('https');

function req(path, cookie) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'supabase.com',
      path: path,
      headers: { 'Cookie': cookie, 'Accept': 'application/json' }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  const cookie = 'session_id=019ccf8f-6d95-739e-b207-6de5a9f11aa9';
  // Try different API endpoints
  const r1 = await req('/dashboard/api/projects', cookie);
  console.log('projects:', r1.status, r1.body.substring(0, 200));
})();
