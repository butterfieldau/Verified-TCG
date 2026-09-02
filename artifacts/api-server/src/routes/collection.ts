import { Router } from "express";
import { db } from "@workspace/db";
import {
  collectionItemsTable,
  collectionListItemsTable,
  collectionListsTable,
  collectionPreferencesTable,
} from "@workspace/db";
import { eq, and, asc, inArray, sql } from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { logActivity, logActivitySafely } from "./activity.js";
import { calculatePortfolioValuation } from "../pricing/portfolio.js";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LISTS = 100;
const MAX_MEMBERSHIP_MUTATION = 500;
const VALID_VIEW_MODES = new Set(["grid", "list", "compact"]);
const VALID_SORT_KEYS = new Set([
  "date_desc", "date_asc", "name_asc", "name_desc", "value_desc", "value_asc",
  "quantity_desc", "quantity_asc", "gain_desc", "gain_asc",
]);

function validIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= MAX_MEMBERSHIP_MUTATION
    && new Set(value).size === value.length
    && value.every(id => typeof id === "string" && UUID_RE.test(id));
}

function preferencesResponse(row: typeof collectionPreferencesTable.$inferSelect | undefined) {
  return row ? {
    viewMode: row.viewMode,
    selectedListId: row.selectedListId,
    filterState: row.filterState,
    sortKey: row.sortKey,
    updatedAt: row.updatedAt.toISOString(),
  } : { viewMode: "grid", selectedListId: null, filterState: {}, sortKey: "date_desc", updatedAt: null };
}

async function collectionOrganization(userId: string) {
  const [lists, memberships, preferences] = await Promise.all([
    db.select().from(collectionListsTable).where(eq(collectionListsTable.userId, userId))
      .orderBy(asc(collectionListsTable.position), asc(collectionListsTable.createdAt)),
    db.select({
      listId: collectionListItemsTable.listId,
      collectionItemId: collectionListItemsTable.collectionItemId,
    }).from(collectionListItemsTable)
      .innerJoin(collectionListsTable, eq(collectionListItemsTable.listId, collectionListsTable.id))
      .where(eq(collectionListsTable.userId, userId)),
    db.select().from(collectionPreferencesTable).where(eq(collectionPreferencesTable.userId, userId)).limit(1),
  ]);
  const itemIdsByList = new Map<string, string[]>();
  for (const membership of memberships) {
    const ids = itemIdsByList.get(membership.listId) ?? [];
    ids.push(membership.collectionItemId);
    itemIdsByList.set(membership.listId, ids);
  }
  return {
    lists: lists.map(list => ({
      id: list.id, name: list.name, position: list.position,
      createdAt: list.createdAt.toISOString(), updatedAt: list.updatedAt.toISOString(),
      holdingIds: itemIdsByList.get(list.id) ?? [],
    })),
    preferences: preferencesResponse(preferences[0]),
  };
}

async function ownsList(userId: string, listId: string) {
  const [list] = await db.select({ id: collectionListsTable.id }).from(collectionListsTable)
    .where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, userId))).limit(1);
  return Boolean(list);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a DB row back to the CollectionItem shape the mobile app expects. */
function rowToItem(
  row: typeof collectionItemsTable.$inferSelect,
  valuation?: {
    priceCents: number;
    currency: string;
    gradeKey: string;
    fetchedAt: Date;
    costBasisCents: number | null;
    gainCents: number | null;
  } | null,
) {
  return {
    id: row.id,
    cardId: row.cardId,
    card: row.cardData,
    quantity: row.quantity,
    condition: row.condition,
    grading: row.gradingData ?? undefined,
    acquiredAt: row.acquiredAt,
    acquiredPrice: row.acquiredPriceCents / 100,
    // Preserve acquisition currency (defaults AUD for legacy rows)
    currency: (row.acquiredCurrency ?? "AUD") as string,
    notes: row.notes ?? undefined,
    isForSale: row.isForSale,
    isForTrade: row.isForTrade,
    // Valuation from PriceCharting (nullable — never zero when missing)
    valuation: valuation
      ? {
          priceCents: valuation.priceCents,
          price: valuation.priceCents / 100,
          currency: valuation.currency,
          gradeKey: valuation.gradeKey,
          updatedAt: valuation.fetchedAt.toISOString(),
           costBasis: valuation.costBasisCents == null ? null : valuation.costBasisCents / 100,
           gain: valuation.gainCents == null ? null : valuation.gainCents / 100,
           gainPercent:
             valuation.gainCents != null && valuation.costBasisCents != null && valuation.costBasisCents > 0
               ? (valuation.gainCents / valuation.costBasisCents) * 100
               : null,
        }
      : null,
  };
}

