import type { AuthProvider } from "@workshop/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbUser, users } from "../../db/schema.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
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

const patchMeSchema = z.object({
  displayName: displayNameSchema,
});

function toUserShape(u: DbUser) {
  return {
    id: u.id,
    authProvider: u.authProvider as AuthProvider,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

userRoutes.patch("/me", async (c) => {
  const parsed = await parseJsonBody(c, patchMeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = c.get("userId");
  const db = getDb();
  const [updated] = await db
    .update(users)
    .set({ displayName: parsed.data.displayName, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) return err(c, "NOT_FOUND", "user not found");
  return ok(c, { user: toUserShape(updated) });
});
