/**
 * GET  /admin/certifications        — paginated list with inline status history
 * POST /admin/certifications        — create review (reason required; transactional with initial history + audit)
 * GET  /admin/certifications/:id    — detail with notes and history
 * POST /admin/certifications/:id/notes  — append note ({note, reason} required; transactional note + audit)
 * POST /admin/certifications/:id/status — status transition (reason required; writes history + audit)
 *
 * "verified" status may only be set when BOTH:
 *   - providerVerificationStatus === "completed"
 *   - externalVerifiedAt is non-null
 * Internal admin review can reach at most "internally_reviewed".
 * External PSA/BGS write-back is not supported and cannot be triggered here.
 *
 * Every mutation requires a non-empty reason; status-bearing mutations write history.
 * Note endpoints accept {note, reason} and write an audit row transactionally.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  certificationReviewsTable,
  certificationNotesTable,
  trustStatusHistoryTable,
} from "@workspace/db";
import { eq, desc, asc, and, inArray, count } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import { paramStr, paginationParams, writeAudit, writeStatusHistory } from "./helpers.js";

export const certificationsRouter = Router();

const VALID_CERT_STATUSES = [
  "pending",
  "under_review",
  "internally_reviewed",
  "verified",
  "rejected",
] as const;

// ── GET /admin/certifications ─────────────────────────────────────────────────

certificationsRouter.get(
  "/admin/certifications",
  requireAdminPermission("trust:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const status = q.status?.trim();
    const provider = q.provider?.trim();

    try {
      const conditions = [];
      if (status) conditions.push(eq(certificationReviewsTable.status, status));
      if (provider) conditions.push(eq(certificationReviewsTable.provider, provider));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, certifications] = await Promise.all([
        db.select({ cnt: count() }).from(certificationReviewsTable).where(where),
        db
          .select()
          .from(certificationReviewsTable)
          .where(where)
          .orderBy(desc(certificationReviewsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const certIds = certifications.map((c) => c.id);
      const historyRows =
        certIds.length > 0
          ? await db
              .select()
              .from(trustStatusHistoryTable)
              .where(
                and(
                  eq(trustStatusHistoryTable.domain, "certification"),
                  inArray(trustStatusHistoryTable.recordId, certIds),
                ),
              )
              .orderBy(asc(trustStatusHistoryTable.createdAt))
          : [];

      const historyByRecord = new Map<string, typeof historyRows>();
      for (const h of historyRows) {
        const arr = historyByRecord.get(h.recordId) ?? [];
        arr.push(h);
        historyByRecord.set(h.recordId, arr);
      }

      const items = certifications.map((c) => ({
        ...c,
        history: historyByRecord.get(c.id) ?? [],
      }));

      res.json({ certifications: items, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin certifications list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/certifications ────────────────────────────────────────────────

certificationsRouter.post(
  "/admin/certifications",
  requireAdminPermission("trust:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const {
      cardId,
      cardName,
      ownerUserId,
      collectionItemId,
      provider,
      certificationId,
      evidenceSource,
      reason,
    } = body;

    if (!cardId || typeof cardId !== "string" || !cardId.trim()) {
      res.status(400).json({ message: "cardId is required." });
      return;
    }
    if (!cardName || typeof cardName !== "string" || !cardName.trim()) {
      res.status(400).json({ message: "cardName is required." });
      return;
    }
    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      let cert: typeof certificationReviewsTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(certificationReviewsTable)
          .values({
            cardId: String(cardId).trim(),
            cardName: String(cardName).trim(),
            ownerUserId: ownerUserId ? String(ownerUserId) : null,
            collectionItemId: collectionItemId ? String(collectionItemId) : null,
            provider: provider ? String(provider) : "internal",
            certificationId: certificationId ? String(certificationId) : null,
            evidenceSource: evidenceSource ? String(evidenceSource) : null,
            status: "pending",
            providerVerificationStatus: "not_requested",
          })
          .returning();
        cert = inserted;

        // Initial status history for newly created certification
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "certification",
          recordId: inserted!.id,
          fromStatus: null,
          toStatus: "pending",
          reason: String(reason).trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "certification.create",
          category: "trust",
          targetType: "certification",
          targetId: inserted!.id,
          reason: String(reason).trim(),
          newState: { cardId: inserted!.cardId, status: inserted!.status },
          requestId: req.id as string | undefined,
        });
      });

      res.status(201).json({ message: "Certification review created.", certification: cert });
    } catch (err) {
      req.log.error({ err }, "admin certification create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/certifications/:id ─────────────────────────────────────────────

certificationsRouter.get(
  "/admin/certifications/:id",
  requireAdminPermission("trust:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const certId = paramStr(req, "id");
    if (!certId) {
      res.status(400).json({ message: "Missing certification id." });
      return;
    }

    try {
      const [cert] = await db
        .select()
        .from(certificationReviewsTable)
        .where(eq(certificationReviewsTable.id, certId))
        .limit(1);

      if (!cert) {
        res.status(404).json({ message: "Certification not found." });
        return;
      }

      const [notes, history] = await Promise.all([
        db
          .select()
          .from(certificationNotesTable)
          .where(eq(certificationNotesTable.certificationReviewId, certId))
          .orderBy(asc(certificationNotesTable.createdAt)),
        db
          .select()
          .from(trustStatusHistoryTable)
          .where(
            and(
              eq(trustStatusHistoryTable.domain, "certification"),
              eq(trustStatusHistoryTable.recordId, certId),
            ),
          )
          .orderBy(asc(trustStatusHistoryTable.createdAt)),
      ]);

      res.json({ certification: cert, notes, history });
    } catch (err) {
      req.log.error({ err, certId }, "admin certification detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/certifications/:id/notes ─────────────────────────────────────
// Accepts {note, reason}. Writes note + audit row in one transaction.

certificationsRouter.post(
  "/admin/certifications/:id/notes",
  requireAdminPermission("trust:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const certId = paramStr(req, "id");
    const { note, reason } = req.body as { note?: string; reason?: string };

    if (!certId) {
      res.status(400).json({ message: "Missing certification id." });
      return;
    }
    if (!note?.trim()) {
      res.status(400).json({ message: "A non-empty note is required." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const [existing] = await db
        .select({ id: certificationReviewsTable.id })
        .from(certificationReviewsTable)
        .where(eq(certificationReviewsTable.id, certId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Certification not found." });
        return;
      }

      let inserted: typeof certificationNotesTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(certificationNotesTable)
          .values({ certificationReviewId: certId, adminId: req.admin!.id, note: note!.trim() })
          .returning();
        inserted = row;

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "certification.note.add",
          category: "trust",
          targetType: "certification",
          targetId: certId,
          reason: reason!.trim(),
          newState: { noteId: row?.id, note: note!.trim() },
          requestId: req.id as string | undefined,
        });
      });

      res.status(201).json({ message: "Note added.", note: inserted });
    } catch (err) {
      req.log.error({ err, certId }, "admin certification note failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/certifications/:id/status ────────────────────────────────────

certificationsRouter.post(
  "/admin/certifications/:id/status",
  requireAdminPermission("trust:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const certId = paramStr(req, "id");
    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!certId) {
      res.status(400).json({ message: "Missing certification id." });
      return;
    }
    if (!VALID_CERT_STATUSES.includes(status as (typeof VALID_CERT_STATUSES)[number])) {
      res.status(400).json({
        message: `status must be one of: ${VALID_CERT_STATUSES.join(", ")}.`,
      });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [cert] = await tx
          .select()
          .from(certificationReviewsTable)
          .where(eq(certificationReviewsTable.id, certId))
          .for("update")
          .limit(1);

        if (!cert) return { kind: "not_found" as const };

        // "verified" requires providerVerificationStatus=completed AND externalVerifiedAt set.
        // Internal admin review cannot claim external verification — max is "internally_reviewed".
        if (
          status === "verified" &&
          (cert.providerVerificationStatus !== "completed" || !cert.externalVerifiedAt)
        ) {
          return { kind: "verification_precondition_failed" as const };
        }

        const now = new Date();
        await tx
          .update(certificationReviewsTable)
          .set({
            status: status!,
            reviewedByAdminId: req.admin!.id,
            reviewedAt: now,
            outcomeReason: reason!.trim(),
            updatedAt: now,
          })
          .where(eq(certificationReviewsTable.id, certId));

        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "certification",
          recordId: certId,
          fromStatus: cert.status,
          toStatus: status!,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `certification.status.${status}`,
          category: "trust",
          targetType: "certification",
          targetId: certId,
          reason: reason!.trim(),
          previousState: { status: cert.status },
          newState: { status },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Certification not found." });
        return;
      }
      if (result.kind === "verification_precondition_failed") {
        res.status(400).json({
          message:
            "Cannot set status to verified: providerVerificationStatus must be completed and externalVerifiedAt must be set. Internal admin review cannot claim external verification.",
          code: "VERIFICATION_PRECONDITION_FAILED",
        });
        return;
      }

      req.log.info({ certId, status, adminId: req.admin!.id }, "Admin changed certification status");
      res.json({ message: "Certification status updated.", certId, status });
    } catch (err) {
      req.log.error({ err, certId }, "admin certification status failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