// ── GET /api/collection ───────────────────────────────────────────────────────

router.get("/collection", requireActiveUser, async (req: AuthRequest, res) => {
  const pageParam = req.query["page"];
  const limitParam = req.query["limit"];

  // Paginated mode when either param is provided
  const isPaginated = pageParam !== undefined || limitParam !== undefined;
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" && /^[A-Za-z]{3}$/.test(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  const valuationMap = async (rowIds?: string[]) => {
    const portfolio = await calculatePortfolioValuation(req.userId!, displayCurrency, rowIds);
    return new Map(portfolio.holdings.map(holding => [
      holding.row.id,
      holding.currentValueCents != null && holding.quote && holding.gradeKey
        ? {
            priceCents: Math.round(holding.currentValueCents / holding.row.quantity),
            currency: displayCurrency,
            gradeKey: holding.gradeKey,
            fetchedAt: holding.quote.fetchedAt,
            costBasisCents:
              holding.costBasisCents == null
                ? null
                : Math.round(holding.costBasisCents / holding.row.quantity),
            gainCents:
              holding.unrealizedGainCents == null
                ? null
                : Math.round(holding.unrealizedGainCents / holding.row.quantity),
          }
        : null,
    ]));
  };

  if (isPaginated) {
    const limit = Math.min(Math.max(parseInt(String(limitParam ?? "20"), 10) || 20, 1), 100);
    const page = Math.max(parseInt(String(pageParam ?? "1"), 10) || 1, 1);
    const offset = (page - 1) * limit;

    const [countResult, rows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!)),
      db
        .select()
        .from(collectionItemsTable)
        .where(eq(collectionItemsTable.userId, req.userId!))
        .orderBy(collectionItemsTable.createdAt)
        .limit(limit)
        .offset(offset),
    ]);

    const total = countResult[0]?.count ?? 0;

    const valuationById = await valuationMap(rows.map(row => row.id));
    return res.json({
      items: rows.map(row => rowToItem(row, valuationById.get(row.id) ?? null)),
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    });
  }

  // Non-paginated (backward-compatible) — return full list as array
  const rows = await db
    .select()
    .from(collectionItemsTable)
    .where(eq(collectionItemsTable.userId, req.userId!))
    .orderBy(collectionItemsTable.createdAt);

  const valuationById = await valuationMap();
  return res.json(rows.map(row => rowToItem(row, valuationById.get(row.id) ?? null)));
});

// ── Validation helpers ────────────────────────────────────────────────────────

// Must match CardCondition in artifacts/verified-tcg/types/index.ts
const VALID_CONDITIONS = new Set([
  "mint", "near_mint", "excellent", "good", "light_played", "played", "poor",
]);

function isValidDateString(s: string): boolean {
  // Accept ISO date (YYYY-MM-DD) or ISO datetime
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s));
}

function validatePostBody(body: Record<string, unknown>): string | null {
  if (!body.cardId || typeof body.cardId !== "string") return "cardId is required";
  if (!body.card || typeof body.card !== "object") return "card object is required";
  if (!body.acquiredAt || typeof body.acquiredAt !== "string") return "acquiredAt is required";
  if (!isValidDateString(body.acquiredAt)) return "acquiredAt must be a valid ISO date string";

  const qty = body.quantity as number | undefined;
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999)
      return "quantity must be a positive integer between 1 and 9999";
  }

  const price = body.acquiredPrice as number | undefined;
  if (price !== undefined) {
    if (!Number.isFinite(price) || price < 0)
      return "acquiredPrice must be a non-negative finite number";
  }

  const cond = body.condition as string | undefined;
  if (cond !== undefined && !VALID_CONDITIONS.has(cond))
    return `condition must be one of: ${[...VALID_CONDITIONS].join(", ")}`;

  const notes = body.notes as string | undefined;
  if (notes !== undefined && notes.length > 2000)
    return "notes must not exceed 2000 characters";

  const currency = body.currency as string | undefined;
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency))
    return "currency must be a 3-letter ISO currency code";

  return null;
}

