/**
 * Data export endpoints — requires JWT auth.
 *
 *   GET /api/me/export/collection.csv  — collection as CSV
 *   GET /api/me/export/account.json    — full account data as JSON
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  collectionItemsTable,
  collectionListItemsTable,
  collectionListsTable,
  usersTable,
  wishlistItemsTable,
} from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireProUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  COLLECTION_ORGANIZATION_SCHEMA_VERSION,
  VERIFIED_TCG_V2_HEADERS,
} from "./collectionImport.js";

const exportRouter = Router();

// ── GET /api/me/export/collection.csv ────────────────────────────────────────

exportRouter.get(
  "/me/export/collection.csv",
  requireProUser,
  async (req: AuthRequest, res) => {
    try {
      const requestedVersion = String(req.query["version"] ?? "1");
      if (!["1", String(COLLECTION_ORGANIZATION_SCHEMA_VERSION)].includes(requestedVersion)) {
        res.status(400).json({ message: "Unsupported collection CSV version" });
        return;
      }
      const rows = await db
        .select()
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!))
        .orderBy(collectionItemsTable.createdAt);

      if (requestedVersion === String(COLLECTION_ORGANIZATION_SCHEMA_VERSION)) {
        const [lists, memberships] = await Promise.all([
          db
            .select()
            .from(collectionListsTable)
            .where(eq(collectionListsTable.userId, req.userId!))
            .orderBy(asc(collectionListsTable.position), asc(collectionListsTable.createdAt)),
          db
            .select({
              collectionItemId: collectionListItemsTable.collectionItemId,
              listId: collectionListItemsTable.listId,
            })
            .from(collectionListItemsTable)
            .where(eq(collectionListItemsTable.userId, req.userId!)),
        ]);
        const listById = new Map(lists.map((list) => [list.id, list]));
        const listNamesByHolding = new Map<string, string[]>();
        for (const membership of memberships) {
          const list = listById.get(membership.listId);
          if (!list) continue;
          const names = listNamesByHolding.get(membership.collectionItemId) ?? [];
          names.push(list.name);
          listNamesByHolding.set(membership.collectionItemId, names);
        }

        const csvRows = [VERIFIED_TCG_V2_HEADERS.map(escCsv).join(",")];
        for (const list of lists) {
          csvRows.push(v2CsvRow({
            "Verified TCG CSV Version": COLLECTION_ORGANIZATION_SCHEMA_VERSION,
            Source: "Verified TCG",
            "Record Type": "list",
            "List Name": list.name,
            "List Position": list.position,
          }));
        }
        for (const row of rows) {
          const card = (row.cardData ?? {}) as Record<string, any>;
          const grading = row.gradingData as Record<string, any> | null;
          csvRows.push(v2CsvRow({
            "Verified TCG CSV Version": COLLECTION_ORGANIZATION_SCHEMA_VERSION,
            Source: "Verified TCG",
            "Record Type": "holding",
            "Holding ID": row.id,
            "Card ID": row.cardId,
            "Card Name": card?.name ?? "",
            TCG: card?.tcg ?? "",
            Set: card?.setName ?? "",
            "Set Code": card?.setCode ?? "",
            "Card Number": card?.number ?? "",
            Rarity: card?.rarity ?? "",
            Finish: card?.finish ?? card?.variance ?? (card?.isFoil ? "Foil" : "Normal"),
            Condition: row.condition ?? "",
            Graded: row.isGraded ? "Yes" : "No",
            "Grade Company": grading?.company ?? "",
            Grade: grading?.grade ?? "",
            "Grade Designation": grading?.designation ?? "",
            "Grade Original": grading?.original ?? "",
            "Certificate Number": grading?.certNumber ?? "",
            "Graded Date": grading?.gradedAt ?? "",
            Quantity: row.quantity,
            "Acquired Date": row.acquiredAt ?? "",
            "Acquisition Currency": row.acquiredCurrency ?? "AUD",
            "Acquisition Unit Price": (row.acquiredPriceCents / 100).toFixed(2),
            "For Sale": row.isForSale ? "Yes" : "No",
            "For Trade": row.isForTrade ? "Yes" : "No",
            Notes: row.notes ?? "",
            "List Names": JSON.stringify(listNamesByHolding.get(row.id) ?? []),
          }));
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="collection-with-lists.csv"',
        );
        res.send(csvRows.join("\r\n"));
        return;
      }

      const csvRows: string[] = [
        // Stable v1 import/export contract. New versions must use a new version
        // value and remain explicitly detected by the importer.
        [
          "Verified TCG CSV Version",
          "Source",
          "Card ID",
          "Card Name",
          "TCG",
          "Set",
          "Set Code",
          "Card Number",
          "Rarity",
          "Finish",
          "Condition",
          "Graded",
          "Grade Company",
          "Grade",
          "Grade Designation",
          "Grade Original",
          "Certificate Number",
          "Graded Date",
          "Quantity",
          "Acquired Date",
          "Acquisition Currency",
          "Acquisition Unit Price",
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

        csvRows.push(
          [
            "1",
            "Verified TCG",
            row.cardId,
            card?.name ?? "",
            card?.tcg ?? "",
            card?.setName ?? "",
            card?.setCode ?? "",
            card?.number ?? "",
            card?.rarity ?? "",
            card?.finish ?? card?.variance ?? (card?.isFoil ? "Foil" : "Normal"),
            row.condition ?? "",
            row.isGraded ? "Yes" : "No",
            grading?.company ?? "",
            grading?.grade ?? "",
            grading?.designation ?? "",
            grading?.original ?? "",
            grading?.certNumber ?? "",
            grading?.gradedAt ?? "",
            row.quantity,
            row.acquiredAt ?? "",
            row.acquiredCurrency ?? "AUD",
            (row.acquiredPriceCents / 100).toFixed(2),
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
      req.log?.error({ err }, "Collection CSV export failed");
      res.status(500).json({ message: "Failed to export collection" });
    }
  },
);

// ── GET /api/me/export/account.json ──────────────────────────────────────────

exportRouter.get(
  "/me/export/account.json",
  requireProUser,
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
          currency: r.acquiredCurrency ?? "AUD",
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
      req.log?.error({ err }, "Account export failed");
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

function v2CsvRow(values: Partial<Record<(typeof VERIFIED_TCG_V2_HEADERS)[number], unknown>>): string {
  return VERIFIED_TCG_V2_HEADERS.map((header) => escCsv(values[header])).join(",");
}

export default exportRouter;
