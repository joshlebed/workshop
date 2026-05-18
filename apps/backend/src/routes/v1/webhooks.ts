// Inbound webhook surface for push-driven sources (§3.6 of the redesign).
// The slug in the path is keyed to `list_sources.webhook_slug`; the verifier
// is registered in `lib/sources/webhookSignature.ts`. No source kind ships
// with a webhook today — this route is the scaffolding so the first one
// has somewhere to land without a route migration.

import { isSourceKind, type SourceKind } from "@workshop/shared/sourceKinds";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { listSources } from "../../db/schema.js";
import { recordEvent } from "../../lib/events.js";
import { logger } from "../../lib/logger.js";
import { err, ok } from "../../lib/response.js";
import { dispatchFor } from "../../lib/sources/registry.js";
import { openSecrets, SecretEnvelopeError } from "../../lib/sources/secrets.js";
import {
  getWebhookVerifier,
  UnknownWebhookKindError,
  type WebhookRequest,
} from "../../lib/sources/webhookSignature.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const webhookRoutes = new Hono();

const SLUG_RE = /^[a-z0-9]{8,64}$/;

// Tight rate limit by client IP — webhooks shouldn't be hot, and a flood of
// invalid signatures is the canary for a probing attacker.
const ipKey = (c: Parameters<Parameters<typeof webhookRoutes.use>[1]>[0]): string | null => {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip") ?? null;
};

webhookRoutes.post(
  "/sources/webhooks/:slug",
  rateLimit({ family: "v1.sources.webhooks", limit: 120, windowSec: 60, key: ipKey }),
  async (c) => {
    const slug = c.req.param("slug");
    if (!SLUG_RE.test(slug)) {
      return err(c, "NOT_FOUND", "webhook not found");
    }

    const db = getDb();
    const [source] = await db
      .select()
      .from(listSources)
      .where(eq(listSources.webhookSlug, slug))
      .limit(1);
    if (!source) {
      return err(c, "NOT_FOUND", "webhook not found");
    }
    if (!isSourceKind(source.kind)) {
      logger.warn("webhook arrived for unknown kind", { slug, kind: source.kind });
      return err(c, "INTERNAL", "source kind not registered");
    }

    let verifier: ReturnType<typeof getWebhookVerifier>;
    try {
      verifier = getWebhookVerifier(source.kind);
    } catch (e) {
      if (e instanceof UnknownWebhookKindError) {
        // Source row has a webhook_slug but no verifier registered. Reject
        // until the deploy that ships both lands.
        return err(c, "INTERNAL", `no verifier for source kind: ${source.kind}`);
      }
      throw e;
    }

    const rawBody = Buffer.from(await c.req.arrayBuffer());
    const headers: Record<string, string | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const sharedSecret = source.secrets ? extractWebhookSecret(source.secrets) : null;
    if (!sharedSecret) {
      return err(c, "INTERNAL", "webhook secret missing for source");
    }

    const req: WebhookRequest = { rawBody, headers };
    if (!verifier.verify(req, sharedSecret)) {
      return err(c, "FORBIDDEN", "invalid signature");
    }

    // Verified — fire the kind's sync. The sync impl is responsible for any
    // payload-specific parsing; the v1 contract just kicks off a refresh.
    const kind = source.kind as SourceKind;
    const dispatch = dispatchFor(kind);
    const sync = await dispatch.sync({
      listId: source.listId,
      userId: source.lastSyncedBy ?? source.listId, // best-effort actor
      config: (source.config ?? {}) as Record<string, unknown>,
      db,
    });

    await db
      .update(listSources)
      .set({ lastSyncedAt: sync.refreshedAt })
      .where(eq(listSources.id, source.id));

    // Activity event uses the source's last actor when present.
    if (source.lastSyncedBy) {
      await recordEvent({
        listId: source.listId,
        actorId: source.lastSyncedBy,
        type: "source_synced",
        payload: { kind: source.kind, addedCount: sync.addedCount, via: "webhook" },
      });
    }

    return ok(c, { ok: true, addedCount: sync.addedCount });
  },
);

function extractWebhookSecret(secrets: unknown): string | null {
  try {
    const opened = openSecrets(secrets);
    const s = opened.webhookSharedSecret;
    return typeof s === "string" && s.length > 0 ? s : null;
  } catch (e) {
    if (e instanceof SecretEnvelopeError) {
      logger.error("failed to open source secrets", { error: e });
      return null;
    }
    throw e;
  }
}