function validatePatchBody(body: Record<string, unknown>): string | null {
  if (body.acquiredAt !== undefined) {
    if (typeof body.acquiredAt !== "string" || !isValidDateString(body.acquiredAt)) {
      return "acquiredAt must be a valid ISO date string";
    }
  }
  const qty = body.quantity as number | undefined;
  if (qty !== undefined) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999)
      return "quantity must be a positive integer between 1 and 9999";
  }

  const price = body.acquiredPrice as number | undefined;
  if (price !== undefined) {
    if (!Number.isFinite(price) || price < 0)
      return "acquiredPrice must be a non-negative finite number";
  }

  const cond = body.condition as string | undefined;
  if (cond !== undefined && !VALID_CONDITIONS.has(cond))
    return `condition must be one of: ${[...VALID_CONDITIONS].join(", ")}`;

  const notes = body.notes as string | undefined;
  if (notes !== undefined && notes.length > 2000)
    return "notes must not exceed 2000 characters";

  const currency = body.currency as string | undefined;
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency))
    return "currency must be a 3-letter ISO currency code";

  return null;
}

// ── Collection organization ──────────────────────────────────────────────────

router.get("/collection/lists", requireActiveUser, async (req: AuthRequest, res) => {
  return res.json(await collectionOrganization(req.userId!));
});

router.post("/collection/lists", requireActiveUser, async (req: AuthRequest, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 100) return res.status(400).json({ message: "name must be between 1 and 100 characters" });
  const count = await db.select({ count: sql<number>`count(*)::int` }).from(collectionListsTable)
    .where(eq(collectionListsTable.userId, req.userId!));
  if ((count[0]?.count ?? 0) >= MAX_LISTS) return res.status(400).json({ message: `a maximum of ${MAX_LISTS} lists is allowed` });
  try {
    await db.transaction(async tx => {
      const positions = await tx.select({ position: collectionListsTable.position }).from(collectionListsTable)
        .where(eq(collectionListsTable.userId, req.userId!));
      const position = positions.reduce((maximum, row) => Math.max(maximum, row.position), -1) + 1;
      await tx.insert(collectionListsTable).values({ userId: req.userId!, name, position });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "A list with that name already exists" });
    throw error;
  }
  logActivity(req.userId!, "collection_updated", null, name);
  return res.status(201).json(await collectionOrganization(req.userId!));
});

router.patch("/collection/lists/:listId", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!UUID_RE.test(listId) || !name || name.length > 100) return res.status(400).json({ message: "valid listId and name (1-100 characters) are required" });
  try {
    const changed = await db.update(collectionListsTable).set({ name, updatedAt: new Date() })
      .where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, req.userId!))).returning({ id: collectionListsTable.id });
    if (!changed.length) return res.status(404).json({ message: "List not found" });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "A list with that name already exists" });
    throw error;
  }
  logActivity(req.userId!, "collection_updated", listId, name);
  return res.json(await collectionOrganization(req.userId!));
});

