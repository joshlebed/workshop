import { ADMIN_ANALYTICS_RANGES, WORKSHOP_CLIENTS } from "@workshop/shared/constants";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { isAdminUser } from "../../lib/admin.js";
import { buildAdminAnalytics } from "../../lib/adminAnalytics.js";
import { getRequestClientContext } from "../../lib/requestContext.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";

export const adminRoutes = new Hono();
adminRoutes.use("*", requireAuth);

const analyticsQuerySchema = z.object({
  client: z.enum(WORKSHOP_CLIENTS).optional(),
  range: z.coerce
    .number()
    .refine((n): n is (typeof ADMIN_ANALYTICS_RANGES)[number] =>
      (ADMIN_ANALYTICS_RANGES as readonly number[]).includes(n),
    )
    .optional(),
});

/**
 * Per-app usage dashboard numbers. Admin-only — gated on the *real* admin
 * identity, so an admin impersonating someone still sees it and a non-admin
 * never does. `client` defaults to the calling app (`X-Workshop-Client`).
 */
adminRoutes.get("/analytics", async (c) => {
  const adminUserId = c.get("impersonatorUserId") ?? c.get("userId");
  const [admin] = await getDb().select().from(users).where(eq(users.id, adminUserId)).limit(1);
  if (!admin) return err(c, "UNAUTHORIZED", "invalid or expired session");
  if (!isAdminUser(admin)) return err(c, "FORBIDDEN", "admin access required");

  const parsed = analyticsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, "VALIDATION", "invalid query", parsed.error.flatten());

  const client = parsed.data.client ?? getRequestClientContext()?.client ?? "workshop";
  const range = parsed.data.range ?? 30;
  return ok(c, await buildAdminAnalytics(client, range));
});
