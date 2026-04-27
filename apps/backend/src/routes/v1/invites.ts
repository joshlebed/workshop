import { randomBytes } from "node:crypto";
import type { Invite, ListColor, ListMemberSummary, MemberRole } from "@workshop/shared";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import {
  type DbList,
  type DbListInvite,
  listInvites,
  listMembers,
  lists,
  users,
} from "../../db/schema.js";
import { recordEvent } from "../../lib/events.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember, requireListOwner } from "../../middleware/authorize.js";

/**
 * Mounted at `/v1` (not under `/v1/lists` or `/v1/invites`) because the
 * three handlers split across two URL roots:
 *
 * - `POST   /lists/:id/invites`         (owner generates a share link)
 * - `DELETE /lists/:id/invites/:inviteId` (owner revokes)
 * - `POST   /invites/:token/accept`     (any auth user joins)
 *
 * Keeping them in one file mirrors how `lists.ts` mounts both
 * `/v1/lists/...` and the list-scoped item routes.
 */
export const inviteRoutes = new Hono();

inviteRoutes.use("*", requireAuth);

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * `email` is reserved for a future email-invite flow but ignored in v1
 * (spec §6 — share-link only). The schema accepts it so a forward-
 * compatible client can submit it without a 400; we just don't persist
 * it. Pass `null` or omit to behave the same.
 */
export const createInviteSchema = z
  .object({
    email: z.union([z.string().email().max(320), z.null()]).optional(),
  })
  .optional();

const uuidSchema = z.string().uuid();

function b64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 32 bytes of crypto randomness → 43 base64url characters. Long enough
 * that brute-forcing the entire keyspace is infeasible; short enough to
 * fit comfortably in a deep-link path segment.
 */
function generateInviteToken(): string {
  return b64url(randomBytes(32));
}

