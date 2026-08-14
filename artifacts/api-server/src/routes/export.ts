/**
 * Data export endpoints — requires JWT auth.
 *
 *   GET /api/me/export/collection.csv  — collection as CSV
 *   GET /api/me/export/account.json    — full account data as JSON
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { collectionItemsTable, usersTable, wishlistItemsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const exportRouter = Router();

// ── GET /api/me/export/collection.csv ────────────────────────────────────────

exportRouter.get(
  "/me/export/collection.csv",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    try {
      const rows = await db
        .select()
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!))
        .orderBy(collectionItemsTable.createdAt);

      const csvRows: string[] = [
        // Header
        [
          "Card Name",
          "Set",
          "Number",
          "TCG",
          "Rarity",
          "Condition",
          "Graded",
          "Grade Company",
          "Grade",
          "Quantity",
          "Acquired Date",
          "Purchase Price (AUD)",
          "Current Raw Value (AUD)",
          "For Sale",
          "For Trade",
          "Notes",
        ]
          .map(escCsv)
          .join(","),
      ];

      for (const row of rows) {
        const card = (row.cardData ?? {}) as Record<string, any>;
        const grading = row.gradingData as Record<string, any> | null;
        const price = card?.price ?? {};

        csvRows.push(
          [
            card?.name ?? "",
            card?.setName ?? "",
            card?.number ?? "",
            card?.tcg ?? "",
            card?.rarity ?? "",
            row.condition ?? "",
            row.isGraded ? "Yes" : "No",
            grading?.company ?? "",
            grading?.grade ?? "",
            row.quantity,
            row.acquiredAt ?? "",
            (row.acquiredPriceCents / 100).toFixed(2),
            price?.raw != null ? Number(price.raw).toFixed(2) : "",
            row.isForSale ? "Yes" : "No",
            row.isForTrade ? "Yes" : "No",
            row.notes ?? "",
          ]
            .map(escCsv)
            .join(","),
        );
      }

      const csv = csvRows.join("\r\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="collection.csv"',
      );
      res.send(csv);
    } catch (err) {
      console.error("[export] GET /api/me/export/collection.csv:", err);
      res.status(500).json({ message: "Failed to export collection" });
    }
  },
);

// ── GET /api/me/export/account.json ──────────────────────────────────────────

exportRouter.get(
  "/me/export/account.json",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          displayName: usersTable.displayName,
          username: usersTable.username,
          bio: usersTable.bio,
          location: usersTable.location,
          subscriptionTier: usersTable.subscriptionTier,
          isFoundingMember: usersTable.isFoundingMember,
          favouriteTcg: usersTable.favouriteTcg,
          collectorSince: usersTable.collectorSince,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, req.userId!))
        .limit(1);

      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }

      const collectionRows = await db
        .select()
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!))
        .orderBy(collectionItemsTable.createdAt);

      const wishlistRows = await db
        .select()
        .from(wishlistItemsTable)
        .where(
          eq(wishlistItemsTable.userId, req.userId!),
        )
        .orderBy(wishlistItemsTable.createdAt);

      const activeWishlist = wishlistRows.filter((r) => !r.deletedAt);

      const payload = {
        exportedAt: new Date().toISOString(),
        profile: user,
        collection: collectionRows.map((r) => ({
          id: r.id,
          cardId: r.cardId,
          card: r.cardData,
          quantity: r.quantity,
          condition: r.condition,
          grading: r.gradingData,
          acquiredAt: r.acquiredAt,
          acquiredPrice: r.acquiredPriceCents / 100,
          currency: "AUD",
          notes: r.notes,
          isForSale: r.isForSale,
          isForTrade: r.isForTrade,
          addedAt: r.createdAt,
        })),
        wishlist: activeWishlist.map((r) => ({
          id: r.id,
          cardId: r.cardId,
          card: r.cardData,
          desiredGrade: r.desiredGrade,
          targetPrice:
            r.targetPrice != null ? r.targetPrice / 100 : null,
          currency: "AUD",
          priceAlertEnabled: r.priceAlertEnabled,
          addedAt: r.addedAt,
        })),
      };

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="account-data.json"',
      );
      res.json(payload);
    } catch (err) {
      console.error("[export] GET /api/me/export/account.json:", err);
      res.status(500).json({ message: "Failed to export account data" });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function escCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Wrap in quotes if the value contains commas, quotes, or newlines
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export default exportRouter;