router.put("/collection/lists/order", requireActiveUser, async (req: AuthRequest, res) => {
  const listIds = req.body?.listIds;
  if (!validIds(listIds)) return res.status(400).json({ message: `listIds must be unique UUIDs (maximum ${MAX_MEMBERSHIP_MUTATION})` });
  const lists = await db.select({ id: collectionListsTable.id }).from(collectionListsTable)
    .where(eq(collectionListsTable.userId, req.userId!));
  if (lists.length !== listIds.length || !lists.every(list => listIds.includes(list.id))) {
    return res.status(400).json({ message: "listIds must contain every list owned by the collector exactly once" });
  }
  await db.transaction(async tx => {
    await Promise.all(listIds.map((id, position) => tx.update(collectionListsTable).set({ position, updatedAt: new Date() }).where(eq(collectionListsTable.id, id))));
  });
  logActivity(req.userId!, "collection_updated", null, "collection lists reordered");
  return res.json(await collectionOrganization(req.userId!));
});

router.delete("/collection/lists/:listId", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  if (!UUID_RE.test(listId)) return res.status(400).json({ message: "valid listId is required" });
  const deleted = await db.delete(collectionListsTable).where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, req.userId!)))
    .returning({ id: collectionListsTable.id, name: collectionListsTable.name });
  if (!deleted.length) return res.status(404).json({ message: "List not found" });
  // Memberships cascade; holdings are intentionally not referenced by this delete.
  logActivity(req.userId!, "collection_updated", listId, deleted[0]!.name);
  return res.json(await collectionOrganization(req.userId!));
});

router.put("/collection/lists/:listId/items", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  const holdingIds = req.body?.holdingIds;
  if (!UUID_RE.test(listId) || !validIds(holdingIds)) return res.status(400).json({ message: `valid listId and unique holdingIds (maximum ${MAX_MEMBERSHIP_MUTATION}) are required` });
  let missing = false;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!}))`);
    const [list] = await tx.select({ id: collectionListsTable.id }).from(collectionListsTable)
      .where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, req.userId!))).limit(1);
    const owned = holdingIds.length === 0 ? [] : await tx.select({ id: collectionItemsTable.id }).from(collectionItemsTable)
      .where(and(eq(collectionItemsTable.userId, req.userId!), inArray(collectionItemsTable.id, holdingIds)));
    if (!list || owned.length !== holdingIds.length) { missing = true; return; }
    await tx.delete(collectionListItemsTable).where(eq(collectionListItemsTable.listId, listId));
    if (holdingIds.length) await tx.insert(collectionListItemsTable).values(holdingIds.map(collectionItemId => ({ userId: req.userId!, listId, collectionItemId })));
  });
  if (missing) return res.status(404).json({ message: "List or one or more holdings were not found" });
  logActivity(req.userId!, "collection_updated", listId, "list membership replaced");
  return res.json(await collectionOrganization(req.userId!));
});

router.post("/collection/lists/:listId/items", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  const holdingIds = req.body?.holdingIds;
  if (!UUID_RE.test(listId) || !validIds(holdingIds) || !holdingIds.length) return res.status(400).json({ message: "listId and one or more unique holdingIds are required" });
  let missing = false;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!}))`);
    const [list] = await tx.select({ id: collectionListsTable.id }).from(collectionListsTable)
      .where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, req.userId!))).limit(1);
    const owned = await tx.select({ id: collectionItemsTable.id }).from(collectionItemsTable)
      .where(and(eq(collectionItemsTable.userId, req.userId!), inArray(collectionItemsTable.id, holdingIds)));
    if (!list || owned.length !== holdingIds.length) { missing = true; return; }
    await tx.insert(collectionListItemsTable).values(holdingIds.map(collectionItemId => ({ userId: req.userId!, listId, collectionItemId }))).onConflictDoNothing();
  });
  if (missing) return res.status(404).json({ message: "List or one or more holdings were not found" });
  logActivity(req.userId!, "collection_updated", listId, "holdings added to list");
  return res.json(await collectionOrganization(req.userId!));
});

