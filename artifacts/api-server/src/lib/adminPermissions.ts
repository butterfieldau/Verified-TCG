export const ADMIN_ROLES = ["owner", "admin", "support", "moderator", "analyst"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "dashboard:read",
  "users:read",
  "users:manage",
  "users:delete",
  "analytics:read",
  "reports:read",
  "reports:moderate",
  "contact:read",
  "team:read",
  "team:manage",
  "sessions:read",
  "sessions:revoke",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const permissionsByRole: Record<AdminRole, AdminPermission[]> = {
  owner: [...ADMIN_PERMISSIONS],
  admin: [
    "dashboard:read",
    "users:read",
    "users:manage",
    "users:delete",
    "analytics:read",
    "reports:read",
    "reports:moderate",
    "contact:read",
  ],
  support: ["dashboard:read", "users:read", "contact:read"],
  moderator: ["dashboard:read", "users:read", "reports:read", "reports:moderate"],
  analyst: ["dashboard:read", "users:read", "analytics:read", "reports:read"],
};

export const roleRank: Record<AdminRole, number> = {
  analyst: 1,
  support: 2,
  moderator: 2,
  admin: 3,
  owner: 4,
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

/** A custom set can only reduce a role's access, never expand it. */
export function resolvePermissions(role: string, customPermissions: unknown): AdminPermission[] {
  if (!isAdminRole(role)) return [];
  const baseline = permissionsByRole[role];
  if (!Array.isArray(customPermissions)) return [];
  return customPermissions.filter(
    (permission): permission is AdminPermission =>
      isAdminPermission(permission) && baseline.includes(permission),
  );
}

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return permissionsByRole[role];
}