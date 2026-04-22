import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getConfig } from "../lib/config.js";
import * as schema from "./schema.js";

let cached: ReturnType<typeof drizzle> | null = null;
let cachedClient: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (cached) return cached;
  const { databaseUrl, isLocal } = getConfig();
  cachedClient = postgres(databaseUrl, {
    ssl: isLocal ? false : "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  cached = drizzle(cachedClient, { schema });
  return cached;
}

export async function closeDb() {
  if (cachedClient) {
    await cachedClient.end();
    cachedClient = null;
    cached = null;
  }
}