router.delete("/collection/lists/:listId/items/:holdingId", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  const holdingId = String(req.params["holdingId"] ?? "");
  if (!UUID_RE.test(listId) || !UUID_RE.test(holdingId)) return res.status(400).json({ message: "valid listId and holdingId are required" });
  let missing = false;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!}))`);
    const [list] = await tx.select({ id: collectionListsTable.id }).from(collectionListsTable)
      .where(and(eq(collectionListsTable.id, listId), eq(collectionListsTable.userId, req.userId!))).limit(1);
    const [holding] = await tx.select({ id: collectionItemsTable.id }).from(collectionItemsTable)
      .where(and(eq(collectionItemsTable.id, holdingId), eq(collectionItemsTable.userId, req.userId!))).limit(1);
    if (!list || !holding) { missing = true; return; }
    await tx.delete(collectionListItemsTable).where(and(eq(collectionListItemsTable.listId, listId), eq(collectionListItemsTable.collectionItemId, holdingId)));
  });
  if (missing) return res.status(404).json({ message: "List or holding not found" });
  logActivity(req.userId!, "collection_updated", listId, "holding removed from list");
  return res.json(await collectionOrganization(req.userId!));
});

router.get("/collection/lists/:listId/subtotal", requireActiveUser, async (req: AuthRequest, res) => {
  const listId = String(req.params["listId"] ?? "");
  const currency = typeof req.query["displayCurrency"] === "string" && /^[A-Za-z]{3}$/.test(req.query["displayCurrency"])
    ? req.query["displayCurrency"].toUpperCase() : "AUD";
  if (!UUID_RE.test(listId) || !await ownsList(req.userId!, listId)) return res.status(404).json({ message: "List not found" });
  const memberships = await db.select({ id: collectionListItemsTable.collectionItemId }).from(collectionListItemsTable)
    .where(eq(collectionListItemsTable.listId, listId));
  const valuation = await calculatePortfolioValuation(req.userId!, currency, memberships.map(row => row.id));
  return res.json({
    listId, currency, holdingCount: valuation.cardCount, uniqueHoldingCount: valuation.totalHoldings,
    totalValueCents: valuation.totalValueCents, totalValue: valuation.totalValueCents == null ? null : valuation.totalValueCents / 100,
    totalCostCents: valuation.totalCostCents, totalCost: valuation.totalCostCents == null ? null : valuation.totalCostCents / 100,
    pricedHoldings: valuation.pricedHoldings, totalHoldings: valuation.totalHoldings, valuationComplete: valuation.valuationComplete,
  });
});

router.get("/collection/preferences", requireActiveUser, async (req: AuthRequest, res) => {
  const [preferences] = await db.select().from(collectionPreferencesTable).where(eq(collectionPreferencesTable.userId, req.userId!)).limit(1);
  return res.json(preferencesResponse(preferences));
});

router.put("/collection/preferences", requireActiveUser, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;
  if (body.viewMode !== undefined && (typeof body.viewMode !== "string" || !VALID_VIEW_MODES.has(body.viewMode))) return res.status(400).json({ message: "viewMode is invalid" });
  if (body.sortKey !== undefined && (typeof body.sortKey !== "string" || !VALID_SORT_KEYS.has(body.sortKey))) return res.status(400).json({ message: "sortKey is invalid" });
  if (body.selectedListId !== undefined && body.selectedListId !== null && (typeof body.selectedListId !== "string" || !UUID_RE.test(body.selectedListId) || !await ownsList(req.userId!, body.selectedListId))) return res.status(400).json({ message: "selectedListId must be an owned list or null" });
  if (body.filterState !== undefined && (typeof body.filterState !== "object" || body.filterState === null || Array.isArray(body.filterState))) return res.status(400).json({ message: "filterState must be an object" });
  const [existing] = await db.select().from(collectionPreferencesTable)
    .where(eq(collectionPreferencesTable.userId, req.userId!)).limit(1);
  const patch = {
    viewMode: typeof body.viewMode === "string" ? body.viewMode : (existing?.viewMode ?? "grid"),
    selectedListId: body.selectedListId === undefined ? (existing?.selectedListId ?? null) : body.selectedListId as string | null,
    filterState: (body.filterState as Record<string, unknown> | undefined) ?? (existing?.filterState ?? {}),
    sortKey: typeof body.sortKey === "string" ? body.sortKey : (existing?.sortKey ?? "date_desc"),
    updatedAt: new Date(),
  };
  const [saved] = await db.insert(collectionPreferencesTable).values({ userId: req.userId!, ...patch })
    .onConflictDoUpdate({ target: collectionPreferencesTable.userId, set: patch }).returning();
  logActivity(req.userId!, "collection_updated", null, "collection preferences updated");
  return res.json(preferencesResponse(saved));
});

router.post("/collection/bulk", requireActiveUser, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;
  const holdingIds = body.holdingIds;
  const assignToListId = body.assignToListId;
  const removeFromListId = body.removeFromListId;
  const deleting = body.delete === true;
  const changingSale = body.isForSale !== undefined;
  const changingTrade = body.isForTrade !== undefined;
  if (!validIds(holdingIds) || !holdingIds.length) return res.status(400).json({ message: "holdingIds must contain one to 500 unique UUIDs" });
  if (!deleting && !changingSale && !changingTrade && assignToListId === undefined && removeFromListId === undefined) return res.status(400).json({ message: "at least one bulk operation is required" });
  if (changingSale && typeof body.isForSale !== "boolean") return res.status(400).json({ message: "isForSale must be boolean" });
  if (changingTrade && typeof body.isForTrade !== "boolean") return res.status(400).json({ message: "isForTrade must be boolean" });
  for (const listId of [assignToListId, removeFromListId]) {
    if (listId !== undefined && (typeof listId !== "string" || !UUID_RE.test(listId))) {
      return res.status(400).json({ message: "assignment list ID must be a UUID" });
    }
  }
  let missing = false;
  await db.transaction(async tx => {
    // Serialise all organization mutations for a collector. Re-check every
    // ownership predicate while the transaction-scoped lock is held so an
    // ID cannot pass validation and change owners/deletion state before write.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${req.userId!}))`);
    const listIds = [assignToListId, removeFromListId].filter((id): id is string => typeof id === "string");
    const ownedLists = listIds.length === 0 ? [] : await tx.select({ id: collectionListsTable.id }).from(collectionListsTable)
      .where(and(eq(collectionListsTable.userId, req.userId!), inArray(collectionListsTable.id, listIds)));
    const ownedHoldings = await tx.select({ id: collectionItemsTable.id }).from(collectionItemsTable)
      .where(and(eq(collectionItemsTable.userId, req.userId!), inArray(collectionItemsTable.id, holdingIds)));
    if (ownedLists.length !== new Set(listIds).size || ownedHoldings.length !== holdingIds.length) { missing = true; return; }
    if (assignToListId !== undefined) {
      await tx.insert(collectionListItemsTable).values(holdingIds.map(collectionItemId => ({ userId: req.userId!, listId: assignToListId as string, collectionItemId }))).onConflictDoNothing();
    }
    if (removeFromListId !== undefined) {
      await tx.delete(collectionListItemsTable).where(and(eq(collectionListItemsTable.listId, removeFromListId as string), inArray(collectionListItemsTable.collectionItemId, holdingIds)));
    }
    if (changingSale || changingTrade) {
      const patch: Partial<typeof collectionItemsTable.$inferInsert> = { updatedAt: new Date() };
      if (changingSale) patch.isForSale = body.isForSale as boolean;
      if (changingTrade) patch.isForTrade = body.isForTrade as boolean;
      await tx.update(collectionItemsTable).set(patch).where(and(eq(collectionItemsTable.userId, req.userId!), inArray(collectionItemsTable.id, holdingIds)));
    }
    if (deleting) {
      // The collection_list_items FK cascades; list deletion is never involved.
      await tx.delete(collectionItemsTable).where(and(eq(collectionItemsTable.userId, req.userId!), inArray(collectionItemsTable.id, holdingIds)));
    }
  });
  if (missing) return res.status(404).json({ message: "One or more lists or holdings were not found" });
  logActivity(req.userId!, "collection_updated", null, "bulk collection update");
  return res.json({ deletedHoldingIds: deleting ? holdingIds : [], ...(await collectionOrganization(req.userId!)) });
});

