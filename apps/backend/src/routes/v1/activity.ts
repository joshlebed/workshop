import type {
  ActivityEvent,
  ActivityEventType,
  ActivityFeedResponse,
  MarkActivityReadResponse,
} from "@workshop/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { toIsoString } from "../../lib/dates.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";

/**
 * `GET  /v1/activity?cursor&limit=50` — cross-list feed scoped to the
 *   requester's `list_members` rows (spec §4.7). Cursor pagination on
 *   `(created_at DESC, id DESC)`; encoding both columns avoids
 *   duplicate / skipped rows when several events land in the same
 *   transaction (e.g. `item_added` + auto-upvote handler retrofits in
 *   the same tx burst).
 *
 * `POST /v1/activity/read` — body `{ listIds? }`; upserts
 *   `user_activity_reads(user_id, list_id, last_read_at = now())`. Omit
 *   `listIds` to mark every membership read at once. Lists the
 *   requester isn't a member of are silently skipped — they wouldn't
 *   show up in the feed anyway, so an explicit error would just leak
 *   non-membership.
 */
export const activityRoutes = new Hono();

activityRoutes.use("*", requireAuth);

// --- Cursor encoding ---

/**
 * Cursor format: `<ISO timestamp>|<uuid>`. Base64url-encoded so the value
 * is opaque and URL-safe. We only return well-formed cursors, so a
 * malformed input is treated as "no cursor" (no need to 400 a client
 * that's trying to refresh).
 */
function encodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface DecodedCursor {
  createdAt: Date;
  id: string;
}

function decodeCursor(value: string | undefined): DecodedCursor | null {
  if (!value) return null;
  if (value.length > 256) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const raw = Buffer.from(padded, "base64").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep === -1) return null;
    const tsPart = raw.slice(0, sep);
    const idPart = raw.slice(sep + 1);
    const ts = new Date(tsPart);
    if (Number.isNaN(ts.getTime())) return null;
    if (!/^[0-9a-f-]{36}$/i.test(idPart)) return null;
    return { createdAt: ts, id: idPart };
  } catch {
    return null;
  }
}

// --- GET /v1/activity?cursor&limit=50 ---

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 50 : Number(v)))
    .pipe(z.number().int().min(1).max(100)),
});

activityRoutes.get("/", async (c) => {
  const parsed = querySchema.safeParse({
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }

  const userId = c.get("userId");
  const limit = parsed.data.limit;
  const cursor = decodeCursor(parsed.data.cursor);
  const db = getDb();

  // (created_at, id) tuple comparison — needs both columns so events
  // recorded in the same transaction don't collapse to a single
  // boundary row. Postgres handles row-value comparisons natively.
  const cursorClause = cursor
    ? sql`AND (e.created_at, e.id) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
    : sql``;

  // Fetch limit+1 so we know whether there's another page without a
  // separate COUNT query. Drop the extra row before serialising.
  const rows = await executeRows<{
    id: string;
    list_id: string;
    actor_id: string;
    event_type: string;
    item_id: string | null;
    payload: Record<string, unknown> | null;
    created_at: Date | string;
    actor_display_name: string | null;
  }>(
    db,
    sql`
      SELECT
        e.id,
        e.list_id,
        e.actor_id,
        e.event_type::text AS event_type,
        e.item_id,
        e.payload,
        e.created_at,
        u.display_name AS actor_display_name
      FROM activity_events e
      JOIN list_members lm ON lm.list_id = e.list_id AND lm.user_id = ${userId}
      LEFT JOIN users u ON u.id = e.actor_id
      WHERE TRUE ${cursorClause}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit + 1}
    `,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const events: ActivityEvent[] = page.map((r) => ({
    id: r.id,
    listId: r.list_id,
    actorId: r.actor_id,
    actorDisplayName: r.actor_display_name,
    type: r.event_type as ActivityEventType,
    itemId: r.item_id,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: toIsoString(r.created_at),
  }));

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = events[events.length - 1];
    if (last) nextCursor = encodeCursor(new Date(last.createdAt), last.id);
  }

  const body: ActivityFeedResponse = { events, nextCursor };
  return ok(c, body);
});

// --- POST /v1/activity/read ---

export const markReadSchema = z
  .object({
    listIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .optional();

activityRoutes.post("/read", async (c) => {
  const parsed = await parseJsonBody(c, markReadSchema, { allowEmpty: true });
  if (!parsed.ok) return parsed.response;

  const userId = c.get("userId");
  const listIds = parsed.data?.listIds;
  const db = getDb();

  // The membership join on the SELECT-INTO-INSERT clause guarantees we
  // never write a `(user_id, list_id)` row the requester isn't a member
  // of — silent skip rather than 403 to avoid leaking which lists exist.
  const filterClause =
    listIds === undefined
      ? sql``
      : listIds.length === 0
        ? sql`AND FALSE`
        : sql`AND lm.list_id IN (${sql.join(
            listIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`;

  await db.execute(sql`
    INSERT INTO user_activity_reads (user_id, list_id, last_read_at)
    SELECT lm.user_id, lm.list_id, now()
    FROM list_members lm
    WHERE lm.user_id = ${userId} ${filterClause}
    ON CONFLICT (user_id, list_id)
    DO UPDATE SET last_read_at = EXCLUDED.last_read_at
  `);

  const responseBody: MarkActivityReadResponse = { ok: true };
  return ok(c, responseBody);
});

// --- Test-only exports ---

export const __test = { encodeCursor, decodeCursor };
