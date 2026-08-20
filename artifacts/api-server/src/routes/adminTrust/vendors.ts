/**
 * GET  /admin/vendors             — paginated list
 * POST /admin/vendors             — create (reason required; transactional with initial history + audit)
 * PATCH /admin/vendors/:id        — edit fields (reason required; transactional mutation + audit)
 * POST /admin/vendors/:id/status  — status transition (reason required; writes history + audit)
 * POST /admin/vendors/:id/notes   — append note ({note, reason} required; transactional note + audit)
 * POST /admin/vendors/:id/events  — link vendor to an event (reason required; transactional link + audit)
 *
 * Every mutation requires a non-empty reason from the request body.
 * Status transitions write both statusHistory and auditEvent in a transaction.
 * Vendors are never seeded or fabricated.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  vendorsTable,
  vendorNotesTable,
  eventVendorsTable,
  eventsTable,
  trustStatusHistoryTable,
} from "@workspace/db";
import { eq, desc, asc, and, or, ilike, count } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import { paramStr, paginationParams, writeAudit, writeStatusHistory } from "./helpers.js";

export const vendorsRouter = Router();

const VALID_VENDOR_STATUSES = ["pending", "approved", "suspended", "rejected"] as const;

// ── GET /admin/vendors ────────────────────────────────────────────────────────

vendorsRouter.get(
  "/admin/vendors",
  requireAdminPermission("vendors:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const status = q.status?.trim();
    const search = q.search?.trim();

    try {
      const conditions = [];
      if (status) conditions.push(eq(vendorsTable.status, status));
      if (search) {
        conditions.push(
          or(
            ilike(vendorsTable.name, `%${search}%`),
            ilike(vendorsTable.location ?? "", `%${search}%`),
          )!,
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, vendors] = await Promise.all([
        db.select({ cnt: count() }).from(vendorsTable).where(where),
        db
          .select()
          .from(vendorsTable)
          .where(where)
          .orderBy(desc(vendorsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ vendors, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin vendors list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/vendors/:id ────────────────────────────────────────────────────
//
// Read-only detail: vendor row, internal notes, linked events (with event
// name/status/date and booth/link status), and vendor trust status history
// ordered chronologically. No records are ever created or fabricated here.

vendorsRouter.get(
  "/admin/vendors/:id",
  requireAdminPermission("vendors:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const vendorId = paramStr(req, "id");
    if (!vendorId) {
      res.status(400).json({ message: "Missing vendor id." });
      return;
    }

    try {
      const [vendor] = await db
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);

      if (!vendor) {
        res.status(404).json({ message: "Vendor not found." });
        return;
      }

      const [notes, linkedEvents, statusHistory] = await Promise.all([
        db
          .select()
          .from(vendorNotesTable)
          .where(eq(vendorNotesTable.vendorId, vendorId))
          .orderBy(asc(vendorNotesTable.createdAt)),
        db
          .select({
            linkId: eventVendorsTable.id,
            eventId: eventVendorsTable.eventId,
            booth: eventVendorsTable.booth,
            linkStatus: eventVendorsTable.status,
            linkedAt: eventVendorsTable.createdAt,
            eventName: eventsTable.name,
            eventStatus: eventsTable.status,
            eventDate: eventsTable.eventDate,
            eventStartsAt: eventsTable.startsAt,
          })
          .from(eventVendorsTable)
          .innerJoin(eventsTable, eq(eventVendorsTable.eventId, eventsTable.id))
          .where(eq(eventVendorsTable.vendorId, vendorId))
          .orderBy(desc(eventVendorsTable.createdAt)),
        db
          .select()
          .from(trustStatusHistoryTable)
          .where(
            and(
              eq(trustStatusHistoryTable.domain, "vendor"),
              eq(trustStatusHistoryTable.recordId, vendorId),
            ),
          )
          .orderBy(asc(trustStatusHistoryTable.createdAt)),
      ]);

      res.json({ vendor, notes, linkedEvents, statusHistory });
    } catch (err) {
      req.log.error({ err, vendorId }, "admin vendor detail failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/vendors ───────────────────────────────────────────────────────

vendorsRouter.post(
  "/admin/vendors",
  requireAdminPermission("vendors:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const { name, profile, location, contactEmail, reason } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required." });
      return;
    }
    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      let vendor: typeof vendorsTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(vendorsTable)
          .values({
            name: String(name).trim(),
            profile: profile ? String(profile) : null,
            location: location ? String(location) : null,
            contactEmail: contactEmail ? String(contactEmail) : null,
            status: "pending",
            verificationStatus: "not_verified",
            createdByAdminId: req.admin!.id,
          })
          .returning();
        vendor = inserted;

        // Initial status history for newly created vendor
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "vendor",
          recordId: inserted!.id,
          fromStatus: null,
          toStatus: "pending",
          reason: String(reason).trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "vendor.create",
          category: "vendors",
          targetType: "vendor",
          targetId: inserted!.id,
          reason: String(reason).trim(),
          newState: { name: inserted!.name, status: inserted!.status },
          requestId: req.id as string | undefined,
        });
      });

      req.log.info({ vendorId: vendor!.id, adminId: req.admin!.id }, "Admin created vendor");
      res.status(201).json({ message: "Vendor created.", vendor });
    } catch (err) {
      req.log.error({ err }, "admin vendor create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── PATCH /admin/vendors/:id ──────────────────────────────────────────────────

type VendorPatch = {
  updatedAt: Date;
  name?: string;
  profile?: string | null;
  location?: string | null;
  contactEmail?: string | null;
  featured?: boolean;
};

vendorsRouter.patch(
  "/admin/vendors/:id",
  requireAdminPermission("vendors:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const vendorId = paramStr(req, "id");
    if (!vendorId) {
      res.status(400).json({ message: "Missing vendor id." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    const allowed = ["name", "profile", "location", "contactEmail", "featured"] as const;
    const patch: VendorPatch = { updatedAt: new Date() };
    let hasChanges = false;
    for (const key of allowed) {
      if (key in body) {
        (patch as Record<string, unknown>)[key] = body[key];
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      res.status(400).json({ message: "No updatable fields provided." });
      return;
    }

    try {
      const [existing] = await db
        .select({ id: vendorsTable.id, status: vendorsTable.status })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Vendor not found." });
        return;
      }

      await db.transaction(async (tx) => {
        await tx.update(vendorsTable).set(patch).where(eq(vendorsTable.id, vendorId));

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "vendor.edit",
          category: "vendors",
          targetType: "vendor",
          targetId: vendorId,
          reason: String(reason).trim(),
          previousState: { status: existing.status },
          newState: Object.fromEntries(
            Object.entries(patch).filter(([k]) => k !== "updatedAt"),
          ),
          requestId: req.id as string | undefined,
        });
      });

      const [updated] = await db
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);

      res.json({ message: "Vendor updated.", vendor: updated });
    } catch (err) {
      req.log.error({ err, vendorId }, "admin vendor patch failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/vendors/:id/status ────────────────────────────────────────────

vendorsRouter.post(
  "/admin/vendors/:id/status",
  requireAdminPermission("vendors:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const vendorId = paramStr(req, "id");
    const { status, reason } = req.body as { status?: string; reason?: string };

    if (!vendorId) {
      res.status(400).json({ message: "Missing vendor id." });
      return;
    }
    if (!VALID_VENDOR_STATUSES.includes(status as (typeof VALID_VENDOR_STATUSES)[number])) {
      res.status(400).json({
        message: `status must be one of: ${VALID_VENDOR_STATUSES.join(", ")}.`,
      });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: vendorsTable.id, status: vendorsTable.status })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, vendorId))
          .for("update")
          .limit(1);

        if (!existing) return { kind: "not_found" as const };

        await tx
          .update(vendorsTable)
          .set({ status: status!, updatedAt: new Date() })
          .where(eq(vendorsTable.id, vendorId));

        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "vendor",
          recordId: vendorId,
          fromStatus: existing.status,
          toStatus: status!,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `vendor.status.${status}`,
          category: "vendors",
          targetType: "vendor",
          targetId: vendorId,
          reason: reason!.trim(),
          previousState: { status: existing.status },
          newState: { status },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Vendor not found." });
        return;
      }

      req.log.info({ vendorId, status, adminId: req.admin!.id }, "Admin changed vendor status");
      res.json({ message: "Vendor status updated.", vendorId, status });
    } catch (err) {
      req.log.error({ err, vendorId }, "admin vendor status failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/vendors/:id/notes ─────────────────────────────────────────────
// Accepts {note, reason}. Writes note + audit row in one transaction.

vendorsRouter.post(
  "/admin/vendors/:id/notes",
  requireAdminPermission("vendors:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const vendorId = paramStr(req, "id");
    const { note, reason } = req.body as { note?: string; reason?: string };

    if (!vendorId) {
      res.status(400).json({ message: "Missing vendor id." });
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
        .select({ id: vendorsTable.id })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Vendor not found." });
        return;
      }

      let inserted: typeof vendorNotesTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(vendorNotesTable)
          .values({ vendorId, adminId: req.admin!.id, note: note!.trim() })
          .returning();
        inserted = row;

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "vendor.note.add",
          category: "vendors",
          targetType: "vendor",
          targetId: vendorId,
          reason: reason!.trim(),
          newState: { noteId: row?.id, note: note!.trim() },
          requestId: req.id as string | undefined,
        });
      });

      res.status(201).json({ message: "Note added.", note: inserted });
    } catch (err) {
      req.log.error({ err, vendorId }, "admin vendor note failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/vendors/:id/events ────────────────────────────────────────────
// Transactionally inserts event-vendor link + audit row.

// Only an APPROVED vendor may be linked, and only to an event whose lifecycle
// is currently eligible to accept vendors. The server sets the link status
// itself — callers can never forge an arbitrary link state.
const ELIGIBLE_EVENT_STATUSES_FOR_LINK = ["upcoming", "live"] as const;
const SERVER_LINK_STATUS = "approved";

vendorsRouter.post(
  "/admin/vendors/:id/events",
  requireAdminPermission("vendors:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const vendorId = paramStr(req, "id");
    // NOTE: any caller-supplied `status` is intentionally ignored. The link
    // state is fixed server-side to prevent forging arbitrary states.
    const { eventId, booth, reason } = req.body as {
      eventId?: string;
      booth?: string;
      reason?: string;
    };

    if (!vendorId) {
      res.status(400).json({ message: "Missing vendor id." });
      return;
    }
    if (!eventId?.trim()) {
      res.status(400).json({ message: "eventId is required." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const [vendor] = await db
        .select({ id: vendorsTable.id, status: vendorsTable.status })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vendorId))
        .limit(1);

      if (!vendor) {
        res.status(404).json({ message: "Vendor not found." });
        return;
      }

      // Only approved vendors may be linked to events.
      if (vendor.status !== "approved") {
        res.status(409).json({
          message: `Only an approved vendor may be linked to an event. This vendor is "${vendor.status}".`,
        });
        return;
      }

      const [event] = await db
        .select({ id: eventsTable.id, status: eventsTable.status })
        .from(eventsTable)
        .where(eq(eventsTable.id, eventId))
        .limit(1);

      if (!event) {
        res.status(404).json({ message: "Event not found." });
        return;
      }

      // Event lifecycle must be eligible to accept vendors.
      if (
        !ELIGIBLE_EVENT_STATUSES_FOR_LINK.includes(
          event.status as (typeof ELIGIBLE_EVENT_STATUSES_FOR_LINK)[number],
        )
      ) {
        res.status(409).json({
          message: `Vendors can only be linked to events in one of these lifecycle states: ${ELIGIBLE_EVENT_STATUSES_FOR_LINK.join(", ")}. This event is "${event.status}".`,
        });
        return;
      }

      let link: typeof eventVendorsTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(eventVendorsTable)
          .values({
            eventId,
            vendorId,
            booth: booth ?? null,
            // Server-defined link state — never taken from the request body.
            status: SERVER_LINK_STATUS,
          })
          .returning();
        link = row;

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "vendor.event_link",
          category: "vendors",
          targetType: "vendor",
          targetId: vendorId,
          reason: reason!.trim(),
          newState: { eventId, booth: booth ?? null, linkStatus: SERVER_LINK_STATUS },
          requestId: req.id as string | undefined,
        });
      });

      res.status(201).json({ message: "Vendor linked to event.", link });
    } catch (err) {
      req.log.error({ err, vendorId, eventId }, "admin vendor event link failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
