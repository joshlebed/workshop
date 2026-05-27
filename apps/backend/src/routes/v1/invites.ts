import type {
  ListColor,
  ListMemberSummary,
  ListPreview,
  MemberRole,
  ShareVisibility,
} from "@workshop/shared";
import { type ItemKind, isItemKind } from "@workshop/shared/itemKinds";
import type { ModuleName } from "@workshop/shared/modules";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { type DbList, listInvites, listMembers, lists, users } from "../../db/schema.js";
import { recordEvent } from "../../lib/events.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * Legacy invite-token compatibility. We no longer mint new invite tokens —
 * the share model is now per-list `share_slug` (see `lists.ts`). These
 * handlers exist so URLs already in iMessage / email threads keep working:
 *
 * - `POST /invites/:token/accept`  → joins the list referenced by the token
 *   if it's still valid. Once the user joins (or the token expires) the
 *   client should route them onto `/l/:slug` going forward.
 * - `GET  /invites/:token/preview` → public preview for old OG-cached links.
 *
 * The create + revoke endpoints have been retired; settings now manages
 * sharing via the slug + visibility surface.
 */
export const inviteRoutes = new Hono();

export const publicInviteRoutes = new Hono();

inviteRoutes.use("*", requireAuth);

// --- POST /v1/invites/:token/accept (legacy join via old share URLs) ---

function toListShape(l: DbList) {
  return {
    id: l.id,
    name: l.name,
    emoji: l.emoji,
    color: l.color as ListColor,
    description: l.description,
    coverPhotoUrl: l.coverPhotoUrl,
    ownerId: l.ownerId,
    itemKind: l.itemKind,
    modules: l.modules,
    shareSlug: l.shareSlug,
    shareVisibility: l.shareVisibility as ShareVisibility,
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

    const [list] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.id, invite.listId), isNull(lists.archivedAt)))
      .limit(1);
    if (!list) return { kind: "not_found" as const };

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

    if (!invite.acceptedAt) {
      await tx
        .update(listInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(listInvites.id, invite.id));
    }

    if (newlyJoined) {
      await recordEvent({
        db: tx,
        listId: list.id,
        actorId: userId,
        type: "member_joined",
        payload: { via: "legacy_invite", inviteId: invite.id },
      });
    }

    return { kind: "ok" as const, list, member: memberRow };
  });

  if (result.kind === "not_found") return err(c, "NOT_FOUND", "invite not found");

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

  return ok(c, { list: toListShape(result.list), member: memberSummary });
});

// --- GET /v1/invites/:token/preview (legacy OG preview) ---

/**
 * Safe metadata subset for unauthenticated link-preview crawlers hitting
 * an old `/invite/:token` URL. Same shape as the by-slug preview so the
 * Pages Function for old URLs can swap the underlying API call without
 * the OG renderer noticing.
 */
publicInviteRoutes.get("/invites/:token/preview", async (c) => {
  const token = c.req.param("token");
  if (token.length === 0 || token.length > 256) {
    return err(c, "NOT_FOUND", "invite not found");
  }

  const db = getDb();
  const [invite] = await db.select().from(listInvites).where(eq(listInvites.token, token)).limit(1);
  if (!invite || invite.revokedAt) {
    return err(c, "NOT_FOUND", "invite not found");
  }
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    return err(c, "NOT_FOUND", "invite not found");
  }

  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, invite.listId), isNull(lists.archivedAt)))
    .limit(1);
  if (!list) return err(c, "NOT_FOUND", "invite not found");

  const [owner] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, list.ownerId))
    .limit(1);

  const countRows = await executeRows<{ item_count: number; member_count: number }>(
    db,
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM items i WHERE i.list_id = ${list.id} AND i.archived_at IS NULL) AS item_count,
        (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = ${list.id}) AS member_count
    `,
  );
  const counts = countRows[0] ?? { item_count: 0, member_count: 0 };

  const preview: ListPreview = {
    id: list.id,
    name: list.name,
    emoji: list.emoji,
    color: list.color as ListColor,
    description: list.description,
    ownerName: owner?.displayName ?? null,
    itemCount: Number(counts.item_count),
    memberCount: Number(counts.member_count),
    itemKind:
      (list.itemKind && isItemKind(list.itemKind) ? (list.itemKind as ItemKind) : null) ?? null,
    modules: (list.modules ?? []) as ModuleName[],
    shareVisibility: list.shareVisibility as ShareVisibility,
    shareSlug: list.shareSlug,
  };

  return ok(c, { preview });
});
