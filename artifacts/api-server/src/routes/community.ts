/**
 * Community routes — activity feed, posts, likes, comments.
 *
 * All routes require a valid JWT (requireActiveUser).
 *
 * Feed:
 *   GET  /api/community/feed?page=1        posts from followed collectors, newest first
 *
 * Posts:
 *   POST   /api/community/posts            create a post
 *   DELETE /api/community/posts/:id        delete own post
 *
 * Likes:
 *   POST   /api/community/posts/:id/like   like a post
 *   DELETE /api/community/posts/:id/like   unlike a post
 *
 * Comments:
 *   GET  /api/community/posts/:id/comments   list comments (newest first)
 *   POST /api/community/posts/:id/comments   add a comment
 *   DELETE /api/community/posts/:postId/comments/:commentId   delete own comment
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  postsTable,
  postLikesTable,
  postCommentsTable,
  followsTable,
  usersTable,
  userBlocksTable,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import { createNotification } from "./notifications.js";

const communityRouter = Router();

// ── GET /api/community/feed ───────────────────────────────────────────────────

communityRouter.get(
  "/community/feed",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    try {
      // Get list of followed user IDs
      const followed = await db
        .select({ followeeId: followsTable.followeeId })
        .from(followsTable)
        .where(eq(followsTable.followerId, userId));

      const followedIds = followed.map((r) => r.followeeId);

      // Include own posts in the feed too
      const feedUserIdsRaw = [...new Set([...followedIds, userId])];

      // Bidirectional block exclusion — remove any blocked/blocking users from the feed
      // (own userId is never in blocks so always stays)
      const [blockedByMe, blockedMe] = await Promise.all([
        db.select({ id: userBlocksTable.blockedUserId }).from(userBlocksTable)
          .where(eq(userBlocksTable.blockerUserId, userId)),
        db.select({ id: userBlocksTable.blockerUserId }).from(userBlocksTable)
          .where(eq(userBlocksTable.blockedUserId, userId)),
      ]);
      const blockedIdsSet = new Set([
        ...blockedByMe.map((r) => r.id),
        ...blockedMe.map((r) => r.id),
      ]);
      const feedUserIds = feedUserIdsRaw.filter((id) => !blockedIdsSet.has(id));

      if (feedUserIds.length === 0) {
        res.json({ feed: [], page, hasMore: false });
        return;
      }

      // Fetch posts with author info
      const posts = await db
        .select({
          id: postsTable.id,
          userId: postsTable.userId,
          body: postsTable.body,
          cardId: postsTable.cardId,
          cardName: postsTable.cardName,
          createdAt: postsTable.createdAt,
          authorUsername: usersTable.username,
          authorDisplayName: usersTable.displayName,
          authorSubscriptionTier: usersTable.subscriptionTier,
        })
        .from(postsTable)
        .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
        .where(inArray(postsTable.userId, feedUserIds))
        .orderBy(desc(postsTable.createdAt))
        .limit(limit)
        .offset(offset);

      if (posts.length === 0) {
        res.json({ feed: [], page, hasMore: false });
        return;
      }

      const postIds = posts.map((p) => p.id);

      // Like counts per post
      const likeCounts = await db
        .select({
          postId: postLikesTable.postId,
          count: sql<number>`count(*)::int`,
        })
        .from(postLikesTable)
        .where(inArray(postLikesTable.postId, postIds))
        .groupBy(postLikesTable.postId);

      const likeCountMap = new Map(likeCounts.map((r) => [r.postId, r.count]));

      // Comment counts per post
      const commentCounts = await db
        .select({
          postId: postCommentsTable.postId,
          count: sql<number>`count(*)::int`,
        })
        .from(postCommentsTable)
        .where(inArray(postCommentsTable.postId, postIds))
        .groupBy(postCommentsTable.postId);

      const commentCountMap = new Map(
        commentCounts.map((r) => [r.postId, r.count]),
      );

      // Which posts has the current user liked?
      const userLikes = await db
        .select({ postId: postLikesTable.postId })
        .from(postLikesTable)
        .where(
          and(
            inArray(postLikesTable.postId, postIds),
            eq(postLikesTable.userId, userId),
          ),
        );

      const likedSet = new Set(userLikes.map((r) => r.postId));

      // Total count for hasMore
      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postsTable)
        .where(inArray(postsTable.userId, feedUserIds));

      const total = Number(totalRow?.count ?? 0);

      res.json({
        feed: posts.map((p) => ({
          id: p.id,
          userId: p.userId,
          body: p.body,
          cardId: p.cardId,
          cardName: p.cardName,
          createdAt: p.createdAt,
          author: {
            username: p.authorUsername,
            displayName: p.authorDisplayName,
            initials: initials(p.authorDisplayName),
            subscriptionTier: p.authorSubscriptionTier,
          },
          likeCount: Number(likeCountMap.get(p.id) ?? 0),
          commentCount: Number(commentCountMap.get(p.id) ?? 0),
          isLiked: likedSet.has(p.id),
          isOwn: p.userId === userId,
        })),
        page,
        hasMore: offset + posts.length < total,
      });
    } catch (err) {
      console.error("[community] GET /api/community/feed:", err);
      res.status(500).json({ message: "Failed to load feed" });
    }
  },
);

// ── POST /api/community/posts ─────────────────────────────────────────────────

communityRouter.post(
  "/community/posts",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const { body, cardId, cardName } = req.body as {
      body?: string;
      cardId?: string;
      cardName?: string;
    };

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ message: "Post body is required" });
      return;
    }

    if (body.trim().length > 500) {
      res.status(400).json({ message: "Post body must be 500 characters or fewer" });
      return;
    }

    try {
      const [post] = await db
        .insert(postsTable)
        .values({
          userId,
          body: body.trim(),
          cardId: cardId ?? null,
          cardName: cardName ?? null,
        })
        .returning();

      const [author] = await db
        .select({
          username: usersTable.username,
          displayName: usersTable.displayName,
          subscriptionTier: usersTable.subscriptionTier,
        })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      res.status(201).json({
        id: post!.id,
        userId: post!.userId,
        body: post!.body,
        cardId: post!.cardId,
        cardName: post!.cardName,
        createdAt: post!.createdAt,
        author: {
          username: author!.username,
          displayName: author!.displayName,
          initials: initials(author!.displayName),
          subscriptionTier: author!.subscriptionTier,
        },
        likeCount: 0,
        commentCount: 0,
        isLiked: false,
        isOwn: true,
      });
    } catch (err) {
      console.error("[community] POST /api/community/posts:", err);
      res.status(500).json({ message: "Failed to create post" });
    }
  },
);

// ── DELETE /api/community/posts/:id ──────────────────────────────────────────

communityRouter.delete(
  "/community/posts/:id",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");

    try {
      const [deleted] = await db
        .delete(postsTable)
        .where(and(eq(postsTable.id, postId), eq(postsTable.userId, userId)))
        .returning({ id: postsTable.id });

      if (!deleted) {
        res.status(404).json({ message: "Post not found or not yours" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[community] DELETE /api/community/posts/:id:", err);
      res.status(500).json({ message: "Failed to delete post" });
    }
  },
);

// ── POST /api/community/posts/:id/like ───────────────────────────────────────

communityRouter.post(
  "/community/posts/:id/like",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");

    try {
      // Verify post exists and get author
      const [post] = await db
        .select({ id: postsTable.id, userId: postsTable.userId })
        .from(postsTable)
        .where(eq(postsTable.id, postId))
        .limit(1);

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const inserted = await db
        .insert(postLikesTable)
        .values({ postId, userId })
        .onConflictDoNothing()
        .returning({ userId: postLikesTable.userId });

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postLikesTable)
        .where(eq(postLikesTable.postId, postId));

      // Notify the post author only when a new like row was created and the liker is not the author
      if (inserted.length > 0 && post.userId !== userId) {
        db.select({ username: usersTable.username })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1)
          .then(([likerRow]) => {
            if (!likerRow) return;
            return createNotification({
              userId: post.userId,
              type: "community",
              title: "Someone liked your post",
              body: `${likerRow.username} liked your post.`,
              metadata: { postId, likerUsername: likerRow.username },
            });
          })
          .catch((err) => console.error("[community] like notification:", err));
      }

      res.json({ ok: true, likeCount: Number(countRow?.count ?? 0) });
    } catch (err) {
      console.error("[community] POST /api/community/posts/:id/like:", err);
      res.status(500).json({ message: "Failed to like post" });
    }
  },
);

// ── DELETE /api/community/posts/:id/like ─────────────────────────────────────

communityRouter.delete(
  "/community/posts/:id/like",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");

    try {
      await db
        .delete(postLikesTable)
        .where(
          and(eq(postLikesTable.postId, postId), eq(postLikesTable.userId, userId)),
        );

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postLikesTable)
        .where(eq(postLikesTable.postId, postId));

      res.json({ ok: true, likeCount: Number(countRow?.count ?? 0) });
    } catch (err) {
      console.error("[community] DELETE /api/community/posts/:id/like:", err);
      res.status(500).json({ message: "Failed to unlike post" });
    }
  },
);

// ── GET /api/community/posts/:id/comments ────────────────────────────────────

communityRouter.get(
  "/community/posts/:id/comments",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");
    const page = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const limit = 30;
    const offset = (page - 1) * limit;

    try {
      const comments = await db
        .select({
          id: postCommentsTable.id,
          postId: postCommentsTable.postId,
          userId: postCommentsTable.userId,
          body: postCommentsTable.body,
          createdAt: postCommentsTable.createdAt,
          authorUsername: usersTable.username,
          authorDisplayName: usersTable.displayName,
        })
        .from(postCommentsTable)
        .innerJoin(usersTable, eq(postCommentsTable.userId, usersTable.id))
        .where(eq(postCommentsTable.postId, postId))
        .orderBy(desc(postCommentsTable.createdAt))
        .limit(limit)
        .offset(offset);

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postCommentsTable)
        .where(eq(postCommentsTable.postId, postId));

      const total = Number(totalRow?.count ?? 0);

      res.json({
        comments: comments.map((c) => ({
          id: c.id,
          postId: c.postId,
          body: c.body,
          createdAt: c.createdAt,
          isOwn: c.userId === userId,
          author: {
            username: c.authorUsername,
            displayName: c.authorDisplayName,
            initials: initials(c.authorDisplayName),
          },
        })),
        page,
        total,
        hasMore: offset + comments.length < total,
      });
    } catch (err) {
      console.error("[community] GET /api/community/posts/:id/comments:", err);
      res.status(500).json({ message: "Failed to load comments" });
    }
  },
);

// ── POST /api/community/posts/:id/comments ────────────────────────────────────

communityRouter.post(
  "/community/posts/:id/comments",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");
    const { body } = req.body as { body?: string };

    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ message: "Comment body is required" });
      return;
    }

    if (body.trim().length > 300) {
      res.status(400).json({ message: "Comment must be 300 characters or fewer" });
      return;
    }

    try {
      // Verify post exists and get author
      const [post] = await db
        .select({ id: postsTable.id, userId: postsTable.userId })
        .from(postsTable)
        .where(eq(postsTable.id, postId))
        .limit(1);

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const [[comment], [author]] = await Promise.all([
        db
          .insert(postCommentsTable)
          .values({ postId, userId, body: body.trim() })
          .returning(),
        db
          .select({ username: usersTable.username, displayName: usersTable.displayName })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1),
      ]);

      // Notify the post author (skip if the commenter is the author)
      if (post.userId !== userId && author) {
        createNotification({
          userId: post.userId,
          type: "community",
          title: "New comment on your post",
          body: `${author.username} commented on your post.`,
          metadata: { postId, commenterUsername: author.username },
        }).catch((err) => console.error("[community] comment notification:", err));
      }

      res.status(201).json({
        id: comment!.id,
        postId: comment!.postId,
        body: comment!.body,
        createdAt: comment!.createdAt,
        isOwn: true,
        author: {
          username: author!.username,
          displayName: author!.displayName,
          initials: initials(author!.displayName),
        },
      });
    } catch (err) {
      console.error("[community] POST /api/community/posts/:id/comments:", err);
      res.status(500).json({ message: "Failed to add comment" });
    }
  },
);

// ── DELETE /api/community/posts/:postId/comments/:commentId ──────────────────

communityRouter.delete(
  "/community/posts/:postId/comments/:commentId",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const commentId = String(req.params["commentId"] ?? "");

    try {
      const [deleted] = await db
        .delete(postCommentsTable)
        .where(
          and(
            eq(postCommentsTable.id, commentId),
            eq(postCommentsTable.userId, userId),
          ),
        )
        .returning({ id: postCommentsTable.id });

      if (!deleted) {
        res.status(404).json({ message: "Comment not found or not yours" });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("[community] DELETE /api/community/posts/:postId/comments/:commentId:", err);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  },
);

// ── GET /api/community/posts/:id ─────────────────────────────────────────────
// Single post detail (for navigating to a specific post)

communityRouter.get(
  "/community/posts/:id",
  requireActiveUser,
  async (req: AuthRequest, res) => {
    const userId = req.userId!;
    const postId = String(req.params["id"] ?? "");

    try {
      const [post] = await db
        .select({
          id: postsTable.id,
          userId: postsTable.userId,
          body: postsTable.body,
          cardId: postsTable.cardId,
          cardName: postsTable.cardName,
          createdAt: postsTable.createdAt,
          authorUsername: usersTable.username,
          authorDisplayName: usersTable.displayName,
          authorSubscriptionTier: usersTable.subscriptionTier,
        })
        .from(postsTable)
        .innerJoin(usersTable, eq(postsTable.userId, usersTable.id))
        .where(eq(postsTable.id, postId))
        .limit(1);

      if (!post) {
        res.status(404).json({ message: "Post not found" });
        return;
      }

      const [likeCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postLikesTable)
        .where(eq(postLikesTable.postId, postId));

      const [commentCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postCommentsTable)
        .where(eq(postCommentsTable.postId, postId));

      const [userLike] = await db
        .select({ postId: postLikesTable.postId })
        .from(postLikesTable)
        .where(and(eq(postLikesTable.postId, postId), eq(postLikesTable.userId, userId)))
        .limit(1);

      res.json({
        id: post.id,
        userId: post.userId,
        body: post.body,
        cardId: post.cardId,
        cardName: post.cardName,
        createdAt: post.createdAt,
        author: {
          username: post.authorUsername,
          displayName: post.authorDisplayName,
          initials: initials(post.authorDisplayName),
          subscriptionTier: post.authorSubscriptionTier,
        },
        likeCount: Number(likeCountRow?.count ?? 0),
        commentCount: Number(commentCountRow?.count ?? 0),
        isLiked: !!userLike,
        isOwn: post.userId === userId,
      });
    } catch (err) {
      console.error("[community] GET /api/community/posts/:id:", err);
      res.status(500).json({ message: "Failed to load post" });
    }
  },
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default communityRouter;
