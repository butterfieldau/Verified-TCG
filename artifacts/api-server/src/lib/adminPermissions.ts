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
  "contact:moderate",
  "team:read",
  "team:manage",
  "sessions:read",
  "sessions:revoke",
  // Trust operations
  "community:read",
  "community:moderate",
  "events:read",
  "events:manage",
  "vendors:read",
  "vendors:manage",
  "trust:read",
  "trust:manage",
  "drops:read",
  "drops:manage",
  "operations:read",
  // Governance — notifications / campaigns
  "notifications:read",
  "notifications:manage",
  // Governance — support cases
  "support:read",
  "support:manage",
  // Governance — privacy & account requests
  "privacy:read",
  "privacy:manage",
  "privacy:approve",
  "privacy:export",
  "privacy:delete",
  // Governance — retention
  "retention:read",
  "retention:manage",
  // Governance — internal notes
  "notes:read",
  "notes:manage",
  // Governance — announcements
  "announcements:read",
  "announcements:manage",
  // TCG data operations
  "catalogue:read",
  "pricing:read",
  "pricing:manage",
  "scanner:read",
  "scanner:review",
  "collections:read",
  // Governance — audit log
  "audit:read",
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
    "contact:moderate",
    "community:read",
    "community:moderate",
    "events:read",
    "events:manage",
    "vendors:read",
    "vendors:manage",
    "trust:read",
    "trust:manage",
    "drops:read",
    "drops:manage",
    "operations:read",
    // governance
    "notifications:read",
    "notifications:manage",
    "support:read",
    "support:manage",
    "privacy:read",
    "privacy:manage",
    "privacy:approve",
    "privacy:export",
    "privacy:delete",
    "retention:read",
    "retention:manage",
    "notes:read",
    "notes:manage",
    "announcements:read",
    "announcements:manage",
    // TCG data operations
    "catalogue:read",
    "pricing:read",
    "pricing:manage",
    "scanner:read",
    "scanner:review",
    "collections:read",
    "audit:read",
  ],
  support: [
    "dashboard:read",
    "users:read",
    "contact:read",
    "contact:moderate",
    "support:read",
    "support:manage",
    "privacy:read",
    "privacy:manage",
    "community:read",
    "operations:read",
    "notes:read",
    "announcements:read",
  ],
  moderator: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "reports:moderate",
    "community:read",
    "community:moderate",
    "events:read",
    "vendors:read",
    "trust:read",
    "drops:read",
    "operations:read",
    "notes:read",
    "announcements:read",
  ],
  analyst: [
    "dashboard:read",
    "users:read",
    "analytics:read",
    "reports:read",
    "community:read",
    "events:read",
    "vendors:read",
    "trust:read",
    "drops:read",
    "operations:read",
    "notifications:read",
    "catalogue:read",
    "pricing:read",
    "scanner:read",
    "collections:read",
    "audit:read",
    "announcements:read",
  ],
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
  // The single Owner role is the platform authority and must receive newly
  // introduced owner permissions even when its stored list predates them.
  if (role === "owner") return [...baseline];
  if (!Array.isArray(customPermissions)) return [];
  return customPermissions.filter(
    (permission): permission is AdminPermission =>
      isAdminPermission(permission) && baseline.includes(permission),
  );
}

export function permissionsForRole(role: AdminRole): AdminPermission[] {
  return permissionsByRole[role];
}
