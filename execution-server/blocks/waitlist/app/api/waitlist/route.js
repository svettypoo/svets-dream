import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/waitlist — { email, name }
export async function POST(req) {
  const { email, name } = await req.json();
  if (!email) return Response.json({ error: 'Email required' }, { status: 400 });

  // Check duplicate
  const { data: existing } = await supabase
    .from('waitlist')
    .select('id, position')
    .eq('email', email.toLowerCase())
    .single();
  if (existing) {
    return Response.json({ position: existing.position, alreadyJoined: true });
  }

  // Get next position
  const { count } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true });
  const position = (count || 0) + 1;

  const { error } = await supabase.from('waitlist').insert({
    email: email.toLowerCase(),
    name: name || null,
    position,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Send confirmation email (optional — only if RESEND_API_KEY is set)
  if (process.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'noreply@example.com',
        to: email,
        subject: `You're #${position} on the waitlist!`,
        html: `<p>Hi ${name || 'there'},</p><p>You're <strong>#${position}</strong> on the waitlist for <strong>${process.env.NEXT_PUBLIC_APP_NAME || 'our app'}</strong>. We'll be in touch when it's your turn!</p>`,
      }),
    }).catch(() => {}); // fire-and-forget
  }

  return Response.json({ position, success: true });
}

// GET /api/waitlist — admin list (no auth for now, add requireRole('admin') for production)
export async function GET() {
  const { data, count, error } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact' })
    .order('position', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ entries: data, total: count });
}
