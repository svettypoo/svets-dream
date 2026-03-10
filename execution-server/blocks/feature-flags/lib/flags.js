// Feature flags — per-plan or per-user toggles
// Usage: const enabled = await isEnabled('ai_chat', userId, userPlan)
// Client: import { flags } from '@/lib/flags'; if (flags.ai_chat) { ... }

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Check a single flag — returns boolean
export async function isEnabled(flagKey, userId = null, plan = null) {
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('*')
    .eq('key', flagKey)
    .single();

  if (!flag) return false;
  if (!flag.enabled) return false;

  // Per-user override
  if (userId && flag.user_overrides) {
    const overrides = flag.user_overrides;
    if (userId in overrides) return overrides[userId];
  }

  // Plan gating
  if (flag.plans && flag.plans.length > 0) {
    return plan ? flag.plans.includes(plan) : false;
  }

  return true; // globally enabled, no restrictions
}

// Get all flags as a simple { key: boolean } map for client-side use
export async function getAllFlags(userId = null, plan = null) {
  const { data: flags } = await supabase.from('feature_flags').select('*');
  const result = {};
  for (const flag of flags || []) {
    if (!flag.enabled) { result[flag.key] = false; continue; }
    if (userId && flag.user_overrides?.[userId] !== undefined) {
      result[flag.key] = flag.user_overrides[userId]; continue;
    }
    if (flag.plans?.length > 0) { result[flag.key] = plan ? flag.plans.includes(plan) : false; continue; }
    result[flag.key] = true;
  }
  return result;
}
