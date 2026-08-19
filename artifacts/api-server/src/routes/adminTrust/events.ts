/**
 * GET  /admin/events                                    — paginated list
 * POST /admin/events                                    — create (reason required; transactional)
 * PATCH /admin/events/:id                               — edit fields (reason required; transactional)
 * GET  /admin/events/:id/participants                   — paginated participant list
 * POST /admin/events/:id/lifecycle                      — validated state transition
 * POST /admin/events/:id/participants/:pid/remove       — remove participant (reason required)
 * POST /admin/events/:id/participants/:pid/restore      — restore participant (reason required)
 *
 * Lifecycle: draft→upcoming→live→completed→archived; pause/cancel paths.
 * Transitions to "upcoming" and "live" require BOTH:
 *   - confirmation=CONFIRM
 *   - recent admin authentication (within 10 minutes) — enforced server-side
 * Every mutation persists an audit row in a transaction.
 * Status-bearing mutations also write trust_status_history (domain: event or event_participant).
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { eventsTable, eventParticipantsTable } from "@workspace/db";
import { eq, desc, and, or, ilike, count, sql } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";
import {
  paramStr,
  paginationParams,
  checkRecentAuth,
  writeAudit,
  writeStatusHistory,
} from "./helpers.js";

export const eventsRouter = Router();

const EVENT_TRANSITIONS: Record<string, string[]> = {
  draft: ["upcoming", "cancelled"],
  upcoming: ["live", "cancelled"],
  live: ["completed", "paused", "cancelled"],
  paused: ["live", "cancelled"],
  completed: ["archived"],
  archived: [],
  cancelled: [],
};

// ── Centralized event input validation ───────────────────────────────────────
//
// A single set of validators used by BOTH POST create and PATCH edit so the two
// endpoints can never diverge. Every function returns either a coerced value or
// an { error } object carrying a human-readable 400 message.

const CAPACITY_MAX = 1_000_000; // sensible upper bound for a physical event

/**
 * Runtime-safe IANA timezone validator. Uses Intl.DateTimeFormat, which throws
 * a RangeError for an unknown timeZone. "UTC" is valid; arbitrary text is not.
 */
function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    // Throws RangeError for an invalid/unknown IANA zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

type Omitted = { kind: "omitted" };
type DateValue = { kind: "value"; value: Date | null };
type FieldError = { error: string };

// Strict ISO-8601 instant contract (offset-bearing timestamp).
//
// Accepted form — matching what current clients emit:
//   YYYY-MM-DDTHH:mm:ss[.fff](Z | ±HH:MM)
//     - date and time separated by literal "T"
//     - seconds are REQUIRED
//     - optional fractional seconds of 1-3 digits (milliseconds); 4+ digits
//       are rejected rather than silently truncated
//     - a zone designator is REQUIRED: "Z" or an explicit ±HH:MM offset
//
// This deliberately rejects:
//   - human-readable dates ("March 10, 2026") that new Date() would accept
//   - zone-less local timestamps (ambiguous instant)
//   - calendar-rollover values (e.g. 2026-02-30, month 13, hour 24) that
//     new Date() would normalize into a different, unintended instant
const STRICT_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

const YEAR_MIN = 1970;
const YEAR_MAX = 2100;

function daysInMonth(year: number, month: number): number {
  // month is 1-12. Leap-year aware for February.
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const table = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1]!;
}

/**
 * Strictly parse an offset-bearing ISO-8601 instant into a Date.
 *
 * Validates every captured numeric component BEFORE constructing a Date, so no
 * invalid component is ever normalized away. Returns a Date, or an error string
 * describing the first violation.
 */
