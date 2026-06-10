import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbUser, users } from "../../db/schema.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { revokeAllSessions } from "../../lib/sessionRevocation.js";
import { requireAuth } from "../../middleware/auth.js";

export const userRoutes = new Hono();
userRoutes.use("*", requireAuth);

// Display names: stripped, 1–40 chars, no leading/trailing whitespace,
// no embedded newlines. Permissive on character set — emoji + non-Latin OK.
export const displayNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "display name required").max(40, "display name too long"))
  .refine((s) => !/[\r\n]/.test(s), "display name must be a single line");

// Profile pictures are stored inline as base64 `data:` URLs (same approach as
// list cover photos — there's no object store yet). The picker crops to a
// square and downscales, so the payload stays well under this cap in practice.
const AVATAR_MAX_CHARS = 1_500_000;
export const avatarUrlSchema = z
  .string()
  .max(AVATAR_MAX_CHARS, "profile picture too large")
  .refine(
    (s) => /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s),
    "profile picture must be a base64 data URL",
  );

// Both fields are optional; the client sends only what changed. `avatarUrl: null`
// clears the picture. `.refine` rejects an empty body so a no-op PATCH can't
// silently bump `updated_at`.
const patchMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarUrl: avatarUrlSchema.nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarUrl !== undefined, {
    message: "nothing to update",
  });

function toUserShape(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

userRoutes.patch("/me", async (c) => {
  const parsed = await parseJsonBody(c, patchMeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = c.get("userId");
  const db = getDb();
  const patch: Partial<Pick<DbUser, "displayName" | "avatarUrl">> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
  if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl;
  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "user not found");
  return ok(c, { user: toUserShape(updated) });
});

// Sign out of every device — bumps `sessions_invalidated_at` so every existing
// session token for this user is rejected on its next request. The user has
// to sign in again to mint a fresh token.
userRoutes.delete("/me/sessions", async (c) => {
  await revokeAllSessions(c.get("userId"));
  return ok(c, { ok: true });
});