function toInviteShape(row: DbListInvite, opts: { includeToken: boolean }): Invite {
  return {
    id: row.id,
    listId: row.listId,
    email: row.email,
    ...(opts.includeToken ? { token: row.token } : {}),
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

// --- POST /v1/lists/:id/invites (owner-only, share-link generator) ---

inviteRoutes.post("/lists/:id/invites", requireListMember, requireListOwner, async (c) => {
  let body: unknown;
  try {
    const text = await c.req.text();
    body = text.length === 0 ? undefined : JSON.parse(text);
  } catch {
    return err(c, "VALIDATION", "invalid json body");
  }
  const parsed = createInviteSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid request", parsed.error.issues);
  }

  const listId = c.req.param("id");
  const userId = c.get("userId");
  const db = getDb();

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await db
    .insert(listInvites)
    .values({
      listId,
      // v1 ignores the optional `email`; share-link only.
      email: null,
      token: generateInviteToken(),
      invitedBy: userId,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("invite insert returned no row");

  await recordEvent({
    listId,
    actorId: userId,
    type: "invite_created",
    payload: { inviteId: row.id },
  });

  // Owner generated this token; it's safe to return on this single
  // response so they can build the share URL. `pendingInvites` on
  // `GET /v1/lists/:id` deliberately omits it.
  return ok(c, { invite: toInviteShape(row, { includeToken: true }) }, 201);
});

// --- DELETE /v1/lists/:id/invites/:inviteId (owner-only revoke) ---

inviteRoutes.delete(
  "/lists/:id/invites/:inviteId",
  requireListMember,
  requireListOwner,
  async (c) => {
    const listId = c.req.param("id");
    const inviteId = c.req.param("inviteId");
    if (!uuidSchema.safeParse(inviteId).success) {
      return err(c, "NOT_FOUND", "invite not found");
    }

    const db = getDb();
    // Mark `revoked_at` rather than deleting so the audit trail survives
    // and so `pendingInvites` filtering (revoked_at IS NULL) excludes it
    // immediately. Idempotent: re-revoking already-revoked rows leaves
    // `revoked_at` at its original value via the `IS NULL` guard.
    const updated = await db
      .update(listInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(listInvites.id, inviteId),
          eq(listInvites.listId, listId),
          isNull(listInvites.revokedAt),
        ),
      )
      .returning({ id: listInvites.id });
    if (updated.length === 0) {
      return err(c, "NOT_FOUND", "invite not found");
    }

    const userId = c.get("userId");
    await recordEvent({
      listId,
      actorId: userId,
      type: "invite_revoked",
      payload: { inviteId },
    });
    return ok(c, { ok: true });
  },
);

// --- POST /v1/invites/:token/accept (any auth user joins) ---

function toListShape(l: DbList) {
  return {
    id: l.id,
    type: l.type,
    name: l.name,
    emoji: l.emoji,
    color: l.color as ListColor,
    description: l.description,
    ownerId: l.ownerId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

inviteRoutes.post("/invites/:token/accept", async (c) => {
  const token = c.req.param("token");
  if (token.length === 0 || token.length > 256) {
    return err(c, "NOT_FOUND", "invite not found");
  }

  const userId = c.get("userId");
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(listInvites)
      .where(eq(listInvites.token, token))
      .limit(1);
    if (!invite) return { kind: "not_found" as const };
    if (invite.revokedAt) return { kind: "not_found" as const };
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return { kind: "not_found" as const };
    }

    const [list] = await tx.select().from(lists).where(eq(lists.id, invite.listId)).limit(1);
    if (!list) return { kind: "not_found" as const };

    // Idempotent: existing membership keeps role + joinedAt.
    const [existing] = await tx
      .select()
      .from(listMembers)
      .where(and(eq(listMembers.listId, list.id), eq(listMembers.userId, userId)))
      .limit(1);

    let memberRow = existing;
    let newlyJoined = false;
    if (!memberRow) {
      const [inserted] = await tx
        .insert(listMembers)
        .values({ listId: list.id, userId, role: "member" })
        .returning();
      if (!inserted) throw new Error("member insert returned no row");
      memberRow = inserted;
      newlyJoined = true;
    }

    // Stamp acceptedAt the first time a user accepts the link. Multiple
    // distinct users accepting the same token is intentional (share
    // link); we record the first acceptance for the audit trail and
    // leave the row otherwise untouched.
    if (!invite.acceptedAt) {
      await tx
        .update(listInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(listInvites.id, invite.id));
    }

    // `member_joined` only fires on a fresh membership row — re-accepting
    // a token while already a member is a no-op event-wise, matching
    // the idempotent membership behavior.
    if (newlyJoined) {
      await recordEvent({
        db: tx,
        listId: list.id,
        actorId: userId,
        type: "member_joined",
        payload: { inviteId: invite.id },
      });
    }

    return { kind: "ok" as const, list, member: memberRow };
  });

  if (result.kind === "not_found") {
    return err(c, "NOT_FOUND", "invite not found");
  }

  const [userRow] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const memberSummary: ListMemberSummary = {
    userId: result.member.userId,
    displayName: userRow?.displayName ?? null,
    role: result.member.role as MemberRole,
    joinedAt: result.member.joinedAt.toISOString(),
  };

  return ok(c, {
    list: toListShape(result.list),
    member: memberSummary,
  });
});

/**
 * Reused by `GET /v1/lists/:id` to populate `pendingInvites`. Filters
 * out accepted, revoked, or expired rows. `token` is intentionally
 * omitted from the returned shapes — see `toInviteShape`.
 */
export async function fetchPendingInvitesForList(listId: string): Promise<Invite[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(listInvites)
    .where(
      and(
        eq(listInvites.listId, listId),
        isNull(listInvites.acceptedAt),
        isNull(listInvites.revokedAt),
      ),
    );
  const now = Date.now();
  return rows
    .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
    .map((r) => toInviteShape(r, { includeToken: false }));
}
