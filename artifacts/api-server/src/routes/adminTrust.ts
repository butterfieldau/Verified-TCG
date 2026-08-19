/**
 * Admin Trust Operations — aggregator.
 *
 * Mounts the session + CSRF guard once, then delegates to focused sub-routers.
 * The import path in routes/index.ts stays stable: import adminTrustRouter from "./adminTrust".
 *
 * Routes covered:
 *  GET  /admin/operations/summary
 *  GET  /admin/activity
 *  GET  /admin/community/posts
 *  GET  /admin/community/blocks
 *  POST /admin/community/posts/:id/moderate
 *  GET  /admin/reports
 *  GET  /admin/reports/:id
 *  POST /admin/reports/:id/assign
 *  POST /admin/reports/:id/notes
 *  POST /admin/reports/:id/outcome
 *  POST /admin/reports/:id/suspend-user
 *  GET  /admin/events
 *  POST /admin/events
 *  PATCH /admin/events/:id
 *  GET  /admin/events/:id/participants
 *  POST /admin/events/:id/lifecycle
 *  POST /admin/events/:id/participants/:participantId/remove
 *  POST /admin/events/:id/participants/:participantId/restore
 *  GET  /admin/vendors
 *  POST /admin/vendors
 *  PATCH /admin/vendors/:id
 *  POST /admin/vendors/:id/status
 *  POST /admin/vendors/:id/notes
 *  POST /admin/vendors/:id/events
 *  GET  /admin/trades
 *  GET  /admin/certifications
 *  POST /admin/certifications
 *  GET  /admin/certifications/:id
 *  POST /admin/certifications/:id/notes
 *  POST /admin/certifications/:id/status
 *  GET  /admin/drops
 *  POST /admin/drops
 *  PATCH /admin/drops/:id
 *  POST /admin/drops/:id/status
 */

import { Router } from "express";
import { requireAdminSession, requireAdminCsrf } from "../lib/adminSession.js";
import { operationsRouter } from "./adminTrust/operations.js";
import { communityRouter } from "./adminTrust/community.js";
import { reportsRouter } from "./adminTrust/reports.js";
import { eventsRouter } from "./adminTrust/events.js";
import { vendorsRouter } from "./adminTrust/vendors.js";
import { tradesRouter } from "./adminTrust/trades.js";
import { certificationsRouter } from "./adminTrust/certifications.js";
import { dropsRouter } from "./adminTrust/drops.js";

const router = Router();

// Single session + CSRF guard for all trust operation routes
router.use("/admin", requireAdminSession, requireAdminCsrf);

router.use(operationsRouter);
router.use(communityRouter);
router.use(reportsRouter);
router.use(eventsRouter);
router.use(vendorsRouter);
router.use(tradesRouter);
router.use(certificationsRouter);
router.use(dropsRouter);

export default router;
