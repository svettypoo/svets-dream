import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// POST /api/onboarding — save answers, mark user as onboarded
export async function POST(req) {
  const { userId, answers } = await req.json();
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  // Save onboarding answers to profile
  const profileUpdate = {
    onboarded: true,
    onboarded_at: new Date().toISOString(),
    onboarding_data: answers,
  };

  // Apply common answer mappings
  if (answers.full_name) profileUpdate.full_name = answers.full_name;
  if (answers.company) profileUpdate.company = answers.company;
  if (answers.plan) profileUpdate.plan = answers.plan;

  await supabase.from('profiles').upsert({ id: userId, ...profileUpdate }, { onConflict: 'id' });

  return Response.json({ success: true });
}