function parseStrictIsoInstant(raw: string): Date | { error: string } {
  const m = STRICT_ISO_RE.exec(raw);
  if (!m) {
    return {
      error:
        "must be a strict ISO-8601 instant of the form YYYY-MM-DDTHH:mm:ss[.fff] with a Z or ±HH:MM offset.",
    };
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const fraction = m[7]; // 1-3 digits or undefined
  const zone = m[8]!; // "Z" or ±HH:MM

  if (year < YEAR_MIN || year > YEAR_MAX) {
    return { error: `year must be between ${YEAR_MIN} and ${YEAR_MAX}.` };
  }
  if (month < 1 || month > 12) {
    return { error: "month must be between 01 and 12." };
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return { error: "day is out of range for the given month/year." };
  }
  if (hour > 23) return { error: "hour must be between 00 and 23." };
  if (minute > 59) return { error: "minute must be between 00 and 59." };
  if (second > 59) return { error: "second must be between 00 and 59." };

  // Normalize the optional fraction to exactly 3 digits of milliseconds. The
  // regex already caps at 3 digits, so there is no silent truncation of
  // higher-precision input (that input is rejected above).
  const ms = fraction ? Number(fraction.padEnd(3, "0")) : 0;

  // Zone → offset minutes east of UTC.
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const offHour = Number(zone.slice(1, 3));
    const offMin = Number(zone.slice(4, 6));
    if (offHour > 23) return { error: "timezone offset hour must be between 00 and 23." };
    if (offMin > 59) return { error: "timezone offset minute must be between 00 and 59." };
    offsetMinutes = sign * (offHour * 60 + offMin);
  }

  // Construct the UTC instant from validated components: take the wall-clock
  // time as UTC, then subtract the offset to get the true UTC instant.
  const utcMillis =
    Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60_000;
  return new Date(utcMillis);
}

/**
 * Interpret a single schedule endpoint from a request body.
 *   - key absent               → omitted (fall back to persisted value)
 *   - null | "" (empty)        → explicit clear (Date -> null)
 *   - strict ISO-8601 instant  → Date
 *   - anything else            → error
 */
function readDateField(
  body: Record<string, unknown>,
  key: string,
): Omitted | DateValue | FieldError {
  if (!(key in body)) return { kind: "omitted" };
  const raw = body[key];
  if (raw === null || raw === "") return { kind: "value", value: null };
  if (typeof raw !== "string") {
    return { error: `${key} must be an ISO date string or null.` };
  }
  const parsed = parseStrictIsoInstant(raw);
  if ("error" in parsed) {
    return { error: `${key} ${parsed.error}` };
  }
  return { kind: "value", value: parsed };
}

/**
 * Validate the EFFECTIVE (post-merge) startsAt/endsAt pair.
 *
 * Rules (authoritative instants only; eventDate is a human label and is never
 * compared here — a positive-offset local time may legitimately map to a
 * neighbouring UTC day):
 *   - endsAt requires an effective startsAt.
 *   - endsAt must be strictly after startsAt.
 *   - clearing both endpoints together is allowed.
 */
function validateEffectiveSchedule(
  startsAt: Date | null,
  endsAt: Date | null,
): { error: string } | null {
  if (endsAt && !startsAt) {
    return { error: "endsAt requires a startsAt." };
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { error: "endsAt must be after startsAt." };
  }
  return null;
}

/**
 * Resolve startsAt/endsAt for CREATE. On create there is no persisted state, so
 * an omitted endpoint means null. Validates each endpoint and the effective
 * pair. Returns coerced Dates or an error message.
 */
function resolveCreateSchedule(
  body: Record<string, unknown>,
): { startsAt: Date | null; endsAt: Date | null } | { error: string } {
  const s = readDateField(body, "startsAt");
  if ("error" in s) return { error: s.error };
  const e = readDateField(body, "endsAt");
  if ("error" in e) return { error: e.error };

  const startsAt = s.kind === "omitted" ? null : s.value;
  const endsAt = e.kind === "omitted" ? null : e.value;

  const err = validateEffectiveSchedule(startsAt, endsAt);
  if (err) return err;
  return { startsAt, endsAt };
}

// ── GET /admin/events ─────────────────────────────────────────────────────────