// ── POST /api/collection ──────────────────────────────────────────────────────

router.post("/collection", requireActiveUser, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;

  const validationError = validatePostBody(body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const acquiredPrice = (body.acquiredPrice as number | undefined) ?? 0;
  const acquiredPriceCents = Math.round(acquiredPrice * 100);
  const acquiredCurrency = typeof body.currency === "string"
    ? body.currency.toUpperCase()
    : "AUD";

  const [row] = await db
    .insert(collectionItemsTable)
    .values({
      userId: req.userId!,
      cardId: body.cardId as string,
      cardData: body.card as Record<string, unknown>,
      quantity: (body.quantity as number | undefined) ?? 1,
      condition: (body.condition as string | undefined) ?? "near_mint",
      isGraded: !!(body.grading),
      gradingData: (body.grading as Record<string, unknown> | null | undefined) ?? null,
      acquiredAt: body.acquiredAt as string,
      acquiredPriceCents,
      acquiredCurrency,
      notes: (body.notes as string | undefined) ?? null,
      isForSale: !!(body.isForSale),
      isForTrade: !!(body.isForTrade),
    })
    .returning();

  // A POST always creates a new collection item (PATCH is the update route).
  const cardName = (body.card as Record<string, unknown>)?.name as string | undefined;
  await logActivitySafely(req.userId!, "card_added", body.cardId as string, cardName ?? null, {
    cardImageUrl: ((body.card as Record<string, unknown>)?.image as string | undefined) ?? null,
  });

  return res.status(201).json(rowToItem(row));
});

