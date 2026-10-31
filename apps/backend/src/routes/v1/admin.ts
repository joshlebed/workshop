import { ADMIN_ANALYTICS_RANGES, WORKSHOP_CLIENTS } from "@workshop/shared/constants";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { isAdminUser } from "../../lib/admin.js";
import { buildAdminAnalytics } from "../../lib/adminAnalytics.js";
import { buildAdminGraph } from "../../lib/adminGraph.js";
import { getRequestClientContext } from "../../lib/requestContext.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";

export const adminRoutes = new Hono();
adminRoutes.use("*", requireAuth);

/**
 * Gate on the *real* admin identity: an admin impersonating someone still
 * passes, a non-admin never does. Returns the error response, or null to proceed.
 */
async function requireRealAdmin(c: Context) {
  const adminUserId = c.get("impersonatorUserId") ?? c.get("userId");
  const [admin] = await getDb().select().from(users).where(eq(users.id, adminUserId)).limit(1);
  if (!admin) return err(c, "UNAUTHORIZED", "invalid or expired session");
  if (!isAdminUser(admin)) return err(c, "FORBIDDEN", "admin access required");
  return null;
}

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
  const denied = await requireRealAdmin(c);
  if (denied) return denied;

  const parsed = analyticsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, "VALIDATION", "invalid query", parsed.error.flatten());

  const client = parsed.data.client ?? getRequestClientContext()?.client ?? "workshop";
  const range = parsed.data.range ?? 30;
  return ok(c, await buildAdminAnalytics(client, range));
});

/**
 * The HighScore friend graph (every user + every friendship edge, with per-user
 * activity stats) for the admin "users web" dashboards. Admin-only, same gate
 * as `/analytics`.
 */
adminRoutes.get("/graph", async (c) => {
  const denied = await requireRealAdmin(c);
  if (denied) return denied;
  return ok(c, await buildAdminGraph());
});
