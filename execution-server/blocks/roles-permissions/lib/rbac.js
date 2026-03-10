// RBAC — role-based access control helpers
// Roles: admin > moderator > member > guest
// Usage: import { requireRole, hasPermission } from '@/lib/rbac'

const ROLE_HIERARCHY = { admin: 4, moderator: 3, member: 2, guest: 1 };

const PERMISSIONS = {
  'users.read':    ['guest', 'member', 'moderator', 'admin'],
  'users.write':   ['moderator', 'admin'],
  'users.delete':  ['admin'],
  'roles.manage':  ['admin'],
  'content.read':  ['guest', 'member', 'moderator', 'admin'],
  'content.write': ['member', 'moderator', 'admin'],
  'content.delete':['moderator', 'admin'],
  'settings.read': ['moderator', 'admin'],
  'settings.write':['admin'],
  'billing.read':  ['admin'],
  'billing.write': ['admin'],
};

export function hasPermission(userRole, permission) {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(userRole);
}

export function hasMinRole(userRole, minRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[minRole] || 0);
}

// Next.js API route guard — returns 403 JSON if insufficient
export function requireRole(minRole) {
  return function roleGuard(handler) {
    return async function (req, ctx) {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.replace('Bearer ', '');
      if (!token) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      const userRole = profile?.role || 'guest';
      if (!hasMinRole(userRole, minRole)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      req.user = { ...user, role: userRole };
      return handler(req, ctx);
    };
  };
}

// React hook for client-side permission checks
export function usePermissions(userRole) {
  return {
    can: (permission) => hasPermission(userRole, permission),
    isAdmin: userRole === 'admin',
    isModerator: hasMinRole(userRole, 'moderator'),
    isMember: hasMinRole(userRole, 'member'),
    role: userRole,
  };
}