eventsRouter.get(
  "/admin/events",
  requireAdminPermission("events:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);
    const status = q.status?.trim();
    const search = q.search?.trim();

    try {
      const conditions = [];
      if (status) conditions.push(eq(eventsTable.status, status));
      if (search) {
        conditions.push(
          or(
            ilike(eventsTable.name, `%${search}%`),
            ilike(eventsTable.city, `%${search}%`),
            ilike(eventsTable.venue, `%${search}%`),
          )!,
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [totalRow, events] = await Promise.all([
        db.select({ cnt: count() }).from(eventsTable).where(where),
        db
          .select()
          .from(eventsTable)
          .where(where)
          .orderBy(desc(eventsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      res.json({ events, total: Number(totalRow[0]?.cnt ?? 0), page, limit });
    } catch (err) {
      req.log.error({ err }, "admin events list failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/events ────────────────────────────────────────────────────────

eventsRouter.post(
  "/admin/events",
  requireAdminPermission("events:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const {
      name,
      venue,
      city,
      eventDate,
      description,
      address,
      timezone,
      capacity,
      featured,
      reason,
    } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ message: "name is required." });
      return;
    }
    if (!venue || typeof venue !== "string" || !venue.trim()) {
      res.status(400).json({ message: "venue is required." });
      return;
    }
    if (!city || typeof city !== "string" || !city.trim()) {
      res.status(400).json({ message: "city is required." });
      return;
    }
    if (!eventDate || typeof eventDate !== "string" || !eventDate.trim()) {
      res.status(400).json({ message: "eventDate is required." });
      return;
    }
    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    // Parse + validate the optional schedule the UI supplies (omitted → null).
    const schedule = resolveCreateSchedule(body);
    if ("error" in schedule) {
      res.status(400).json({ message: schedule.error });
      return;
    }

    // Timezone: default when omitted/empty; when provided must be a real zone.
    let resolvedTimezone = "Australia/Sydney";
    if (timezone != null && timezone !== "") {
      if (typeof timezone !== "string" || !isValidTimezone(timezone)) {
        res.status(400).json({ message: "timezone must be a valid IANA timezone." });
        return;
      }
      resolvedTimezone = timezone;
    }

    // capacity: allow null/omitted; otherwise a positive integer within bounds.
    // Accept numeric strings from existing UI payloads, but reject junk.
    let resolvedCapacity: number | null = null;
    if (capacity != null && capacity !== "") {
      const capNum =
        typeof capacity === "number"
          ? capacity
          : typeof capacity === "string"
            ? Number(capacity)
            : NaN;
      if (
        !Number.isInteger(capNum) ||
        capNum <= 0 ||
        capNum > CAPACITY_MAX
      ) {
        res.status(400).json({
          message: `capacity must be a positive integer no greater than ${CAPACITY_MAX}.`,
        });
        return;
      }
      resolvedCapacity = capNum;
    }

    // featured: optional; when provided must be a boolean.
    if (featured !== undefined && typeof featured !== "boolean") {
      res.status(400).json({ message: "featured must be a boolean." });
      return;
    }

    // description/address: optional nullable text.
    if (description !== undefined && description !== null && typeof description !== "string") {
      res.status(400).json({ message: "description must be a string or null." });
      return;
    }
    if (address !== undefined && address !== null && typeof address !== "string") {
      res.status(400).json({ message: "address must be a string or null." });
      return;
    }

    try {
      let event: typeof eventsTable.$inferSelect | undefined;

      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(eventsTable)
          .values({
            name: String(name).trim(),
            venue: String(venue).trim(),
            city: String(city).trim(),
            eventDate: String(eventDate).trim(),
            description: description ? String(description) : null,
            address: address ? String(address) : null,
            timezone: resolvedTimezone,
            capacity: resolvedCapacity,
            featured: featured === true,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            status: "draft",
            isActive: false,
            eventModeEnabled: false,
            createdByAdminId: req.admin!.id,
          })
          .returning();
        event = inserted;

        // Initial status history for newly created event
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "event",
          recordId: inserted!.id,
          fromStatus: null,
          toStatus: "draft",
          reason: String(reason).trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "event.create",
          category: "events",
          targetType: "event",
          targetId: inserted!.id,
          reason: String(reason).trim(),
          newState: { name: inserted!.name, status: inserted!.status },
          requestId: req.id as string | undefined,
        });
      });

      req.log.info({ eventId: event!.id, adminId: req.admin!.id }, "Admin created event");
      res.status(201).json({ message: "Event created.", event });
    } catch (err) {
      req.log.error({ err }, "admin event create failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── PATCH /admin/events/:id ───────────────────────────────────────────────────

type EventPatch = {
  updatedAt: Date;
  name?: string;
  venue?: string;
  city?: string;
  eventDate?: string;
  description?: string | null;
  address?: string | null;
  timezone?: string;
  capacity?: number | null;
  featured?: boolean;
  eventModeEnabled?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

eventsRouter.patch(
  "/admin/events/:id",
  requireAdminPermission("events:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const eventId = paramStr(req, "id");
    if (!eventId) {
      res.status(400).json({ message: "Missing event id." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const { reason } = body;

    if (!reason || typeof reason !== "string" || !String(reason).trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    // Fields whose presence in the body signals an intended edit.
    const NON_SCHEDULE_FIELDS = [
      "name", "venue", "city", "eventDate", "description",
      "address", "timezone", "capacity", "featured", "eventModeEnabled",
    ] as const;

    const anyFieldProvided =
      NON_SCHEDULE_FIELDS.some((k) => k in body) ||
      "startsAt" in body ||
      "endsAt" in body;

    if (!anyFieldProvided) {
      res.status(400).json({ message: "No updatable fields provided." });
      return;
    }

    try {
      // Load the FULL existing row first — schedule merging and ordering checks
      // must be evaluated against the persisted counterparts.
      const [existing] = await db
        .select()
        .from(eventsTable)
        .where(eq(eventsTable.id, eventId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ message: "Event not found." });
        return;
      }

      // Build the validated patch. All type/range/schedule validation happens
      // BEFORE any write so a rejected edit leaves the row untouched and writes
      // no audit/history rows.
      const patch: EventPatch = { updatedAt: new Date() };

      // Required text identity/location fields: when provided must be a
      // non-empty string.
      for (const key of ["name", "venue", "city", "eventDate"] as const) {
        if (key in body) {
          const v = body[key];
          if (typeof v !== "string" || v.trim() === "") {
            res.status(400).json({ message: `${key} must be a non-empty string.` });
            return;
          }
          patch[key] = v.trim();
        }
      }

      // Nullable text fields: string or explicit null.
      for (const key of ["description", "address"] as const) {
        if (key in body) {
          const v = body[key];
          if (v === null) {
            patch[key] = null;
          } else if (typeof v === "string") {
            patch[key] = v;
          } else {
            res.status(400).json({ message: `${key} must be a string or null.` });
            return;
          }
        }
      }

      // timezone: when provided must be a real IANA zone.
      if ("timezone" in body) {
        const tz = body.timezone;
        if (typeof tz !== "string" || !isValidTimezone(tz)) {
          res.status(400).json({ message: "timezone must be a valid IANA timezone." });
          return;
        }
        patch.timezone = tz;
      }

      // capacity: null or a positive integer within bounds.
      if ("capacity" in body) {
        const cap = body.capacity;
        if (cap === null) {
          patch.capacity = null;
        } else {
          const capNum =
            typeof cap === "number"
              ? cap
              : typeof cap === "string" && cap !== ""
                ? Number(cap)
                : NaN;
          if (!Number.isInteger(capNum) || capNum <= 0 || capNum > CAPACITY_MAX) {
            res.status(400).json({
              message: `capacity must be null or a positive integer no greater than ${CAPACITY_MAX}.`,
            });
            return;
          }
          patch.capacity = capNum;
        }
      }

      // Boolean flags.
      for (const key of ["featured", "eventModeEnabled"] as const) {
        if (key in body) {
          if (typeof body[key] !== "boolean") {
            res.status(400).json({ message: `${key} must be a boolean.` });
            return;
          }
          patch[key] = body[key] as boolean;
        }
      }

      // Schedule: merge provided endpoints with persisted counterparts. An
      // omitted endpoint keeps the persisted value; explicit null/"" clears it.
      const startField = readDateField(body, "startsAt");
      if ("error" in startField) {
        res.status(400).json({ message: startField.error });
        return;
      }
      const endField = readDateField(body, "endsAt");
      if ("error" in endField) {
        res.status(400).json({ message: endField.error });
        return;
      }

      if (startField.kind === "value" || endField.kind === "value") {
        const effectiveStart =
          startField.kind === "value" ? startField.value : existing.startsAt;
        const effectiveEnd =
          endField.kind === "value" ? endField.value : existing.endsAt;

        const scheduleErr = validateEffectiveSchedule(effectiveStart, effectiveEnd);
        if (scheduleErr) {
          res.status(400).json({ message: scheduleErr.error });
          return;
        }

        // Store coerced Date/null values only (never raw strings). Only assign
        // the endpoints that were explicitly provided so partial edits stay
        // partial.
        if (startField.kind === "value") patch.startsAt = startField.value;
        if (endField.kind === "value") patch.endsAt = endField.value;
      }

      await db.transaction(async (tx) => {
        await tx.update(eventsTable).set(patch).where(eq(eventsTable.id, eventId));

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "event.edit",
          category: "events",
          targetType: "event",
          targetId: eventId,
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
        .from(eventsTable)
        .where(eq(eventsTable.id, eventId))
        .limit(1);

      req.log.info({ eventId, adminId: req.admin!.id }, "Admin patched event");
      res.json({ message: "Event updated.", event: updated });
    } catch (err) {
      req.log.error({ err, eventId }, "admin event patch failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── GET /admin/events/:id/participants ────────────────────────────────────────

eventsRouter.get(
  "/admin/events/:id/participants",
  requireAdminPermission("events:read"),
  async (req: AdminRequest, res): Promise<void> => {
    const eventId = paramStr(req, "id");
    const q = req.query as Record<string, string | undefined>;
    const { page, limit, offset } = paginationParams(q);

    if (!eventId) {
      res.status(400).json({ message: "Missing event id." });
      return;
    }

    try {
      const [exists] = await db
        .select({ id: eventsTable.id })
        .from(eventsTable)
        .where(eq(eventsTable.id, eventId))
        .limit(1);

      if (!exists) {
        res.status(404).json({ message: "Event not found." });
        return;
      }

      const [analyticsRow, participants] = await Promise.all([
        db
          .select({
            totalRecords: count(),
            // Active = still participating: not left, visible, status "participating".
            activeParticipants: sql<number>`COUNT(*) FILTER (WHERE ${eventParticipantsTable.leftAt} IS NULL AND ${eventParticipantsTable.isVisible} = true AND ${eventParticipantsTable.participationStatus} = 'participating')`,
            // Removed = admin-removed participation rows.
            removedParticipants: sql<number>`COUNT(*) FILTER (WHERE ${eventParticipantsTable.participationStatus} = 'removed')`,
            // Left = the user left themselves (leftAt set) but was not admin-removed.
            leftParticipants: sql<number>`COUNT(*) FILTER (WHERE ${eventParticipantsTable.leftAt} IS NOT NULL AND ${eventParticipantsTable.participationStatus} <> 'removed')`,
          })
          .from(eventParticipantsTable)
          .where(eq(eventParticipantsTable.eventId, eventId)),
        db
          .select({
            id: eventParticipantsTable.id,
            userId: eventParticipantsTable.userId,
            joinedAt: eventParticipantsTable.joinedAt,
            leftAt: eventParticipantsTable.leftAt,
            isVisible: eventParticipantsTable.isVisible,
            participationStatus: eventParticipantsTable.participationStatus,
            removalReason: eventParticipantsTable.removalReason,
            removedByAdminId: eventParticipantsTable.removedByAdminId,
            userDisplayName: sql<string | null>`(SELECT display_name FROM users WHERE id = ${eventParticipantsTable.userId} LIMIT 1)`,
            userUsername: sql<string | null>`(SELECT username FROM users WHERE id = ${eventParticipantsTable.userId} LIMIT 1)`,
          })
          .from(eventParticipantsTable)
          .where(eq(eventParticipantsTable.eventId, eventId))
          .orderBy(desc(eventParticipantsTable.joinedAt))
          .limit(limit)
          .offset(offset),
      ]);

      const a = analyticsRow[0];
      const total = Number(a?.totalRecords ?? 0);

      res.json({
        participants,
        total,
        page,
        limit,
        // Analytics derived strictly from participation rows — these are
        // self-reported participation records, NOT verified attendance.
        analytics: {
          totalRecords: total,
          activeParticipants: Number(a?.activeParticipants ?? 0),
          removedParticipants: Number(a?.removedParticipants ?? 0),
          leftParticipants: Number(a?.leftParticipants ?? 0),
          note: "Counts are derived from participation records (users who joined the event); they are not verified attendance.",
          attendanceVerification: {
            available: false,
            reason:
              "No attendance verification signal (check-in, ticket scan, or geofence confirmation) is captured; participation rows only reflect users who joined the event.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err, eventId }, "admin event participants failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/events/:id/lifecycle ─────────────────────────────────────────
//
// Transitions to "upcoming" or "live" require BOTH:
//   1. confirmation === "CONFIRM"
//   2. recent admin authentication (within 10-minute window) — enforced server-side

eventsRouter.post(
  "/admin/events/:id/lifecycle",
  requireAdminPermission("events:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const eventId = paramStr(req, "id");
    const { toStatus, reason, confirmation } = req.body as {
      toStatus?: string;
      reason?: string;
      confirmation?: string;
    };

    if (!eventId) {
      res.status(400).json({ message: "Missing event id." });
      return;
    }
    if (!toStatus?.trim()) {
      res.status(400).json({ message: "toStatus is required." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    // upcoming/live require CONFIRM token
    if (["live", "upcoming"].includes(toStatus) && confirmation !== "CONFIRM") {
      res.status(400).json({
        message: `Confirm lifecycle transition to ${toStatus} by setting confirmation to CONFIRM.`,
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }

    // upcoming/live additionally require recent admin auth — enforced server-side
    if (["live", "upcoming"].includes(toStatus) && !checkRecentAuth(req)) {
      res.status(403).json({
        message:
          "Confirm your password before publishing or going live with an event.",
        code: "RECENT_AUTH_REQUIRED",
      });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [event] = await tx
          .select()
          .from(eventsTable)
          .where(eq(eventsTable.id, eventId))
          .for("update")
          .limit(1);

        if (!event) return { kind: "not_found" as const };

        const allowed = EVENT_TRANSITIONS[event.status] ?? [];
        if (!allowed.includes(toStatus)) {
          return {
            kind: "invalid_transition" as const,
            fromStatus: event.status,
            allowed,
          };
        }

        if (
          ["upcoming", "live"].includes(toStatus) &&
          (
            !event.name?.trim() ||
            !event.venue?.trim() ||
            !event.city?.trim() ||
            !event.eventDate?.trim()
          )
        ) {
          return { kind: "publish_validation_failed" as const };
        }

        const isActive = ["upcoming", "live", "paused"].includes(toStatus);
        const eventModeEnabled = ["upcoming", "live"].includes(toStatus);
        const publishedAt =
          toStatus === "upcoming" && !event.publishedAt ? new Date() : event.publishedAt;

        await tx
          .update(eventsTable)
          .set({
            status: toStatus,
            isActive,
            eventModeEnabled,
            publishedAt: publishedAt ?? null,
            updatedAt: new Date(),
          })
          .where(eq(eventsTable.id, eventId));

        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "event",
          recordId: eventId,
          fromStatus: event.status,
          toStatus,
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: `event.lifecycle.${toStatus}`,
          category: "events",
          severity: ["live", "cancelled"].includes(toStatus) ? "high" : "info",
          targetType: "event",
          targetId: eventId,
          reason: reason!.trim(),
          previousState: { status: event.status, isActive: event.isActive },
          newState: { status: toStatus, isActive, eventModeEnabled },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const, fromStatus: event.status };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Event not found." });
        return;
      }
      if (result.kind === "invalid_transition") {
        res.status(400).json({
          message: `Cannot transition event from ${result.fromStatus} to ${toStatus}. Allowed: ${result.allowed.join(", ") || "none"}.`,
          code: "INVALID_TRANSITION",
        });
        return;
      }
      if (result.kind === "publish_validation_failed") {
        res.status(400).json({
          message: "Event requires name, venue, city, and eventDate before publishing.",
          code: "PUBLISH_VALIDATION_FAILED",
        });
        return;
      }

      req.log.info(
        { eventId, fromStatus: result.fromStatus, toStatus, adminId: req.admin!.id },
        "Admin performed event lifecycle transition",
      );
      res.json({ message: "Event status updated.", eventId, status: toStatus });
    } catch (err) {
      req.log.error({ err, eventId }, "admin event lifecycle failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/events/:id/participants/:participantId/remove ─────────────────

eventsRouter.post(
  "/admin/events/:id/participants/:participantId/remove",
  requireAdminPermission("events:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const eventId = paramStr(req, "id");
    const participantId = paramStr(req, "participantId");
    const { reason } = req.body as { reason?: string };

    if (!eventId || !participantId) {
      res.status(400).json({ message: "Missing event or participant id." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [participant] = await tx
          .select()
          .from(eventParticipantsTable)
          .where(
            and(
              eq(eventParticipantsTable.id, participantId),
              eq(eventParticipantsTable.eventId, eventId),
            ),
          )
          .for("update")
          .limit(1);

        if (!participant) return { kind: "not_found" as const };

        await tx
          .update(eventParticipantsTable)
          .set({
            isVisible: false,
            leftAt: new Date(),
            participationStatus: "removed",
            removalReason: reason!.trim(),
            removedByAdminId: req.admin!.id,
          })
          .where(eq(eventParticipantsTable.id, participantId));

        // Status history for participant status change
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "event_participant",
          recordId: participantId,
          fromStatus: participant.participationStatus ?? null,
          toStatus: "removed",
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "event.participant.remove",
          category: "events",
          targetType: "event_participant",
          targetId: participantId,
          reason: reason!.trim(),
          previousState: { participationStatus: participant.participationStatus },
          newState: { participationStatus: "removed" },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Participant not found." });
        return;
      }

      res.json({ message: "Participant removed.", participantId });
    } catch (err) {
      req.log.error({ err, eventId, participantId }, "admin event participant remove failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);

// ── POST /admin/events/:id/participants/:participantId/restore ────────────────

eventsRouter.post(
  "/admin/events/:id/participants/:participantId/restore",
  requireAdminPermission("events:manage"),
  async (req: AdminRequest, res): Promise<void> => {
    const eventId = paramStr(req, "id");
    const participantId = paramStr(req, "participantId");
    const { reason } = req.body as { reason?: string };

    if (!eventId || !participantId) {
      res.status(400).json({ message: "Missing event or participant id." });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ message: "A non-empty reason is required." });
      return;
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [participant] = await tx
          .select()
          .from(eventParticipantsTable)
          .where(
            and(
              eq(eventParticipantsTable.id, participantId),
              eq(eventParticipantsTable.eventId, eventId),
            ),
          )
          .for("update")
          .limit(1);

        if (!participant) return { kind: "not_found" as const };

        await tx
          .update(eventParticipantsTable)
          .set({
            isVisible: true,
            leftAt: null,
            participationStatus: "participating",
            removalReason: null,
            removedByAdminId: null,
          })
          .where(eq(eventParticipantsTable.id, participantId));

        // Status history for participant restore
        await writeStatusHistory(tx as unknown as typeof db, {
          domain: "event_participant",
          recordId: participantId,
          fromStatus: participant.participationStatus ?? null,
          toStatus: "participating",
          reason: reason!.trim(),
          adminId: req.admin!.id,
        });

        await writeAudit(tx as unknown as typeof db, {
          adminId: req.admin!.id,
          adminSessionId: req.adminSession?.id,
          action: "event.participant.restore",
          category: "events",
          targetType: "event_participant",
          targetId: participantId,
          reason: reason!.trim(),
          previousState: { participationStatus: participant.participationStatus },
          newState: { participationStatus: "participating" },
          requestId: req.id as string | undefined,
        });

        return { kind: "updated" as const };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ message: "Participant not found." });
        return;
      }

      res.json({ message: "Participant restored.", participantId });
    } catch (err) {
      req.log.error({ err, eventId, participantId }, "admin event participant restore failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