// ── PATCH /api/collection/:id ─────────────────────────────────────────────────

router.patch("/collection/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const id = String(req.params["id"] ?? "");
  if (!id) return res.status(400).json({ message: "id is required" });

  const body = req.body as Record<string, unknown>;
  const validationError = validatePatchBody(body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  // Verify ownership
  const [existing] = await db
    .select({ id: collectionItemsTable.id })
    .from(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .limit(1);

  if (!existing) {
    return res.status(404).json({ message: "Item not found" });
  }

  const patch: Partial<typeof collectionItemsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.quantity !== undefined) patch.quantity = body.quantity as number;
  if (body.condition !== undefined) patch.condition = body.condition as string;
  if ("grading" in body) {
    patch.gradingData = (body.grading as Record<string, unknown> | null | undefined) ?? null;
    patch.isGraded = !!body.grading;
  }
  if (body.notes !== undefined) patch.notes = body.notes as string;
  if (body.isForSale !== undefined) patch.isForSale = !!(body.isForSale);
  if (body.isForTrade !== undefined) patch.isForTrade = !!(body.isForTrade);
  if (body.acquiredPrice !== undefined) {
    patch.acquiredPriceCents = Math.round((body.acquiredPrice as number) * 100);
  }
  if (body.acquiredAt !== undefined) {
    patch.acquiredAt = body.acquiredAt as string;
  }
  if (typeof body.currency === "string") {
    patch.acquiredCurrency = body.currency.toUpperCase();
  }

  const [row] = await db
    .update(collectionItemsTable)
    .set(patch)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning();

  // Log activity — fire-and-forget
  const rowCard = row.cardData as Record<string, unknown> | null;
  logActivity(req.userId!, "collection_updated", row.cardId, rowCard?.name as string ?? null, {
    cardImageUrl: (rowCard?.image as string | undefined) ?? null,
  });

  return res.json(rowToItem(row));
});

// ── DELETE /api/collection/:id ────────────────────────────────────────────────

router.delete("/collection/:id", requireActiveUser, async (req: AuthRequest, res) => {
  const id = String(req.params["id"] ?? "");
  if (!id) return res.status(400).json({ message: "id is required" });

  const deleted = await db
    .delete(collectionItemsTable)
    .where(and(eq(collectionItemsTable.id, id), eq(collectionItemsTable.userId, req.userId!)))
    .returning({ id: collectionItemsTable.id });

  if (deleted.length === 0) {
    return res.status(404).json({ message: "Item not found" });
  }

  // Log activity — fire-and-forget (entity name not available after deletion)
  logActivity(req.userId!, "card_removed", id, null);

  return res.json({ message: "Deleted" });
});

export default router;
