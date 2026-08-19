/**
 * Shared helpers for admin trust operation routes.
 * Provides parameter extraction, pagination, and the two audit writers
 * (adminAuditEventsTable and trustStatusHistoryTable) used by every module.
 */

import { db } from "@workspace/db";
import { adminAuditEventsTable, trustStatusHistoryTable } from "@workspace/db";
import type { AdminRequest } from "../../lib/adminSession.js";

// ── Parameter helpers ─────────────────────────────────────────────────────────

export function paramStr(req: AdminRequest, name: string): string {
  const raw = req.params[name];
  return typeof raw === "string" ? raw : Array.isArray(raw) ? (raw[0] ?? "") : "";
}

export function paginationParams(query: Record<string, string | undefined>): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(query.page ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "25") || 25));
  return { page, limit, offset: (page - 1) * limit };
}

// ── Recent-auth inline check (10-minute window) ───────────────────────────────

export function checkRecentAuth(req: AdminRequest): boolean {
  const recentAuthAt = req.adminSession?.recentAuthAt;
  return !!(recentAuthAt && Date.now() - recentAuthAt.getTime() <= 10 * 60 * 1000);
}

// ── Audit writers ─────────────────────────────────────────────────────────────

export type AuditOpts = {
  adminId: string;
  adminSessionId: string | undefined;
  action: string;
  category: string;
  severity?: string;
  targetType: string;
  targetId: string;
  reason: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  requestId?: string;
};

export async function writeAudit(tx: typeof db, opts: AuditOpts): Promise<void> {
  await tx.insert(adminAuditEventsTable).values({
    adminId: opts.adminId,
    adminSessionId: opts.adminSessionId ?? null,
    action: opts.action,
    category: opts.category,
    severity: opts.severity ?? "info",
    targetType: opts.targetType,
    targetId: opts.targetId,
    reason: opts.reason,
    previousState: opts.previousState ?? null,
    newState: opts.newState ?? null,
    requestId: opts.requestId ?? null,
  });
}

export type StatusHistoryOpts = {
  domain: string;
  recordId: string;
  fromStatus: string | null | undefined;
  toStatus: string;
  reason: string;
  adminId: string;
};

export async function writeStatusHistory(
  tx: typeof db,
  opts: StatusHistoryOpts,
): Promise<void> {
  await tx.insert(trustStatusHistoryTable).values({
    domain: opts.domain,
    recordId: opts.recordId,
    fromStatus: opts.fromStatus ?? null,
    toStatus: opts.toStatus,
    reason: opts.reason,
    adminId: opts.adminId,
  });
}
