'use client';
// Wrap any UI element to hide it from users without the required permission
// Usage: <PermissionGate permission="users.delete" role={userRole}><DeleteButton /></PermissionGate>
// Usage: <PermissionGate minRole="admin" role={userRole}>...</PermissionGate>

import { hasPermission, hasMinRole } from '@/lib/rbac';

export default function PermissionGate({ children, permission, minRole, role, fallback = null }) {
  if (permission && !hasPermission(role, permission)) return fallback;
  if (minRole && !hasMinRole(role, minRole)) return fallback;
  return children;
}
