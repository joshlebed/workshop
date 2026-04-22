import type { WatchlistItem } from "@workshop/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { type DbWatchlistItem, watchlistItems } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";

const watchStatusSchema = z.enum(["want_to_watch", "watched", "abandoned"]);

const createSchema = z.object({
  title: z.string().min(1).max(500),
  year: z.number().int().min(1800).max(2200).nullish(),
  status: watchStatusSchema.optional(),
  notes: z.string().max(4000).nullish(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  year: z.number().int().min(1800).max(2200).nullish(),
  status: watchStatusSchema.optional(),
  rating: z.number().int().min(1).max(10).nullish(),
  notes: z.string().max(4000).nullish(),
});

function toApi(row: DbWatchlistItem): WatchlistItem {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    year: row.year,
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    watchedAt: row.watchedAt ? row.watchedAt.toISOString() : null,
  };
}

export const watchlistRoutes = new Hono();

watchlistRoutes.use("*", requireAuth);

watchlistRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .orderBy(desc(watchlistItems.createdAt));
  return c.json({ items: rows.map(toApi) });
});

watchlistRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }

  const db = getDb();
  const [row] = await db
    .insert(watchlistItems)
    .values({
      userId,
      title: parsed.data.title,
      year: parsed.data.year ?? null,
      status: parsed.data.status ?? "want_to_watch",
      notes: parsed.data.notes ?? null,
    })
    .returning();

  if (!row) return c.json({ error: "insert failed" }, 500);
  return c.json(toApi(row), 201);
});

watchlistRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }

  const updates: Partial<DbWatchlistItem> & { updatedAt: Date } = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.year !== undefined) updates.year = parsed.data.year;
  if (parsed.data.rating !== undefined) updates.rating = parsed.data.rating;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  if (parsed.data.status !== undefined) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "watched") updates.watchedAt = new Date();
  }

  const db = getDb();
  const [row] = await db
    .update(watchlistItems)
    .set(updates)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(toApi(row));
});

watchlistRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
