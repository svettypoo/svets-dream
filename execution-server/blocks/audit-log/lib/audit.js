// Audit logging — fire-and-forget helper
// Usage: audit({ userId, action: 'user.login', resource: 'auth', details: { ip } })

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function audit({ userId, action, resource, resourceId, details, req }) {
  const entry = {
    user_id: userId || null,
    action,
    resource,
    resource_id: resourceId || null,
    details: details || null,
    ip_address: req ? (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown') : null,
    user_agent: req ? req.headers.get('user-agent') : null,
  };

  // Fire-and-forget — never block the calling request
  supabase.from('audit_logs').insert(entry).then(() => {}).catch(console.error);
}

// For server components and API routes — attach to req for convenience
export function auditMiddleware(handler) {
  return async (req, ctx) => {
    const result = await handler(req, ctx);
    return result;
  };
}
