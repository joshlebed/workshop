// Moderation surface (App Store Review Guideline 1.2): block abusive users and
// report objectionable content. Mounted at `/v1`; every route needs a session.
//
// Block semantics — `POST /v1/users/:id/block`:
//   1. records `user_blocks(blocker → blocked)` (idempotent),
//   2. removes the `friendships` edge and any pending directed request between
//      the pair, so the blocked user's scores leave the blocker's leaderboards
//      on the next fetch (scores are friends-only: `visibleUserIds` in
//      routes/v1/games.ts), and their own leaderboards lose the blocker,
//   3. pings #workshop-admin — Apple wants blocks to reach the developer.
//   Every friend-forming path (`routes/v1/friends.ts`) refuses while a block
//   exists in either direction, so the pair can't quietly re-friend.
//
// Report semantics — `POST /v1/reports`: stores a `content_reports` row with a
// snapshot of the offending text and pings #workshop-admin. The operator acts
// within 24h via docs/moderation-runbook.md (`pnpm admin:eject`).

import type { BlockedUsersResponse, CreateReportResponse } from "@workshop/shared/moderation";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { contentReports, friendRequests, gameScores, userBlocks, users } from "../../db/schema.js";
import { toIsoString } from "../../lib/dates.js";
import { removeFriendship } from "../../lib/friends.js";
import { notifyContentReport, notifyUserBlocked } from "../../lib/opsNotifications.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { periodKeySchema } from "../../lib/scoreSchemas.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

const uuidSchema = z.string().uuid();

const createReportSchema = z
  .object({
    targetUserId: uuidSchema,
    contentKind: z.enum(["profile", "score"]),
    reason: z.enum(["abusive", "offensive", "spam", "other"]),
    details: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().max(500, "details too long"))
      .optional(),
    gameId: uuidSchema.optional(),
    periodKey: periodKeySchema.optional(),
  })
  .refine((v) => v.contentKind !== "score" || (v.gameId && v.periodKey), {
    message: "score reports need gameId and periodKey",
  });

export const moderationRoutes = new Hono();
moderationRoutes.use("*", requireAuth);

// --- POST /v1/users/:id/block ---

moderationRoutes.post(
  "/users/:id/block",
  rateLimit({
    family: "v1.users.block",
    limit: 60,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const target = uuidSchema.safeParse(c.req.param("id"));
    if (!target.success) return err(c, "NOT_FOUND", "user not found");
    if (target.data === userId) return err(c, "VALIDATION", "you can't block yourself");

    const db = getDb();
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, target.data))
      .limit(1);
    if (!exists) return err(c, "NOT_FOUND", "user not found");

    const inserted = await db
      .insert(userBlocks)
      .values({ blockerId: userId, blockedId: target.data })
      .onConflictDoNothing()
      .returning({ blockerId: userBlocks.blockerId });
    await removeFriendship(userId, target.data);
    await db.delete(friendRequests).where(
      and(
        eq(friendRequests.status, "pending"),
        // Both directions; `or` spelled out so the partial index is usable.
        eq(friendRequests.inviterId, userId),
        eq(friendRequests.inviteeId, target.data),
      ),
    );
    await db
      .delete(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          eq(friendRequests.inviterId, target.data),
          eq(friendRequests.inviteeId, userId),
        ),
      );
    if (inserted.length > 0) await notifyUserBlocked(userId, target.data);
    return ok(c, { ok: true }, inserted.length > 0 ? 201 : 200);
  },
);

// --- DELETE /v1/users/:id/block — unblock (friendship is NOT restored) ---

moderationRoutes.delete("/users/:id/block", async (c) => {
  const userId = c.get("userId");
  const target = uuidSchema.safeParse(c.req.param("id"));
  if (!target.success) return err(c, "NOT_FOUND", "user not found");
  await getDb()
    .delete(userBlocks)
    .where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, target.data)));
  return ok(c, { ok: true });
});

// --- GET /v1/users/me/blocks — who I've blocked, newest first ---

moderationRoutes.get("/users/me/blocks", async (c) => {
  const userId = c.get("userId");
  const rows = await getDb()
    .select({
      userId: userBlocks.blockedId,
      displayName: users.displayName,
      createdAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, userId))
    .orderBy(desc(userBlocks.createdAt));
  const response: BlockedUsersResponse = {
    blocked: rows.map((r) => ({
      userId: r.userId,
      displayName: r.displayName,
      blockedAt: toIsoString(r.createdAt),
    })),
  };
  return ok(c, response);
});

// --- POST /v1/reports ---

moderationRoutes.post(
  "/reports",
  rateLimit({
    family: "v1.reports.create",
    limit: 30,
    windowSec: 3600,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const userId = c.get("userId");
    const parsed = await parseJsonBody(c, createReportSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    if (body.targetUserId === userId) return err(c, "VALIDATION", "you can't report yourself");

    const db = getDb();
    const [target] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, body.targetUserId))
      .limit(1);
    if (!target) return err(c, "NOT_FOUND", "user not found");

    // Snapshot what was reported so the operator can judge it even if the
    // author edits or clears it before the review.
    let snapshot: string | null = target.displayName;
    if (body.contentKind === "score" && body.gameId && body.periodKey) {
      const [score] = await db
        .select({ scoreRaw: gameScores.scoreRaw })
        .from(gameScores)
        .where(
          and(
            eq(gameScores.gameId, body.gameId),
            eq(gameScores.userId, body.targetUserId),
            eq(gameScores.periodKey, body.periodKey),
          ),
        )
        .limit(1);
      snapshot = score?.scoreRaw ?? null;
    }

    const [row] = await db
      .insert(contentReports)
      .values({
        reporterId: userId,
        targetUserId: body.targetUserId,
        contentKind: body.contentKind,
        reason: body.reason,
        details: body.details || null,
        gameId: body.contentKind === "score" ? (body.gameId ?? null) : null,
        periodKey: body.contentKind === "score" ? (body.periodKey ?? null) : null,
        contentSnapshot: snapshot,
      })
      .returning({ id: contentReports.id });
    if (!row) return err(c, "INTERNAL", "report insert returned no row");

    await notifyContentReport(userId, body.targetUserId, body.contentKind, body.reason, snapshot);
    const response: CreateReportResponse = { reportId: row.id };
    return ok(c, response, 201);
  },
);
