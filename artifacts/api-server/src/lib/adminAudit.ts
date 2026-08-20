import { adminAuditLogsTable, db } from "@workspace/db";
import type { AdminRequest } from "./adminSession";

/** A database transaction or the global `db` client accepted by this helper. */
type DbClient = Pick<typeof db, "insert">;

export async function recordAdminAudit(
  req: AdminRequest,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason: string;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
  },
  /** Pass the Drizzle transaction client to make the audit insert atomic with
   *  its surrounding mutation.  Defaults to the global db connection. */
  client: DbClient = db,
): Promise<void> {
  if (!req.admin) throw new Error("Administrator identity is required for audit logging");
  await client.insert(adminAuditLogsTable).values({
    adminId: req.admin.id,
    actorEmail: req.admin.email,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    reason: input.reason,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
  });
}
