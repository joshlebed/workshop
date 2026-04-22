import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client.js";
import { logger } from "../lib/logger.js";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => c.json({ ok: true, service: "watchlist-api" }));

healthRoutes.get("/db", async (c) => {
  try {
    const db = getDb();
    const result = await db.execute(sql`select 1 as ok`);
    return c.json({ ok: true, rows: result.length });
  } catch (error) {
    logger.error("health db check failed", { error });
    return c.json({ ok: false, error: "db unreachable" }, 503);
  }
});
