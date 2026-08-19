/**
 * GET /admin/trades — real aggregate counts + explicit unavailable capability declarations.
 *
 * Trade offers, disputes, and offer acceptance are not implemented.
 * These capabilities are listed explicitly as unavailable with honest explanations
 * rather than being silently omitted.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  collectionItemsTable,
  wishlistItemsTable,
  eventParticipantsTable,
  userReportsTable,
} from "@workspace/db";
import { eq, and, isNull, ilike, count } from "drizzle-orm";
import { requireAdminPermission, type AdminRequest } from "../../lib/adminSession.js";

export const tradesRouter = Router();

tradesRouter.get(
  "/admin/trades",
  requireAdminPermission("trust:read"),
  async (req: AdminRequest, res): Promise<void> => {
    try {
      const [forTradeCount, wishlistCount, participationCount, fraudReportCount] =
        await Promise.all([
          db
            .select({ cnt: count() })
            .from(collectionItemsTable)
            .where(eq(collectionItemsTable.isForTrade, true)),
          db
            .select({ cnt: count() })
            .from(wishlistItemsTable)
            .where(isNull(wishlistItemsTable.deletedAt)),
          db
            .select({ cnt: count() })
            .from(eventParticipantsTable)
            .where(
              and(
                isNull(eventParticipantsTable.leftAt),
                eq(eventParticipantsTable.isVisible, true),
              ),
            ),
          db
            .select({ cnt: count() })
            .from(userReportsTable)
            .where(ilike(userReportsTable.reason, "%trade%")),
        ]);

      res.json({
        aggregates: {
          forTradeItems: Number(forTradeCount[0]?.cnt ?? 0),
          activeWishlistItems: Number(wishlistCount[0]?.cnt ?? 0),
          activeEventParticipants: Number(participationCount[0]?.cnt ?? 0),
          tradeFraudReports: Number(fraudReportCount[0]?.cnt ?? 0),
        },
        unavailableCapabilities: {
          tradeOffers: {
            available: false,
            reason:
              "A dedicated trade offer negotiation flow does not exist. Only collection/wishlist matching is supported.",
          },
          disputes: {
            available: false,
            reason: "Trade dispute resolution workflow has not been implemented.",
          },
          offerAcceptance: {
            available: false,
            reason: "Formal offer acceptance/rejection lifecycle is not available.",
          },
        },
      });
    } catch (err) {
      req.log.error({ err }, "admin trades aggregates failed");
      res.status(500).json({ message: "Database error. Please try again." });
    }
  },
);
