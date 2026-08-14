/**
 * Collectors routes — public profiles, follow/unfollow, followers/following lists, search.
 *
 * Public endpoints (no auth):
 *   GET  /api/collectors/search?q=         search collectors by username or display name
 *   GET  /api/collectors/:username         public profile
 *   GET  /api/collectors/:username/followers?page
 *   GET  /api/collectors/:username/following?page
 *
 * Authenticated:
 *   POST   /api/collectors/:username/follow
 *   DELETE /api/collectors/:username/follow
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, followsTable, postsTable, postLikesTable } from "@workspace/db";
import {
  and,
  desc,
  eq,
  ilike,
  or,
  sql,
  ne,
} from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";

const collectorsRouter = Router();

// ── GET /api/collectors/search ────────────────────────────────────────────────

collectorsRouter.get("/collectors/search", async (req, res) => {
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  if (!q || q.length < 2) {
    res.json({ collectors: [] });
    return;
  }

  try {
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        bio: usersTable.bio,
        location: usersTable.location,
        subscriptionTier: usersTable.subscriptionTier,
        isFoundingMember: usersTable.isFoundingMember,
        createdAt: usersTable.createdAt,
        profilePublic: usersTable.profilePublic,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.profilePublic, true),
          or(
            ilike(usersTable.username, pattern),
            ilike(usersTable.displayName, pattern),
          ),
        ),
      )
      .orderBy(usersTable.displayName)
      .limit(20);

    res.json({ collectors: rows.map(rowToPublicProfile) });
  } catch (err) {
    console.error("[collectors] GET /api/collectors/search:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

// ── GET /api/collectors/:username ─────────────────────────────────────────────

collectorsRouter.get(
  "/collectors/:username",
  async (req: AuthRequest, res) => {
    const username = String(req.params["username"] ?? "");

    try {
      const [collector] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!collector) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      // Follower / following counts
      const [followerCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .where(eq(followsTable.followeeId, collector.id));

      const [followingCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .where(eq(followsTable.followerId, collector.id));

      // Post count
      const [postCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postsTable)
        .where(eq(postsTable.userId, collector.id));

      // Decode the bearer token once — used for both follow-check and ownership check
      let requesterId: string | null = null;
      let isFollowing = false;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const jwt = await import("jsonwebtoken");
          const secret = process.env.SESSION_SECRET!;
          const payload = jwt.default.verify(authHeader.slice(7), secret) as { sub: string };
          requesterId = payload.sub;

          const [followRow] = await db
            .select({ followerId: followsTable.followerId })
            .from(followsTable)
            .where(
              and(
                eq(followsTable.followerId, requesterId),
                eq(followsTable.followeeId, collector.id),
              ),
            )
            .limit(1);
          isFollowing = !!followRow;
        } catch {
          // ignore invalid tokens on public endpoints
        }
      }

      const profile = rowToPublicProfile(collector);
      const isOwner = requesterId === collector.id;

      // Private profiles are only visible to the owner
      if (!profile.profilePublic && !isOwner) {
        res.json({
          id: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          initials: profile.initials,
          subscriptionTier: profile.subscriptionTier,
          isFoundingMember: profile.isFoundingMember,
          joinedAt: profile.joinedAt,
          profilePublic: false,
          isPrivate: true,
        });
        return;
      }

      res.json({
        ...profile,
        followerCount: Number(followerCountRow?.count ?? 0),
        followingCount: Number(followingCountRow?.count ?? 0),
        postCount: Number(postCountRow?.count ?? 0),
        isFollowing,
      });
    } catch (err) {
      console.error("[collectors] GET /api/collectors/:username:", err);
      res.status(500).json({ message: "Failed to load profile" });
    }
  },
);

// ── GET /api/collectors/:username/followers ───────────────────────────────────

collectorsRouter.get(
  "/collectors/:username/followers",
  async (req, res) => {
    const username = String(req.params["username"] ?? "");
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    try {
      const [collector] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!collector) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      const rows = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          displayName: usersTable.displayName,
          bio: usersTable.bio,
          location: usersTable.location,
          subscriptionTier: usersTable.subscriptionTier,
          isFoundingMember: usersTable.isFoundingMember,
          createdAt: usersTable.createdAt,
          profilePublic: usersTable.profilePublic,
        })
        .from(followsTable)
        .innerJoin(usersTable, eq(followsTable.followerId, usersTable.id))
        .where(and(
          eq(followsTable.followeeId, collector.id),
          eq(usersTable.profilePublic, true),
        ))
        .orderBy(desc(followsTable.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .innerJoin(usersTable, eq(followsTable.followerId, usersTable.id))
        .where(and(
          eq(followsTable.followeeId, collector.id),
          eq(usersTable.profilePublic, true),
        ));

      const total = Number(totalRow?.count ?? 0);
      res.json({
        followers: rows.map(rowToPublicProfile),
        page,
        total,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      console.error("[collectors] GET /api/collectors/:username/followers:", err);
      res.status(500).json({ message: "Failed to load followers" });
    }
  },
);

// ── GET /api/collectors/:username/following ───────────────────────────────────

collectorsRouter.get(
  "/collectors/:username/following",
  async (req, res) => {
    const username = String(req.params["username"] ?? "");
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    try {
      const [collector] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!collector) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      const rows = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          displayName: usersTable.displayName,
          bio: usersTable.bio,
          location: usersTable.location,
          subscriptionTier: usersTable.subscriptionTier,
          isFoundingMember: usersTable.isFoundingMember,
          createdAt: usersTable.createdAt,
          profilePublic: usersTable.profilePublic,
        })
        .from(followsTable)
        .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.id))
        .where(and(
          eq(followsTable.followerId, collector.id),
          eq(usersTable.profilePublic, true),
        ))
        .orderBy(desc(followsTable.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .innerJoin(usersTable, eq(followsTable.followeeId, usersTable.id))
        .where(and(
          eq(followsTable.followerId, collector.id),
          eq(usersTable.profilePublic, true),
        ));

      const total = Number(totalRow?.count ?? 0);
      res.json({
        following: rows.map(rowToPublicProfile),
        page,
        total,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      console.error("[collectors] GET /api/collectors/:username/following:", err);
      res.status(500).json({ message: "Failed to load following" });
    }
  },
);

// ── POST /api/collectors/:username/follow ─────────────────────────────────────

collectorsRouter.post(
  "/collectors/:username/follow",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const followerId = req.userId!;
    const username = String(req.params["username"] ?? "");

    try {
      const [followee] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!followee) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      if (followee.id === followerId) {
        res.status(400).json({ message: "Cannot follow yourself" });
        return;
      }

      await db
        .insert(followsTable)
        .values({ followerId, followeeId: followee.id })
        .onConflictDoNothing();

      // Follower count for the followee
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .where(eq(followsTable.followeeId, followee.id));

      res.json({ ok: true, followerCount: Number(countRow?.count ?? 0) });
    } catch (err) {
      console.error("[collectors] POST /api/collectors/:username/follow:", err);
      res.status(500).json({ message: "Failed to follow collector" });
    }
  },
);

// ── DELETE /api/collectors/:username/follow ───────────────────────────────────

collectorsRouter.delete(
  "/collectors/:username/follow",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const followerId = req.userId!;
    const username = String(req.params["username"] ?? "");

    try {
      const [followee] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.username, username))
        .limit(1);

      if (!followee) {
        res.status(404).json({ message: "Collector not found" });
        return;
      }

      await db
        .delete(followsTable)
        .where(
          and(
            eq(followsTable.followerId, followerId),
            eq(followsTable.followeeId, followee.id),
          ),
        );

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(followsTable)
        .where(eq(followsTable.followeeId, followee.id));

      res.json({ ok: true, followerCount: Number(countRow?.count ?? 0) });
    } catch (err) {
      console.error("[collectors] DELETE /api/collectors/:username/follow:", err);
      res.status(500).json({ message: "Failed to unfollow collector" });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPublicProfile(row: {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  location: string;
  subscriptionTier: string;
  isFoundingMember: boolean;
  createdAt: Date;
  avatarUrl?: string | null;
  favouriteTcg?: string | null;
  collectorSince?: string | null;
  profilePublic?: boolean;
  showCollection?: boolean;
  showWishlist?: boolean;
  showForTrade?: boolean;
  showForSale?: boolean;
}) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    initials: initials(row.displayName),
    bio: row.bio,
    location: row.location,
    subscriptionTier: row.subscriptionTier,
    isFoundingMember: row.isFoundingMember,
    joinedAt: row.createdAt.toISOString(),
    avatarUrl: row.avatarUrl ?? null,
    favouriteTcg: row.favouriteTcg ?? null,
    collectorSince: row.collectorSince ?? null,
    profilePublic: row.profilePublic ?? true,
    showCollection: row.showCollection ?? true,
    showWishlist: row.showWishlist ?? true,
    showForTrade: row.showForTrade ?? true,
    showForSale: row.showForSale ?? true,
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default collectorsRouter;
