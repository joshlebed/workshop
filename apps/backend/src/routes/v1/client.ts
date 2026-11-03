import type { ClientReleaseResponse } from "@workshop/shared";
import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import { clientReleaseQuerySchema, readClientRelease } from "../../lib/clientReleases.js";
import { err, ok } from "../../lib/response.js";

/**
 * Lightweight, unauthenticated client-bootstrap reads. Public on purpose: an
 * "Update required" screen has to reach a signed-out (or session-broken)
 * install too. No per-user state, so responses are publicly cacheable.
 */
export const clientRoutes = new Hono();

/**
 * The operator-set App Store update nudge for one (client, platform). All
 * nulls = no nudge. Read-only — the only writer is
 * `PUT /v1/admin/client-release` (operator, admin dashboard).
 */
clientRoutes.get("/release", async (c) => {
  const parsed = clientReleaseQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return err(c, "VALIDATION", "invalid query", parsed.error.flatten());
  const db = getDb();
  // Unauthenticated: this is the request's first DB touch (see db/retry.ts).
  const row = await withDbRetry(() =>
    readClientRelease(db, parsed.data.client, parsed.data.platform),
  );
  const body: ClientReleaseResponse = {
    latestVersion: row.latestVersion,
    minimumVersion: row.minimumVersion,
    storeUrl: row.storeUrl,
    message: row.message,
  };
  c.header("Cache-Control", "public, max-age=60");
  return ok(c, body);
});
