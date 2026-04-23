import type { RecItem } from "@workshop/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { type DbRecItem, recItems } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";

const categorySchema = z.enum(["movie", "tv", "book"]);

const createSchema = z.object({
  title: z.string().min(1).max(500),
  category: categorySchema,
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  completed: z.boolean().optional(),
  count: z.number().int().min(1).max(999_999).optional(),
});

const bulkSchema = z.object({
  category: categorySchema,
  titles: z.array(z.string()).max(5000),
});

const importCsvSchema = z.object({
  csv: z.string().max(5_000_000),
});

function toApi(row: DbRecItem): RecItem {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    category: row.category,
    count: row.count,
    completed: row.completed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function upsertIncrement(userId: string, title: string, category: DbRecItem["category"]) {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(recItems)
    .where(
      and(
        eq(recItems.userId, userId),
        eq(recItems.category, category),
        sql`lower(${recItems.title}) = lower(${trimmed})`,
      ),
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(recItems)
      .set({ count: sql`${recItems.count} + 1`, updatedAt: new Date() })
      .where(eq(recItems.id, existing.id))
      .returning();
    return row ?? null;
  }

  const [row] = await db
    .insert(recItems)
    .values({ userId, title: trimmed, category, count: 1 })
    .returning();
  return row ?? null;
}

export const itemsRoutes = new Hono();

itemsRoutes.use("*", requireAuth);

itemsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const categoryParam = c.req.query("category");
  const db = getDb();

  const whereClause =
    categoryParam && categorySchema.safeParse(categoryParam).success
      ? and(
          eq(recItems.userId, userId),
          eq(recItems.category, categoryParam as DbRecItem["category"]),
        )
      : eq(recItems.userId, userId);

  const rows = await db
    .select()
    .from(recItems)
    .where(whereClause)
    .orderBy(desc(recItems.count), desc(recItems.updatedAt));

  return c.json({ items: rows.map(toApi) });
});

itemsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }

  const row = await upsertIncrement(userId, parsed.data.title, parsed.data.category);
  if (!row) return c.json({ error: "invalid title" }, 400);
  return c.json(toApi(row), 201);
});

itemsRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }

  const updates: Partial<DbRecItem> & { updatedAt: Date } = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
  if (parsed.data.completed !== undefined) updates.completed = parsed.data.completed;
  if (parsed.data.count !== undefined) updates.count = parsed.data.count;

  const db = getDb();
  const [row] = await db
    .update(recItems)
    .set(updates)
    .where(and(eq(recItems.id, id), eq(recItems.userId, userId)))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(toApi(row));
});

itemsRoutes.post("/:id/increment", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .update(recItems)
    .set({ count: sql`${recItems.count} + 1`, updatedAt: new Date() })
    .where(and(eq(recItems.id, id), eq(recItems.userId, userId)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(toApi(row));
});

itemsRoutes.post("/:id/decrement", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();

  const [existing] = await db
    .select()
    .from(recItems)
    .where(and(eq(recItems.id, id), eq(recItems.userId, userId)));
  if (!existing) return c.json({ error: "not found" }, 404);

  if (existing.count <= 1) {
    await db.delete(recItems).where(and(eq(recItems.id, id), eq(recItems.userId, userId)));
    return c.json({ deleted: true, id });
  }

  const [row] = await db
    .update(recItems)
    .set({ count: sql`${recItems.count} - 1`, updatedAt: new Date() })
    .where(and(eq(recItems.id, id), eq(recItems.userId, userId)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(toApi(row));
});

itemsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb();
  const [row] = await db
    .delete(recItems)
    .where(and(eq(recItems.id, id), eq(recItems.userId, userId)))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

itemsRoutes.post("/bulk", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }
  let imported = 0;
  for (const raw of parsed.data.titles) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const row = await upsertIncrement(userId, trimmed, parsed.data.category);
    if (row) imported++;
  }
  return c.json({ imported });
});

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur.length === 0) {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

itemsRoutes.post("/import-csv", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = importCsvSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.flatten() }, 400);
  }

  const db = getDb();
  const lines = parsed.data.csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const rows: {
    title: string;
    count: number;
    completed: boolean;
    category: DbRecItem["category"];
  }[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const [title, countRaw, completedRaw, categoryRaw] = cols;
    if (!title) continue;
    const category = categorySchema.safeParse(categoryRaw);
    if (!category.success) continue;
    const count = Number.parseInt(countRaw ?? "1", 10);
    if (!Number.isFinite(count) || count < 1) continue;
    const completed = String(completedRaw).toLowerCase() === "true";
    rows.push({ title, count, completed, category: category.data });
  }

  await db.transaction(async (tx) => {
    await tx.delete(recItems).where(eq(recItems.userId, userId));
    if (rows.length > 0) {
      await tx.insert(recItems).values(rows.map((r) => ({ userId, ...r })));
    }
  });

  return c.json({ imported: rows.length });
});

itemsRoutes.get("/export-csv", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await db
    .select()
    .from(recItems)
    .where(eq(recItems.userId, userId))
    .orderBy(desc(recItems.count), desc(recItems.updatedAt));
  const csv = rows
    .map((r) => `${csvEscape(r.title)},${r.count},${r.completed},${r.category}`)
    .join("\n");
  return c.json({ csv });
});
