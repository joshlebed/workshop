import { ADMIN_ANALYTICS_RANGES, WORKSHOP_CLIENTS } from "@workshop/shared/constants";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { users } from "../../db/schema.js";
import { isAdminUser } from "../../lib/admin.js";
import { buildAdminAnalytics } from "../../lib/adminAnalytics.js";
import { buildAdminGraph } from "../../lib/adminGraph.js";
import {
  adminPushRecipientsQuerySchema,
  adminPushSendSchema,
  listAdminPushRecipients,
  sendAdminPush,
} from "../../lib/adminPush.js";
import {
  clientReleaseQuerySchema,
  readClientRelease,
  updateClientReleaseSchema,
  writeClientRelease,
} from "../../lib/clientReleases.js";
import {
  containsObjectionableContent,
  OBJECTIONABLE_CONTENT_MESSAGE,
} from "../../lib/contentFilter.js";
import { logger } from "../../lib/logger.js";
import { parseJsonBody } from "../../lib/request.js";
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
  return (await realAdmin(c)).denied;
}

async function realAdmin(c: Context) {
  const adminUserId = c.get("impersonatorUserId") ?? c.get("userId");
  const [admin] = await getDb().select().from(users).where(eq(users.id, adminUserId)).limit(1);
  if (!admin) {
    return { denied: err(c, "UNAUTHORIZED", "invalid or expired session"), adminUserId };
  }
  if (!isAdminUser(admin)) {
    return { denied: err(c, "FORBIDDEN", "admin access required"), adminUserId };
  }
  return { denied: null, adminUserId };
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

/**
 * Current App Store update-nudge values for one (client, platform), plus who
 * last changed them. Admin-only read for the dashboard form.
 */
adminRoutes.get("/client-release", async (c) => {
  const denied = await requireRealAdmin(c);
  if (denied) return denied;
  const parsed = clientReleaseQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, "VALIDATION", "invalid query", parsed.error.flatten());
  c.header("Cache-Control", "no-store");
  return ok(c, await readClientRelease(getDb(), parsed.data.client, parsed.data.platform));
});

/**
 * Set the App Store update nudge. THE ONLY WRITE PATH for `client_releases`,
 * and it is the operator's alone: real-admin gate (an impersonating admin is
 * recorded as themselves), zod-validated. Agents, CI, scripts and jobs must
 * never call this — see docs/release-nudge-runbook.md. Nulls clear.
 */
adminRoutes.put("/client-release", async (c) => {
  const { denied, adminUserId } = await realAdmin(c);
  if (denied) return denied;
  const parsed = await parseJsonBody(c, updateClientReleaseSchema);
  if (!parsed.ok) return parsed.response;

  const db = getDb();
  await writeClientRelease(db, parsed.data, adminUserId);
  logger.info("client release nudge updated", {
    client: parsed.data.client,
    platform: parsed.data.platform,
    latest_version: parsed.data.latestVersion,
    minimum_version: parsed.data.minimumVersion,
    has_store_url: parsed.data.storeUrl !== null,
    has_message: parsed.data.message !== null,
    updated_by: adminUserId,
  });
  c.header("Cache-Control", "no-store");
  return ok(c, await readClientRelease(db, parsed.data.client, parsed.data.platform));
});

/**
 * Users the operator push panel can reach: everyone with at least one push
 * token, filtered by a case-insensitive substring of display name or email,
 * newest device first, capped at 500. Real-admin only.
 */
adminRoutes.get("/push/recipients", async (c) => {
  const denied = await requireRealAdmin(c);
  if (denied) return denied;
  const parsed = adminPushRecipientsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, "VALIDATION", "invalid query", parsed.error.flatten());
  c.header("Cache-Control", "no-store");
  return ok(
    c,
    await listAdminPushRecipients(getDb(), {
      q: parsed.data.q,
      remindersOnly: parsed.data.remindersOnly === "1",
    }),
  );
});

/**
 * Send one hand-written push to the selected users' devices. THE OPERATOR'S
 * ALONE, BY HAND, from the dashboard's Push tab: real-admin gate, zod body
 * with `confirm: "SEND"`, and the same objectionable-content filter as
 * user-authored text. Agents, CI, scripts and jobs must never call this —
 * see docs/push-runbook.md.
 */
adminRoutes.post("/push/send", async (c) => {
  const { denied, adminUserId } = await realAdmin(c);
  if (denied) return denied;
  const parsed = await parseJsonBody(c, adminPushSendSchema);
  if (!parsed.ok) return parsed.response;
  if (
    containsObjectionableContent(parsed.data.title) ||
    containsObjectionableContent(parsed.data.body)
  ) {
    return err(c, "VALIDATION", OBJECTIONABLE_CONTENT_MESSAGE, { code: "OBJECTIONABLE_CONTENT" });
  }

  const result = await sendAdminPush(getDb(), parsed.data);
  logger.info("admin_push_sent", {
    adminUserId,
    recipientCount: result.recipients,
    tokens: result.tokens,
    sent: result.sent,
    failed: result.failed,
    pruned: result.pruned,
    title: parsed.data.title,
  });
  c.header("Cache-Control", "no-store");
  return ok(c, result);
});
